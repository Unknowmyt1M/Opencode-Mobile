import { useState, useEffect, useRef, useCallback } from 'react';
import type { QueuedMessage } from '../types/queue';

const STORAGE_KEY = 'opencode_remote_queued_messages';

function loadQueuesFromStorage(): Record<string, QueuedMessage[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      // Reset any stuck 'sending' status back to 'queued' upon reload
      for (const sId of Object.keys(parsed)) {
        if (Array.isArray(parsed[sId])) {
          parsed[sId] = parsed[sId].map((m: QueuedMessage) =>
            m.status === 'sending' ? { ...m, status: 'queued' as const } : m
          );
        }
      }
      return parsed;
    }
    return {};
  } catch (err) {
    console.warn('Failed to load queued messages from localStorage:', err);
    return {};
  }
}

function saveQueuesToStorage(queues: Record<string, QueuedMessage[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queues));
  } catch (err) {
    console.warn('Failed to save queued messages to localStorage:', err);
  }
}

interface UseMessageQueueOptions {
  activeSessionId?: string | null;
  selectedDeviceId?: string | null;
  isStreaming?: boolean;
  sessionStreamingStatus?: Record<string, boolean>;
  onSendMessage: (
    deviceId: string,
    sessionId: string,
    content: string,
    model?: { providerID: string; modelID: string }
  ) => Promise<void> | void;
}

