import { useState, useEffect, useRef, useCallback } from 'react';
import type { QueuedMessage } from '../types/queue';

const STORAGE_KEY_PREFIX = 'opencode_remote_queued_messages';

function getStorageKey(deviceId?: string | null): string {
  return deviceId ? `${STORAGE_KEY_PREFIX}:${deviceId}` : STORAGE_KEY_PREFIX;
}

function loadQueuesFromStorage(deviceId?: string | null): Record<string, QueuedMessage[]> {
  try {
    const raw = localStorage.getItem(getStorageKey(deviceId));
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

function saveQueuesToStorage(deviceId: string | null | undefined, queues: Record<string, QueuedMessage[]>) {
  try {
    localStorage.setItem(getStorageKey(deviceId), JSON.stringify(queues));
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
  onQueueUpdate?: (
    sessionId: string,
    queue: QueuedMessage[],
    mutationId?: string,
    baseRevision?: number
  ) => void;
}

export function useMessageQueue({
  activeSessionId,
  selectedDeviceId,
  isStreaming = false,
  sessionStreamingStatus,
  onSendMessage,
  onQueueUpdate,
}: UseMessageQueueOptions) {
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>(() =>
    loadQueuesFromStorage(selectedDeviceId)
  );
  const queuesRef = useRef<Record<string, QueuedMessage[]>>(queues);
  const currentDeviceIdRef = useRef<string | null | undefined>(selectedDeviceId);
  const [editingItem, setEditingItem] = useState<{ id: string; sessionId: string; content: string } | null>(null);

  const onQueueUpdateRef = useRef(onQueueUpdate);
  onQueueUpdateRef.current = onQueueUpdate;

  const revisionsRef = useRef<Record<string, number>>({});
  const inFlightMutationsRef = useRef<Map<string, { mutationId: string; baseRevision: number }>>(new Map());
  const pendingMutationsRef = useRef<Map<string, QueuedMessage[]>>(new Map());

  // Per-session dispatch mutexes to prevent concurrent duplicates per session
  const dispatchingSessionsRef = useRef<Set<string>>(new Set());
  const prevStreamingBySessionRef = useRef<Record<string, boolean>>({});

  // Re-hydrate device-scoped queue cache when selectedDeviceId changes
  useEffect(() => {
    if (selectedDeviceId !== currentDeviceIdRef.current) {
      currentDeviceIdRef.current = selectedDeviceId;
      const cached = loadQueuesFromStorage(selectedDeviceId);
      queuesRef.current = cached;
      setQueues(cached);
      revisionsRef.current = {};
      inFlightMutationsRef.current.clear();
      pendingMutationsRef.current.clear();
    }
  }, [selectedDeviceId]);

  // Persist device-scoped cache to localStorage (best-effort, secondary to Relay authority)
  useEffect(() => {
    saveQueuesToStorage(selectedDeviceId, queues);
  }, [selectedDeviceId, queues]);

  // Current session's queue
  const currentQueue = activeSessionId ? queues[activeSessionId] || [] : [];

  // Sync external queue from backend / peer clients with strict monotonic revision checking
  const syncQueue = useCallback((sessionId: string, newQueue: QueuedMessage[], revision?: number) => {
    if (typeof revision === 'number') {
      const currentRev = revisionsRef.current[sessionId] ?? 0;
      if (revision < currentRev) {
        console.warn(
          `[useMessageQueue] Stale queue sync rejected for session ${sessionId}: incoming rev ${revision} < current rev ${currentRev}`
        );
        return;
      }
      revisionsRef.current[sessionId] = revision;
    }

    // In-flight mutation completed on Relay!
    inFlightMutationsRef.current.delete(sessionId);

    queuesRef.current = {
      ...queuesRef.current,
      [sessionId]: newQueue,
    };
    setQueues((prev) => {
      const curr = prev[sessionId] || [];
      if (
        curr.length === newQueue.length &&
        curr.every(
          (m, idx) =>
            m.id === newQueue[idx]?.id &&
            m.content === newQueue[idx]?.content &&
            m.status === newQueue[idx]?.status
        )
      ) {
        return prev;
      }
      return {
        ...prev,
        [sessionId]: newQueue,
      };
    });

    // If there is a pending queued mutation buffered during in-flight wait, dispatch it now!
    const pending = pendingMutationsRef.current.get(sessionId);
    if (pending !== undefined) {
      pendingMutationsRef.current.delete(sessionId);
      const nextBaseRevision = revisionsRef.current[sessionId] || 0;
      const nextMutationId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      inFlightMutationsRef.current.set(sessionId, { mutationId: nextMutationId, baseRevision: nextBaseRevision });
      onQueueUpdateRef.current?.(sessionId, pending, nextMutationId, nextBaseRevision);
    }
  }, []);

  // Dispatch local mutation with per-session serialization: derived from ref to prevent stale closure overwrites
  const dispatchMutation = useCallback(
    (sessionId: string, nextQueue: QueuedMessage[]) => {
      // 1. Immediately update local ref and React state for responsive optimistic UI
      queuesRef.current = {
        ...queuesRef.current,
        [sessionId]: nextQueue,
      };

      setQueues((prev) => {
        const updated = { ...prev };
        if (nextQueue.length === 0) {
          delete updated[sessionId];
        } else {
          updated[sessionId] = nextQueue;
        }
        return updated;
      });

      // 2. Check if a mutation is already in-flight for this session
      const inFlight = inFlightMutationsRef.current.get(sessionId);
      if (inFlight) {
        // Buffer latest mutation; it will be dispatched automatically upon ACK/sync of in-flight mutation
        pendingMutationsRef.current.set(sessionId, nextQueue);
        return;
      }

      // 3. Dispatch immediately if no mutation in-flight
      const baseRevision = revisionsRef.current[sessionId] || 0;
      const mutationId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      inFlightMutationsRef.current.set(sessionId, { mutationId, baseRevision });

      // Liveness safety: unblock after 6s in case WebSocket drops or Relay doesn't ACK
      setTimeout(() => {
        const currentInFlight = inFlightMutationsRef.current.get(sessionId);
        if (currentInFlight && currentInFlight.mutationId === mutationId) {
          inFlightMutationsRef.current.delete(sessionId);
          const pending = pendingMutationsRef.current.get(sessionId);
          if (pending !== undefined) {
            pendingMutationsRef.current.delete(sessionId);
            dispatchMutation(sessionId, pending);
          }
        }
      }, 6000);

      onQueueUpdateRef.current?.(sessionId, nextQueue, mutationId, baseRevision);
    },
    []
  );

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

      const existing = queuesRef.current[sessionId] || [];
      const updated = [...existing, item];
      dispatchMutation(sessionId, updated);

      return item;
    },
    [dispatchMutation]
  );

  // Edit a queued message content
  const edit = useCallback(
    (sessionId: string, id: string, newContent: string) => {
      const clean = newContent.trim();
      if (!clean) return;
      const existing = queuesRef.current[sessionId] || [];
      const updated = existing.map((m) => (m.id === id ? { ...m, content: clean } : m));
      dispatchMutation(sessionId, updated);
      setEditingItem((curr) => (curr?.id === id ? null : curr));
    },
    [dispatchMutation]
  );

  // Remove a message from queue
  const remove = useCallback(
    (sessionId: string, id: string) => {
      const existing = queuesRef.current[sessionId] || [];
      const filtered = existing.filter((m) => m.id !== id);
      dispatchMutation(sessionId, filtered);
      setEditingItem((curr) => (curr?.id === id ? null : curr));
    },
    [dispatchMutation]
  );

  // Send Now action:
  // If agent is currently idle, dispatches immediately.
  // If agent is busy, reorders to front of queue (index 0) without interrupting active turn.
  const sendNow = useCallback(
    async (sessionId: string, id: string) => {
      if (!selectedDeviceId) return;

      const existing = queuesRef.current[sessionId] || [];
      const itemIndex = existing.findIndex((m) => m.id === id);
      if (itemIndex < 0) return;
      const item = existing[itemIndex];

      if (isStreaming) {
        // Agent is busy: move to front of queue (index 0)
        if (itemIndex > 0) {
          const list = [...(queuesRef.current[sessionId] || [])];
          const [target] = list.splice(itemIndex, 1);
          const reordered = [target, ...list];
          dispatchMutation(sessionId, reordered);
        }
        return;
      }

      // Agent is idle: send immediately
      if (dispatchingSessionsRef.current.has(sessionId)) return;
      dispatchingSessionsRef.current.add(sessionId);

      try {
        const sendingList = (queuesRef.current[sessionId] || []).map((m) =>
          m.id === id ? { ...m, status: 'sending' as const } : m
        );
        dispatchMutation(sessionId, sendingList);

        await onSendMessage(selectedDeviceId, sessionId, item.content, item.model);
        remove(sessionId, id);
      } catch (err: any) {
        const failedList = (queuesRef.current[sessionId] || []).map((m) =>
          m.id === id ? { ...m, status: 'failed' as const, error: err.message || 'Send failed' } : m
        );
        dispatchMutation(sessionId, failedList);
      } finally {
        dispatchingSessionsRef.current.delete(sessionId);
      }
    },
    [selectedDeviceId, isStreaming, dispatchMutation, onSendMessage, remove]
  );

  // Retry a failed message
  const retry = useCallback(
    async (sessionId: string, id: string) => {
      const updated = (queuesRef.current[sessionId] || []).map((m) =>
        m.id === id ? { ...m, status: 'queued' as const, error: undefined, retryCount: (m.retryCount || 0) + 1 } : m
      );
      dispatchMutation(sessionId, updated);

      if (!isStreaming) {
        await sendNow(sessionId, id);
      }
    },
    [isStreaming, dispatchMutation, sendNow]
  );

  // Clear all queued messages for a session
  const clear = useCallback(
    (sessionId: string) => {
      dispatchMutation(sessionId, []);
      setEditingItem(null);
    },
    [dispatchMutation]
  );

  // Helper to synchronously update item status in both queuesRef and React state
  const updateLocalItemStatus = useCallback(
    (sessionId: string, itemId: string, status: QueuedMessage['status'], error?: string) => {
      const existing = queuesRef.current[sessionId] || [];
      const updated = existing.map((m) =>
        m.id === itemId ? { ...m, status, error: error !== undefined ? error : m.error } : m
      );
      queuesRef.current = {
        ...queuesRef.current,
        [sessionId]: updated,
      };
      setQueues((prev) => ({
        ...prev,
        [sessionId]: updated,
      }));
    },
    []
  );

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

          // Mark as sending synchronously in both ref and state
          updateLocalItemStatus(sId, nextItem.id, 'sending');

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
              updateLocalItemStatus(
                sId,
                nextItem.id,
                'failed',
                err?.message || 'Failed to dispatch queued message'
              );
            })
            .finally(() => {
              dispatchingSessionsRef.current.delete(sId);
            });
        }
      }
    }
  }, [isStreaming, sessionStreamingStatus, activeSessionId, selectedDeviceId, queues, onSendMessage, remove, updateLocalItemStatus]);

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
    syncQueue,
  };
}