export function useMessageQueue({
  activeSessionId,
  selectedDeviceId,
  isStreaming = false,
  sessionStreamingStatus,
  onSendMessage,
}: UseMessageQueueOptions) {
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>(loadQueuesFromStorage);
  const [editingItem, setEditingItem] = useState<{ id: string; sessionId: string; content: string } | null>(null);

  // Per-session dispatch mutexes to prevent concurrent duplicates per session
  const dispatchingSessionsRef = useRef<Set<string>>(new Set());
  const prevStreamingBySessionRef = useRef<Record<string, boolean>>({});

  // Persist queues on change
  useEffect(() => {
    saveQueuesToStorage(queues);
  }, [queues]);

  // Current session's queue
  const currentQueue = activeSessionId ? queues[activeSessionId] || [] : [];

  // Enqueue a message
  const enqueue = useCallback(
    (
      sessionId: string,
      content: string,
      model?: { providerID: string; modelID: string }
    ): QueuedMessage => {
      const clean = content.trim();
      const item: QueuedMessage = {
        id: `qmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        content: clean,
        createdAt: Date.now(),
        status: 'queued',
        model,
        retryCount: 0,
      };

      setQueues((prev) => {
        const existing = prev[sessionId] || [];
        return {
          ...prev,
          [sessionId]: [...existing, item],
        };
      });

      return item;
    },
    []
  );

  // Edit a queued message content
  const edit = useCallback((sessionId: string, id: string, newContent: string) => {
    const clean = newContent.trim();
    if (!clean) return;
    setQueues((prev) => {
      const existing = prev[sessionId] || [];
      return {
        ...prev,
        [sessionId]: existing.map((m) => (m.id === id ? { ...m, content: clean } : m)),
      };
    });
    setEditingItem((curr) => (curr?.id === id ? null : curr));
  }, []);

  // Remove a message from queue
  const remove = useCallback((sessionId: string, id: string) => {
    setQueues((prev) => {
      const existing = prev[sessionId] || [];
      const filtered = existing.filter((m) => m.id !== id);
      const updated = { ...prev };
      if (filtered.length === 0) {
        delete updated[sessionId];
      } else {
        updated[sessionId] = filtered;
      }
      return updated;
    });
    setEditingItem((curr) => (curr?.id === id ? null : curr));
  }, []);

  // Send Now action:
  // If agent is currently idle, dispatches immediately.
  // If agent is busy, reorders to front of queue (index 0) without interrupting active turn.
  const sendNow = useCallback(
    async (sessionId: string, id: string) => {
      if (!selectedDeviceId) return;

      const existing = queues[sessionId] || [];
      const itemIndex = existing.findIndex((m) => m.id === id);
      if (itemIndex < 0) return;
      const item = existing[itemIndex];

      if (isStreaming) {
        // Agent is busy: move to front of queue (index 0)
        if (itemIndex > 0) {
          setQueues((prev) => {
            const list = [...(prev[sessionId] || [])];
            const [target] = list.splice(itemIndex, 1);
            return {
              ...prev,
              [sessionId]: [target, ...list],
            };
          });
        }
        return;
      }

      // Agent is idle: send immediately
      if (dispatchingSessionsRef.current.has(sessionId)) return;
      dispatchingSessionsRef.current.add(sessionId);

      try {
        setQueues((prev) => ({
          ...prev,
          [sessionId]: (prev[sessionId] || []).map((m) =>
            m.id === id ? { ...m, status: 'sending' } : m
          ),
        }));

        await onSendMessage(selectedDeviceId, sessionId, item.content, item.model);
        remove(sessionId, id);
      } catch (err: any) {
        setQueues((prev) => ({
          ...prev,
          [sessionId]: (prev[sessionId] || []).map((m) =>
            m.id === id ? { ...m, status: 'failed', error: err.message || 'Send failed' } : m
          ),
        }));
      } finally {
        dispatchingSessionsRef.current.delete(sessionId);
      }
    },
    [selectedDeviceId, isStreaming, queues, onSendMessage, remove]
  );

  // Retry a failed message
  const retry = useCallback(
    async (sessionId: string, id: string) => {
      setQueues((prev) => ({
        ...prev,
        [sessionId]: (prev[sessionId] || []).map((m) =>
          m.id === id ? { ...m, status: 'queued', error: undefined, retryCount: (m.retryCount || 0) + 1 } : m
        ),
      }));

      if (!isStreaming) {
        await sendNow(sessionId, id);
      }
    },
    [isStreaming, sendNow]
  );

  // Clear all queued messages for a session
  const clear = useCallback((sessionId: string) => {
    setQueues((prev) => {
      const updated = { ...prev };
      delete updated[sessionId];
      return updated;
    });
    setEditingItem(null);
  }, []);

  // Automatic dispatch when turn completes for ANY session (foreground or background):
  // Watch for isStreaming transitioning from true -> false per session
  useEffect(() => {
    if (!selectedDeviceId) return;

    for (const [sId, sessionQueue] of Object.entries(queues)) {
      if (!Array.isArray(sessionQueue) || sessionQueue.length === 0) continue;

      const wasStreaming = prevStreamingBySessionRef.current[sId] ?? false;
      const isCurrentlyStreaming = sessionStreamingStatus
        ? sessionStreamingStatus[sId] ?? false
        : sId === activeSessionId
        ? isStreaming
        : false;

      prevStreamingBySessionRef.current[sId] = isCurrentlyStreaming;

      // When session sId transitions from streaming -> idle
      if (wasStreaming && !isCurrentlyStreaming) {
        const nextItem = sessionQueue.find((m) => m.status === 'queued');

        if (nextItem && !dispatchingSessionsRef.current.has(sId)) {
          dispatchingSessionsRef.current.add(sId);

          // Mark as sending
          setQueues((prev) => ({
            ...prev,
            [sId]: (prev[sId] || []).map((m) =>
              m.id === nextItem.id ? { ...m, status: 'sending' } : m
            ),
          }));

          // Execute send through canonical pathway
          Promise.resolve(
            onSendMessage(
              selectedDeviceId,
              sId,
              nextItem.content,
              nextItem.model
            )
          )
            .then(() => {
              // Successfully handed off to OpenCode; remove from queue
              remove(sId, nextItem.id);
            })
            .catch((err) => {
              console.error(`Failed to dispatch queued message for session ${sId}:`, err);
              setQueues((prev) => ({
                ...prev,
                [sId]: (prev[sId] || []).map((m) =>
                  m.id === nextItem.id
                    ? {
                        ...m,
                        status: 'failed',
                        error: err?.message || 'Failed to dispatch queued message',
                      }
                    : m
                ),
              }));
            })
            .finally(() => {
              dispatchingSessionsRef.current.delete(sId);
            });
        }
      }
    }
  }, [isStreaming, sessionStreamingStatus, activeSessionId, selectedDeviceId, queues, onSendMessage, remove]);

  return {
    queues,
    currentQueue,
    editingItem,
    setEditingItem,
    enqueue,
    edit,
    remove,
    sendNow,
    retry,
    clear,
  };
}
