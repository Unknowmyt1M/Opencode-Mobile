import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  parseProtocolMessage,
  createMessage,
  PROTOCOL_VERSION,
  type ConnectionState,
  type DeviceInfo,
  type ProtocolMessage,
  type OpenCodeSession,
  type SessionMessage,
  type SnapshotFileDiff,
  type ProjectContext,
  type PtySession,
  type ModelInfo,
  type PermissionItem,
  type PtyListResultPayload,
  type PtyCreateResultPayload,
  type SessionAbortResultPayload,
  type ModelListResultPayload,
  type PermissionListResultPayload,
  type PermissionReplyResultPayload,
  type TodoItem,
  type TodoListResultPayload,
  type SessionForkResultPayload,
  type SessionRevertResultPayload,
  type QuestionReplyResultPayload,
  type FsEntry,
  type FsListResultPayload,
  type FsFindResultPayload,
  type FsReadResultPayload,
  type SessionInteractionMode,
} from '@opencode-remote/protocol';
import { useMessageQueue } from './hooks/useMessageQueue';
import { playSound } from './utils/audio';

export type WorkspaceTab = 'chat' | 'review' | 'terminal' | 'activity' | 'files' | 'diff';

export interface SessionTelemetry {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  contextLimit?: number;
  usagePercent: number | null;
  providerLabel?: string;
  modelLabel?: string;
}

export interface SessionRuntimeState {
  isStreaming: boolean;
  isWaitingForResponse: boolean;
  streamingText: string;
  activeMessageId?: string;
  error?: string | null;
  todos: TodoItem[];
  diffs: SnapshotFileDiff[];
}

export const createInitialSessionRuntime = (): SessionRuntimeState => ({
  isStreaming: false,
  isWaitingForResponse: false,
  streamingText: '',
  activeMessageId: undefined,
  error: null,
  todos: [],
  diffs: [],
});

export function useRelay(relayWsUrl?: string) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<OpenCodeSession[]>([]);
  const [activeSession, setActiveSession] = useState<{
    session: OpenCodeSession;
    messages: SessionMessage[];
  } | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');

  // Phase 3 Extensions: PTY Terminal, Model Selector, Permissions
  const [ptys, setPtys] = useState<PtySession[]>([]);
  const [activePtyId, setActivePtyId] = useState<string | null>(null);
  const ptyDataListeners = useRef<Map<string, Set<(data: string) => void>>>(new Map());

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; modelID: string } | null>(null);

  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const fetchTodosRef = useRef<((deviceId: string, sessionId: string) => void) | null>(null);

  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<SessionInteractionMode>('build');

  // ============================================================
  // Session-Scoped Runtime Store (100% Isolated Execution State)
  // ============================================================
  const [sessionRuntime, setSessionRuntime] = useState<Record<string, SessionRuntimeState>>({});
  const activeSessionRef = useRef<{ session: OpenCodeSession; messages: SessionMessage[] } | null>(null);
  const latestRequestedSessionIdRef = useRef<string | null>(null);
  const selectedDeviceIdRef = useRef<string | null>(null);

  // Keep refs in sync to eliminate stale closures in WebSocket callbacks
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const prevDeviceIdRef = useRef<string | null>(selectedDeviceId);
  useEffect(() => {
    if (prevDeviceIdRef.current && prevDeviceIdRef.current !== selectedDeviceId) {
      // Switched to a different device - clean device-specific active states to avoid cross-device leakage
      setActiveSession(null);
      setActiveDiffFile(null);
      setActivePtyId(null);
      setSelectedModel(null);
      setProjectContext(null);
    }
    prevDeviceIdRef.current = selectedDeviceId;
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  // Per-session RAF streaming delta buffers
  const sessionDeltaBuffersRef = useRef<
    Map<string, { deltaText: string; messageId: string; rafId: number | null }>
  >(new Map());

  // Helper to update a specific session's runtime
  const updateSessionRuntime = useCallback(
    (sessionId: string, updater: (prev: SessionRuntimeState) => SessionRuntimeState) => {
      setSessionRuntime((prev) => {
        const current = prev[sessionId] || createInitialSessionRuntime();
        const updated = updater(current);
        return { ...prev, [sessionId]: updated };
      });
    },
    []
  );

  // Derived active session execution state
  const currentActiveSessionId = activeSession?.session?.id;
  const activeRuntime = currentActiveSessionId
    ? sessionRuntime[currentActiveSessionId] || createInitialSessionRuntime()
    : createInitialSessionRuntime();

  const isStreaming = activeRuntime.isStreaming;
  const isWaitingForResponse = activeRuntime.isWaitingForResponse;
  const streamingText = activeRuntime.streamingText;
  const todos = activeRuntime.todos;
  const sessionDiffs = activeRuntime.diffs;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const pendingRequests = useRef<Map<string, (payload: any, isError?: boolean, errMsg?: string) => void>>(new Map());
  const pairingPromiseRef = useRef<{
    resolve: (val: { success: boolean; status?: string; message?: string }) => void;
    timer: number;
  } | null>(null);

  // Local storage for device tokens
  const [deviceTokens, setDeviceTokens] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('opencode_remote_tokens');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const saveDeviceToken = useCallback((deviceId: string, token: string) => {
    setDeviceTokens((prev) => {
      const updated = { ...prev, [deviceId]: token };
      try {
        localStorage.setItem('opencode_remote_tokens', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const removeDeviceToken = useCallback((deviceId: string) => {
    setDeviceTokens((prev) => {
      const updated = { ...prev };
      delete updated[deviceId];
      try {
        localStorage.setItem('opencode_remote_tokens', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const defaultWsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultWsHost = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const url =
    relayWsUrl ||
    (import.meta as any).env?.VITE_RELAY_WS_URL ||
    `${defaultWsProtocol}//${defaultWsHost}/ws`;

  const computedDevices = useMemo(() => {
    return devices.map((d: DeviceInfo) => ({
      ...d,
      paired: Boolean(deviceTokens[d.deviceId]),
    }));
  }, [devices, deviceTokens]);

  const selectedDevice = computedDevices.find((d: DeviceInfo) => d.deviceId === selectedDeviceId) || computedDevices[0];

  const deviceTokensRef = useRef(deviceTokens);
  deviceTokensRef.current = deviceTokens;

  const selectedDeviceRef = useRef<DeviceInfo | undefined>(undefined);
  selectedDeviceRef.current = selectedDevice;

  const fetchSessionDiffRef = useRef<((deviceId: string, sessionId: string) => Promise<any>) | null>(null);

  const sendRpc = useCallback(
    <TResult>(message: ProtocolMessage): Promise<TResult> => {
      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return reject(new Error('WebSocket not connected'));
        }

        const timer = setTimeout(() => {
          pendingRequests.current.delete(message.id);
          reject(new Error('Request timed out'));
        }, 15000);

        pendingRequests.current.set(message.id, (payload, isError, errMsg) => {
          clearTimeout(timer);
          if (isError) {
            reject(new Error(errMsg || 'RPC request failed'));
          } else {
            resolve(payload as TResult);
          }
        });

        wsRef.current.send(JSON.stringify(message));
      });
    },
    []
  );

  const fetchSessionDiff = useCallback(
    async (deviceId: string, sessionId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) return [];
      const msg = createMessage('SESSION_DIFF_GET', {
        deviceId,
        sessionId,
        deviceToken: token,
      });
      try {
        const res = await sendRpc<{ diffs: SnapshotFileDiff[] }>(msg);
        const diffs = res.diffs || [];
        if (sessionId) {
          updateSessionRuntime(sessionId, (prev) => ({
            ...prev,
            diffs,
          }));
        }
        if (diffs.length > 0 && activeSessionRef.current?.session?.id === sessionId && !activeDiffFile) {
          setActiveDiffFile(diffs[0].file);
        }
        return diffs;
      } catch (err: any) {
        console.warn('Failed to fetch session diff:', err.message);
        return [];
      }
    },
    [deviceTokens, sendRpc, activeDiffFile, updateSessionRuntime]
  );
  fetchSessionDiffRef.current = fetchSessionDiff;

  const fetchWorkspace = useCallback(
    async (deviceId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) return null;
      const msg = createMessage('WORKSPACE_GET', {
        deviceId,
        deviceToken: token,
      });
      try {
        const res = await sendRpc<{ project?: ProjectContext }>(msg);
        if (res.project) {
          setProjectContext(res.project);
        }
        return res.project || null;
      } catch (err: any) {
        console.warn('Failed to fetch workspace:', err.message);
        return null;
      }
    },
    [deviceTokens, sendRpc]
  );

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionState(reconnectAttemptRef.current > 0 ? 'RECONNECTING' : 'CONNECTING');
    setLastError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) return;
        reconnectAttemptRef.current = 0;
        setConnectionState('CONNECTED');

        // Send CLIENT_HELLO
        const clientId = `client_${Math.random().toString(36).slice(2, 9)}`;
        const hello = createMessage('CLIENT_HELLO', {
          clientId,
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: deviceTokensRef.current,
        });
        ws.send(JSON.stringify(hello));

        // Request device status
        ws.send(JSON.stringify(createMessage('DEVICE_STATUS_REQUEST', {})));
      };

      ws.onmessage = (event) => {
        if (isUnmountedRef.current) return;
        try {
          const msg: ProtocolMessage = parseProtocolMessage(event.data);

          // Check if pending RPC request matches
          if (pendingRequests.current.has(msg.id)) {
            const resolver = pendingRequests.current.get(msg.id);
            pendingRequests.current.delete(msg.id);
            if (resolver) resolver(msg.payload);
          }

          switch (msg.type) {
            case 'DEVICE_STATUS_RESULT': {
              setDevices(msg.payload.devices);
              if (!selectedDeviceId && msg.payload.devices.length > 0) {
                setSelectedDeviceId(msg.payload.devices[0].deviceId);
              }
              break;
            }

            case 'DEVICE_STATUS': {
              const updated = msg.payload;
              setDevices((prev) => {
                const idx = prev.findIndex((d) => d.deviceId === updated.deviceId);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...updated };
                  return copy;
                }
                return [...prev, updated];
              });
              break;
            }

            case 'OPENCODE_STATUS': {
              const { deviceId, status, version } = msg.payload;
              setDevices((prev) =>
                prev.map((d) =>
                  d.deviceId === deviceId
                    ? {
                        ...d,
                        opencodeStatus: status,
                        opencodeVersion: version || d.opencodeVersion,
                      }
                    : d
                )
              );
              break;
            }

            case 'PAIRING_COMPLETE': {
              const { deviceId, deviceToken } = msg.payload;
              saveDeviceToken(deviceId, deviceToken);
              setDevices((prev) =>
                prev.map((d) => (d.deviceId === deviceId ? { ...d, paired: true } : d))
              );
              if (pairingPromiseRef.current) {
                clearTimeout(pairingPromiseRef.current.timer);
                pairingPromiseRef.current.resolve({
                  success: true,
                  status: 'approved',
                  message: 'Computer successfully paired!',
                });
                pairingPromiseRef.current = null;
              }
              break;
            }

            case 'SESSION_LIST_RESULT': {
              setSessions(msg.payload.sessions);
              break;
            }

            case 'SESSION_GET_RESULT': {
              const session = msg.payload.session;
              const messages = msg.payload.messages;
              if (!session) break;

              // Stale response guard: Ignore if user switched to another session while this was in flight
              if (latestRequestedSessionIdRef.current && session.id !== latestRequestedSessionIdRef.current) {
                console.warn(
                  `[useRelay] Ignored stale SESSION_GET_RESULT for ${session.id} (current target: ${latestRequestedSessionIdRef.current})`
                );
                break;
              }

              setActiveSession({
                session,
                messages,
              });
              break;
            }

            case 'SESSION_DIFF_GET_RESULT': {
              const { sessionId, diffs } = msg.payload;
              if (sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  diffs: diffs || [],
                }));
              }
              if (diffs && diffs.length > 0 && activeSessionRef.current?.session?.id === sessionId) {
                setActiveDiffFile((prev) => prev || diffs[0].file);
              }
              break;
            }

            case 'WORKSPACE_GET_RESULT': {
              if (msg.payload.project) {
                setProjectContext(msg.payload.project);
              }
              break;
            }

            case 'TODO_UPDATED': {
              const { sessionId, todos: newTodos } = msg.payload;
              if (sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  todos: newTodos || [],
                }));
              }
              break;
            }

            case 'SESSION_DIFF_UPDATED': {
              const { sessionId, diff } = msg.payload;
              if (sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  diffs: diff || [],
                }));
              }
              break;
            }

            case 'MESSAGE_STARTED': {
              const { sessionId, messageId, timestamp } = msg.payload;
              if (!sessionId) break;

              updateSessionRuntime(sessionId, (prev) => ({
                ...prev,
                isStreaming: true,
                isWaitingForResponse: false,
                streamingText: '',
                activeMessageId: messageId,
                error: null,
              }));

              const buf = sessionDeltaBuffersRef.current.get(sessionId);
              if (buf?.rafId !== null && buf?.rafId !== undefined) {
                cancelAnimationFrame(buf.rafId);
              }
              sessionDeltaBuffersRef.current.set(sessionId, {
                deltaText: '',
                messageId,
                rafId: null,
              });

              if (activeSessionRef.current?.session?.id === sessionId) {
                setActiveSession((curr) => {
                  if (!curr || curr.session.id !== sessionId) return curr;
                  const exists = curr.messages.some((m) => m.id === messageId);
                  if (exists) return curr;
                  return {
                    ...curr,
                    messages: [
                      ...curr.messages,
                      {
                        id: messageId,
                        sessionId,
                        role: 'assistant',
                        content: '',
                        parts: [],
                        createdAt: timestamp || Date.now(),
                      },
                    ],
                  };
                });
              }
              break;
            }

            case 'MESSAGE_DELTA': {
              const { delta, messageId, sessionId } = msg.payload;
              if (!sessionId) break;

              let buf = sessionDeltaBuffersRef.current.get(sessionId);
              if (!buf) {
                buf = { deltaText: '', messageId, rafId: null };
                sessionDeltaBuffersRef.current.set(sessionId, buf);
              }
              buf.deltaText += delta;
              buf.messageId = messageId;

              if (buf.rafId === null) {
                buf.rafId = requestAnimationFrame(() => {
                  const sBuf = sessionDeltaBuffersRef.current.get(sessionId);
                  if (!sBuf) return;
                  const flushedText = sBuf.deltaText;
                  const bMsgId = sBuf.messageId;
                  sBuf.deltaText = '';
                  sBuf.rafId = null;

                  if (!flushedText) return;

                  updateSessionRuntime(sessionId, (prev) => ({
                    ...prev,
                    isStreaming: true,
                    isWaitingForResponse: false,
                    streamingText: prev.streamingText + flushedText,
                  }));

                  if (activeSessionRef.current?.session?.id === sessionId) {
                    setActiveSession((curr) => {
                      if (!curr || curr.session.id !== sessionId) return curr;
                      const msgs = [...curr.messages];
                      const mIdx = msgs.findIndex((m) => m.id === bMsgId);
                      if (mIdx >= 0) {
                        const targetMsg = msgs[mIdx];
                        const newContent = (targetMsg.content || '') + flushedText;
                        msgs[mIdx] = { ...targetMsg, content: newContent };
                        return { ...curr, messages: msgs };
                      }
                      return curr;
                    });
                  }
                });
              }
              break;
            }

            case 'MESSAGE_COMPLETED': {
              const { sessionId, messageId, totalText } = msg.payload;
              if (!sessionId) break;

              let flushedDelta = '';
              const buf = sessionDeltaBuffersRef.current.get(sessionId);
              if (buf) {
                if (buf.rafId !== null) {
                  cancelAnimationFrame(buf.rafId);
                  buf.rafId = null;
                }
                flushedDelta = buf.deltaText;
                buf.deltaText = '';
              }

              updateSessionRuntime(sessionId, (prev) => ({
                ...prev,
                isStreaming: false,
                isWaitingForResponse: false,
                streamingText: totalText || prev.streamingText + flushedDelta,
              }));

              if (activeSessionRef.current?.session?.id === sessionId) {
                playSound('complete');
                setActiveSession((curr) => {
                  if (!curr || curr.session.id !== sessionId) return curr;
                  const msgs = [...curr.messages];
                  const existingIdx = msgs.findIndex((m) => m.id === messageId);
                  const completedText =
                    totalText || (curr.messages.find((m) => m.id === messageId)?.content || '') + flushedDelta;

                  if (existingIdx >= 0) {
                    msgs[existingIdx] = {
                      ...msgs[existingIdx],
                      content: completedText || msgs[existingIdx].content,
                    };
                    return { ...curr, messages: msgs };
                  }
                  if (completedText) {
                    return {
                      ...curr,
                      messages: [
                        ...msgs,
                        {
                          id: messageId,
                          sessionId,
                          role: 'assistant',
                          content: completedText,
                          createdAt: msg.payload.timestamp || Date.now(),
                        },
                      ],
                    };
                  }
                  return curr;
                });
              }

              // Refresh diffs and todos for the completed session
              if (selectedDeviceRef.current && sessionId) {
                fetchSessionDiffRef.current?.(selectedDeviceRef.current.deviceId, sessionId);
                fetchTodosRef.current?.(selectedDeviceRef.current.deviceId, sessionId);
              }
              break;
            }

            case 'OPENCODE_EVENT': {
              const evt = msg.payload as any;
              const props = evt.payload?.properties || evt.payload?.data || {};

              const eventType = evt.payload?.type || evt.eventType;
              const sessionId = props.sessionID || props.sessionId || evt.payload?.sessionID || evt.payload?.sessionId || evt.sessionID || props.part?.sessionID;

              if (sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  isWaitingForResponse: false,
                }));
              }

              // If todo event arrived inside raw opencode event
              if (eventType === 'todo.updated' && Array.isArray(props.todos) && sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  todos: props.todos,
                }));
              }

              // If diff event arrived inside raw opencode event
              if (eventType === 'session.diff' && Array.isArray(props.diff) && sessionId) {
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  diffs: props.diff,
                }));
              }

              // Handle message.part.updated or message.part
              if ((eventType === 'message.part.updated' || eventType === 'message.part') && props.part) {
                const part = props.part;
                const messageId = props.messageID || props.assistantMessageID;

                // Strictly require matching sessionId so background session parts never leak into active session
                if (sessionId && activeSessionRef.current && activeSessionRef.current.session.id === sessionId) {
                  setActiveSession((curr) => {
                    if (!curr || curr.session.id !== sessionId) return curr;
                    const msgs = [...curr.messages];
                    let mIdx = messageId ? msgs.findIndex((m) => m.id === messageId) : -1;
                    if (mIdx < 0) {
                      const newMsg: SessionMessage = {
                        id: messageId || `msg_${Date.now()}`,
                        sessionId,
                        role: 'assistant',
                        content: '',
                        parts: [part],
                        createdAt: Date.now(),
                      };
                      return { ...curr, messages: [...msgs, newMsg] };
                    }

                    const existingParts = msgs[mIdx].parts || [];
                    const pIdx = existingParts.findIndex(
                      (p) => p.id === part.id || (part.callID && p.callID === part.callID)
                    );
                    const updatedParts =
                      pIdx >= 0
                        ? existingParts.map((p, i) => (i === pIdx ? { ...p, ...part } : p))
                        : [...existingParts, part];
                    msgs[mIdx] = { ...msgs[mIdx], parts: updatedParts };
                    return { ...curr, messages: msgs };
                  });
                }
              }

              // Invalidate diffs if tool finished executing
              if (eventType === 'session.next.tool.success') {
                if (selectedDeviceRef.current && sessionId) {
                  fetchSessionDiffRef.current?.(selectedDeviceRef.current.deviceId, sessionId);
                }
              }
              break;
            }

            case 'MESSAGE_ERROR': {
              const { sessionId, error } = msg.payload;
              if (sessionId) {
                const buf = sessionDeltaBuffersRef.current.get(sessionId);
                if (buf?.rafId !== null && buf?.rafId !== undefined) {
                  cancelAnimationFrame(buf.rafId);
                  buf.rafId = null;
                }
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  isStreaming: false,
                  isWaitingForResponse: false,
                  error: error || 'Message error',
                }));
              }
              if (activeSessionRef.current?.session?.id === sessionId) {
                playSound('error');
                setLastError(`Message error: ${error}`);
              }
              break;
            }

            case 'PTY_OUTPUT': {
              const { ptyId, data } = msg.payload;
              const set = ptyDataListeners.current.get(ptyId);
              if (set) {
                set.forEach((cb) => {
                  try { cb(data); } catch {}
                });
              }
              break;
            }

            case 'PTY_CLOSED': {
              const { ptyId } = msg.payload;
              setPtys((prev) => prev.filter((p) => p.id !== ptyId));
              setActivePtyId((curr) => (curr === ptyId ? null : curr));
              break;
            }

            case 'PERMISSION_REQUEST': {
              const perm = msg.payload as any;
              playSound('permission');
              setPermissions((prev) => [...prev.filter((p) => p.id !== perm.id), perm]);
              break;
            }

            case 'ERROR': {
              if (msg.payload.code === 'DEVICE_NOT_AUTHORIZED') {
                if (selectedDeviceId) {
                  removeDeviceToken(selectedDeviceId);
                }
                setLastError('Device authorization expired or not paired. Please enter the pairing code.');
              } else {
                setLastError(`[${msg.payload.code}] ${msg.payload.message}`);
              }
              if (msg.payload.requestId && pendingRequests.current.has(msg.payload.requestId)) {
                const resolver = pendingRequests.current.get(msg.payload.requestId);
                pendingRequests.current.delete(msg.payload.requestId);
                if (resolver) resolver(null, true, msg.payload.message);
              }
              break;
            }

            default:
              break;
          }
        } catch (err: any) {
          console.warn('[pwa] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        if (isUnmountedRef.current) return;
        setConnectionState('RECONNECTING');

        reconnectAttemptRef.current++;
        const delay = Math.min(10000, 1000 * Math.pow(1.5, reconnectAttemptRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // handled in onclose
      };
    } catch (err: any) {
      setLastError(err.message);
      setConnectionState('DISCONNECTED');
    }
  }, [url, saveDeviceToken]);

  // Pairing API
  const pairDevice = useCallback(
    async (code: string, clientName: string = 'Android Phone') => {
      const cleanCode = code.trim().replace(/\s+/g, '').toUpperCase();
      const msg = createMessage('PAIRING_REQUEST', { code: cleanCode, clientName });

      let completionResolver: ((val: { success: boolean; status?: string; message?: string }) => void) | null = null;
      const completionPromise = new Promise<{ success: boolean; status?: string; message?: string }>((resolve) => {
        completionResolver = resolve;
      });

      const timer = window.setTimeout(() => {
        if (pairingPromiseRef.current?.resolve === completionResolver) {
          pairingPromiseRef.current = null;
        }
        completionResolver?.({
          success: false,
          status: 'timeout',
          message: 'Pairing approval timed out. Please check your PC terminal.',
        });
      }, 15000);

      pairingPromiseRef.current = {
        resolve: (val) => {
          clearTimeout(timer);
          completionResolver?.(val);
        },
        timer,
      };

      try {
        const res = await sendRpc<{ success: boolean; status: string; message?: string }>(msg);
        if (!res.success) {
          clearTimeout(timer);
          pairingPromiseRef.current = null;
          return {
            success: false,
            status: res.status || 'failed',
            message: res.message || 'Invalid or expired pairing code',
          };
        }
        // Wait for agent to approve and send PAIRING_COMPLETE
        return await completionPromise;
      } catch (err: any) {
        clearTimeout(timer);
        pairingPromiseRef.current = null;
        throw err;
      }
    },
    [sendRpc]
  );

  const revokeDevice = useCallback(
    async (deviceId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) return false;

      const msg = createMessage('DEVICE_REVOKE', { deviceId, deviceToken: token });
      try {
        const res = await sendRpc<{ success: boolean }>(msg);
        if (res.success) {
          removeDeviceToken(deviceId);
          setDevices((prev) =>
            prev.map((d) => (d.deviceId === deviceId ? { ...d, paired: false } : d))
          );
        }
        return res.success;
      } catch {
        return false;
      }
    },
    [deviceTokens, removeDeviceToken, sendRpc]
  );

  // Sessions API
  const fetchSessions = useCallback(
    async (deviceId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) {
        setSessions([]);
        return [];
      }
      const msg = createMessage('SESSION_LIST', {
        deviceId,
        deviceToken: token,
      });
      try {
        const res = await sendRpc<{ sessions: OpenCodeSession[] }>(msg);
        setSessions(res.sessions || []);
        return res.sessions;
      } catch (err: any) {
        if (!err.message?.includes('invalid or revoked')) {
          setLastError(err.message);
        }
        return [];
      }
    },
    [deviceTokens, sendRpc]
  );

  const createSession = useCallback(
    async (deviceId: string, title?: string) => {
      const msg = createMessage('SESSION_CREATE', {
        deviceId,
        title,
        deviceToken: deviceTokens[deviceId],
      });
      const res = await sendRpc<{ session: OpenCodeSession }>(msg);
      if (res.session) {
        latestRequestedSessionIdRef.current = res.session.id;
        updateSessionRuntime(res.session.id, () => createInitialSessionRuntime());
        setSessions((prev) => [res.session, ...prev]);
        setActiveSession({ session: res.session, messages: [] });
        setActiveDiffFile(null);
        setActiveTab('chat');
      }
      return res.session;
    },
    [deviceTokens, sendRpc, updateSessionRuntime]
  );

  const fetchTodos = useCallback(
    async (deviceId: string, sessionId: string) => {
      const token = deviceTokens[deviceId];
      if (!token || !sessionId) return;
      try {
        const res = await sendRpc<TodoListResultPayload>(
          createMessage('TODO_LIST_REQUEST', {
            deviceId,
            sessionId,
            deviceToken: token,
          })
        );
        if (res?.todos && sessionId) {
          updateSessionRuntime(sessionId, (prev) => ({
            ...prev,
            todos: res.todos || [],
          }));
        }
      } catch (err: any) {
        console.warn('Failed to fetch todos:', err.message);
      }
    },
    [deviceTokens, sendRpc, updateSessionRuntime]
  );

  useEffect(() => {
    fetchTodosRef.current = fetchTodos;
  }, [fetchTodos]);

  const openSession = useCallback(
    async (deviceId: string, sessionId: string) => {
      latestRequestedSessionIdRef.current = sessionId;
      setIsLoadingSession(true);
      setLoadingSessionId(sessionId);
      try {
        const msg = createMessage('SESSION_GET', {
          deviceId,
          sessionId,
          deviceToken: deviceTokens[deviceId],
        });
        const res = await sendRpc<{ session: OpenCodeSession; messages: SessionMessage[] }>(msg);
        if (res.session && latestRequestedSessionIdRef.current === sessionId) {
          setActiveSession(res);
          // Pre-fetch diffs, workspace context, and todos
          fetchSessionDiff(deviceId, sessionId);
          fetchWorkspace(deviceId);
          fetchTodos(deviceId, sessionId);
        }
        return res;
      } finally {
        if (latestRequestedSessionIdRef.current === sessionId) {
          setIsLoadingSession(false);
          setLoadingSessionId(null);
        }
      }
    },
    [deviceTokens, sendRpc, fetchSessionDiff, fetchWorkspace, fetchTodos]
  );

  const sendDirectMessage = useCallback(
    (
      deviceId: string,
      sessionId: string,
      content: string,
      model?: { providerID: string; modelID: string }
    ) => {
      if (!content.trim()) return;

      updateSessionRuntime(sessionId, (prev) => ({
        ...prev,
        isWaitingForResponse: true,
        error: null,
      }));
      const userMsg: SessionMessage = {
        id: `user_${Date.now()}`,
        sessionId,
        role: 'user',
        content,
        createdAt: Date.now(),
      };
      setActiveSession((curr) => {
        if (!curr) return null;
        return {
          ...curr,
          messages: [...curr.messages, userMsg],
        };
      });

      const token = deviceTokensRef.current[deviceId] || deviceTokens[deviceId];
      const msg = createMessage('MESSAGE_SEND', {
        deviceId,
        sessionId,
        content,
        deviceToken: token,
        model,
      });

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [deviceTokens]
  );

  const sessionStreamingStatus = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const [sId, rt] of Object.entries(sessionRuntime)) {
      map[sId] = rt.isStreaming;
    }
    return map;
  }, [sessionRuntime]);

  const {
    currentQueue: queuedMessages,
    editingItem: editingQueueItem,
    setEditingItem: setEditingQueueItem,
    enqueue: enqueueMessage,
    edit: editQueuedMessage,
    remove: deleteQueuedMessage,
    sendNow: sendQueuedMessageNow,
    retry: retryQueuedMessage,
    clear: clearQueue,
  } = useMessageQueue({
    activeSessionId: activeSession?.session.id,
    selectedDeviceId: selectedDevice?.deviceId,
    isStreaming,
    sessionStreamingStatus,
    onSendMessage: sendDirectMessage,
  });

  const sendMessage = useCallback(
    (
      deviceId: string,
      sessionId: string,
      content: string,
      model?: { providerID: string; modelID: string }
    ) => {
      if (!content.trim()) return;
      const targetIsStreaming = sessionRuntime[sessionId]?.isStreaming ?? false;
      if (targetIsStreaming) {
        enqueueMessage(sessionId, content, model);
        return;
      }
      sendDirectMessage(deviceId, sessionId, content, model);
    },
    [sessionRuntime, enqueueMessage, sendDirectMessage]
  );

  // ==========================================
  // PTY Operations
  // ==========================================
  const fetchPtys = useCallback(async () => {
    if (!selectedDevice) return;
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    if (!token) {
      setPtys([]);
      return;
    }
    try {
      const res = await sendRpc<PtyListResultPayload>(
        createMessage('PTY_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      setPtys(res.ptys || []);
      if (res.ptys && res.ptys.length > 0 && !activePtyId) {
        setActivePtyId(res.ptys[0].id);
      }
    } catch (err: any) {
      console.warn('Failed to list PTYs:', err.message);
    }
  }, [selectedDevice, sendRpc, activePtyId]);

  const createPty = useCallback(
    async (title?: string, command?: string, cwd?: string): Promise<PtySession | null> => {
      if (!selectedDevice) return null;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<PtyCreateResultPayload>(
          createMessage('PTY_CREATE', {
            deviceId: selectedDevice.deviceId,
            deviceToken: token,
            title: title || 'Terminal',
            command,
            cwd,
          })
        );
        if (res.pty) {
          setPtys((prev) => [...prev.filter((p) => p.id !== res.pty.id), res.pty]);
          setActivePtyId(res.pty.id);
          return res.pty;
        }
      } catch (err: any) {
        setLastError(`Failed to launch terminal: ${err.message}`);
      }
      return null;
    },
    [selectedDevice, sendRpc]
  );

  const sendPtyInput = useCallback(
    (ptyId: string, data: string) => {
      if (!selectedDevice || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      const msg = createMessage('PTY_INPUT', {
        deviceId: selectedDevice.deviceId,
        deviceToken: token,
        ptyId,
        data,
      });
      wsRef.current.send(JSON.stringify(msg));
    },
    [selectedDevice]
  );

  const resizePty = useCallback(
    (ptyId: string, cols: number, rows: number) => {
      if (!selectedDevice || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      const msg = createMessage('PTY_RESIZE', {
        deviceId: selectedDevice.deviceId,
        deviceToken: token,
        ptyId,
        cols,
        rows,
      });
      wsRef.current.send(JSON.stringify(msg));
    },
    [selectedDevice]
  );

  const closePty = useCallback(
    async (ptyId: string) => {
      if (!selectedDevice || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      const msg = createMessage('PTY_CLOSE', {
        deviceId: selectedDevice.deviceId,
        deviceToken: token,
        ptyId,
      });
      wsRef.current.send(JSON.stringify(msg));
      setPtys((prev) => prev.filter((p) => p.id !== ptyId));
      setActivePtyId((curr) => (curr === ptyId ? null : curr));
    },
    [selectedDevice]
  );

  const subscribePtyData = useCallback((ptyId: string, cb: (data: string) => void) => {
    if (!ptyDataListeners.current.has(ptyId)) {
      ptyDataListeners.current.set(ptyId, new Set());
    }
    ptyDataListeners.current.get(ptyId)!.add(cb);
    return () => {
      ptyDataListeners.current.get(ptyId)?.delete(cb);
    };
  }, []);

  // ==========================================
  // Session Abort
  // ==========================================
  const abortActiveSession = useCallback(async (): Promise<boolean> => {
    if (!selectedDevice || !activeSession) return false;
    const sId = activeSession.session.id;
    const token = deviceTokensRef.current[selectedDevice.deviceId];

    const buf = sessionDeltaBuffersRef.current.get(sId);
    if (buf?.rafId !== null && buf?.rafId !== undefined) {
      cancelAnimationFrame(buf.rafId);
      buf.rafId = null;
    }
    if (buf) buf.deltaText = '';

    updateSessionRuntime(sId, (prev) => ({
      ...prev,
      isStreaming: false,
      isWaitingForResponse: false,
      streamingText: '',
    }));

    try {
      const res = await sendRpc<SessionAbortResultPayload>(
        createMessage('SESSION_ABORT', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
          sessionId: sId,
        })
      );
      return res.success;
    } catch {
      return false;
    }
  }, [selectedDevice, activeSession, sendRpc, updateSessionRuntime]);

  // ==========================================
  // Providers & Models
  // ==========================================
  const fetchModels = useCallback(async () => {
    if (!selectedDevice) return;
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    if (!token) {
      setModels([]);
      return;
    }
    try {
      const res = await sendRpc<ModelListResultPayload>(
        createMessage('MODEL_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      setModels(res.models || []);
      if (res.defaultModel && !selectedModel) {
        setSelectedModel(res.defaultModel);
      }
    } catch (err: any) {
      console.warn('Failed to fetch models:', err.message);
    }
  }, [selectedDevice, sendRpc, selectedModel]);

  // ==========================================
  // Interactive Permissions
  // ==========================================
  const fetchPermissions = useCallback(async () => {
    if (!selectedDevice) return;
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    if (!token) {
      setPermissions([]);
      return;
    }
    try {
      const res = await sendRpc<PermissionListResultPayload>(
        createMessage('PERMISSION_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      setPermissions(res.permissions || []);
    } catch (err: any) {
      console.warn('Failed to fetch permissions:', err.message);
    }
  }, [selectedDevice, sendRpc]);

  const replyPermission = useCallback(
    async (requestId: string, reply: 'allow' | 'deny'): Promise<boolean> => {
      if (!selectedDevice) return false;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<PermissionReplyResultPayload>(
          createMessage('PERMISSION_REPLY', {
            deviceId: selectedDevice.deviceId,
            deviceToken: token,
            requestId,
            reply,
          })
        );
        setPermissions((prev) => prev.filter((p) => p.id !== requestId));
        return res.success;
      } catch {
        return false;
      }
    },
    [selectedDevice, sendRpc]
  );

  const activePermissions = useMemo(() => {
    const currentId = activeSession?.session?.id;
    if (!currentId) return [];
    return permissions.filter((p) => !(p as any).sessionId || (p as any).sessionId === currentId);
  }, [permissions, activeSession?.session?.id]);

  // ==========================================
  // Phase 1 Modernization: Telemetry & Actions
  // ==========================================
  const sessionTelemetry = useMemo<SessionTelemetry | null>(() => {
    if (!activeSession || !activeSession.messages || activeSession.messages.length === 0) {
      return null;
    }

    let lastWithTokens: SessionMessage | undefined;
    let totalCost = 0;

    for (let i = activeSession.messages.length - 1; i >= 0; i--) {
      const m = activeSession.messages[i];
      if (typeof m.cost === 'number' && m.cost > 0) {
        totalCost += m.cost;
      }
      if (!lastWithTokens && m.role === 'assistant' && m.tokens) {
        const sum =
          (m.tokens.input || 0) +
          (m.tokens.output || 0) +
          (m.tokens.reasoning || 0) +
          (m.tokens.cache?.read || 0) +
          (m.tokens.cache?.write || 0);
        if (sum > 0) {
          lastWithTokens = m;
        }
      }
    }

    if (!lastWithTokens || !lastWithTokens.tokens) {
      return null;
    }

    const t = lastWithTokens.tokens;
    const inputTokens = t.input || 0;
    const outputTokens = t.output || 0;
    const reasoningTokens = t.reasoning || 0;
    const cacheReadTokens = t.cache?.read || 0;
    const cacheWriteTokens = t.cache?.write || 0;
    const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;

    // Resolve context limit
    const modelId = lastWithTokens.modelID || selectedModel?.modelID;
    const matchedModel = models.find((m) => m.id === modelId);
    const contextLimit = matchedModel?.contextLimit || 200000;
    const usagePercent = contextLimit ? Math.round((totalTokens / contextLimit) * 100) : null;

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalCost,
      contextLimit,
      usagePercent,
      providerLabel: matchedModel?.providerName || lastWithTokens.providerID,
      modelLabel: matchedModel?.name || modelId,
    };
  }, [activeSession, models, selectedModel]);

  const forkSession = useCallback(
    async (messageId?: string): Promise<OpenCodeSession | null> => {
      if (!selectedDevice || !activeSession) return null;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<SessionForkResultPayload>(
          createMessage('SESSION_FORK', {
            deviceId: selectedDevice.deviceId,
            sessionId: activeSession.session.id,
            messageId,
            deviceToken: token,
          })
        );
        if (res.session) {
          latestRequestedSessionIdRef.current = res.session.id;
          updateSessionRuntime(res.session.id, () => createInitialSessionRuntime());
          setSessions((prev) => [res.session, ...prev]);
          setActiveSession({ session: res.session, messages: [] });
          setActiveDiffFile(null);
          setActiveTab('chat');
          return res.session;
        }
      } catch (err: any) {
        setLastError(`Failed to fork session: ${err.message}`);
      }
      return null;
    },
    [selectedDevice, activeSession, sendRpc, updateSessionRuntime]
  );

  const revertTurn = useCallback(
    async (messageId?: string): Promise<{ success: boolean; revertedPrompt?: string }> => {
      if (!selectedDevice || !activeSession) return { success: false };
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<SessionRevertResultPayload>(
          createMessage('SESSION_REVERT', {
            deviceId: selectedDevice.deviceId,
            sessionId: activeSession.session.id,
            messageId,
            deviceToken: token,
          })
        );
        if (res.success) {
          await openSession(selectedDevice.deviceId, activeSession.session.id);
        }
        return res;
      } catch (err: any) {
        setLastError(`Failed to revert turn: ${err.message}`);
        return { success: false };
      }
    },
    [selectedDevice, activeSession, sendRpc, openSession]
  );

  const compactSession = useCallback(
    async (): Promise<boolean> => {
      if (!selectedDevice || !activeSession) return false;
      try {
        await sendMessage(selectedDevice.deviceId, activeSession.session.id, '/compact');
        return true;
      } catch (err: any) {
        setLastError(`Failed to compact session: ${err.message}`);
        return false;
      }
    },
    [selectedDevice, activeSession, sendMessage]
  );

  const replyQuestion = useCallback(
    async (requestId: string, answers: string[][]): Promise<boolean> => {
      if (!selectedDevice || !activeSession) return false;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<QuestionReplyResultPayload>(
          createMessage('QUESTION_REPLY', {
            deviceId: selectedDevice.deviceId,
            sessionId: activeSession.session.id,
            requestId,
            answers,
            deviceToken: token,
          })
        );
        return res.success;
      } catch (err: any) {
        console.warn('Failed to reply question:', err.message);
        return false;
      }
    },
    [selectedDevice, activeSession, sendRpc]
  );

  const listFs = useCallback(
    async (path?: string): Promise<FsEntry[]> => {
      if (!selectedDevice) return [];
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<FsListResultPayload>(
          createMessage('FS_LIST', {
            deviceId: selectedDevice.deviceId,
            path,
            deviceToken: token,
          })
        );
        return res.entries || [];
      } catch (err: any) {
        console.warn('Failed to list files:', err.message);
        return [];
      }
    },
    [selectedDevice, sendRpc]
  );

  const findFs = useCallback(
    async (query: string, limit: number = 30): Promise<FsEntry[]> => {
      if (!selectedDevice) return [];
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<FsFindResultPayload>(
          createMessage('FS_FIND', {
            deviceId: selectedDevice.deviceId,
            query,
            limit,
            deviceToken: token,
          })
        );
        return res.entries || [];
      } catch (err: any) {
        console.warn('Failed to find files:', err.message);
        return [];
      }
    },
    [selectedDevice, sendRpc]
  );

  const readFs = useCallback(
    async (path: string): Promise<{ content: string; mime?: string } | null> => {
      if (!selectedDevice) return null;
      const token = deviceTokensRef.current[selectedDevice.deviceId];
      try {
        const res = await sendRpc<FsReadResultPayload>(
          createMessage('FS_READ', {
            deviceId: selectedDevice.deviceId,
            path,
            deviceToken: token,
          })
        );
        return {
          content: res.content,
          mime: res.mime,
        };
      } catch (err: any) {
        console.warn('Failed to read file:', err.message);
        return null;
      }
    },
    [selectedDevice, sendRpc]
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return {
    connectionState,
    devices: computedDevices,
    selectedDevice,
    selectedDeviceId,
    setSelectedDeviceId,
    sessions,
    activeSession,
    projectContext,
    sessionDiffs,
    activeDiffFile,
    setActiveDiffFile,
    activeTab,
    setActiveTab,
    streamingText,
    isStreaming,
    isWaitingForResponse,
    isLoadingSession,
    loadingSessionId,
    lastError,
    deviceTokens,
    pairDevice,
    revokeDevice,
    fetchSessions,
    createSession,
    openSession,
    sendMessage,
    fetchSessionDiff,
    fetchWorkspace,
    // Phase 3 Additions
    ptys,
    activePtyId,
    setActivePtyId,
    fetchPtys,
    createPty,
    sendPtyInput,
    resizePty,
    closePty,
    subscribePtyData,
    abortActiveSession,
    models,
    selectedModel,
    setSelectedModel,
    fetchModels,
    permissions: activePermissions,
    fetchPermissions,
    replyPermission,
    todos,
    // Phase 1 Modernization: Telemetry & Actions
    sessionTelemetry,
    forkSession,
    revertTurn,
    compactSession,
    replyQuestion,
    // Phase 2, 3, 4: Files, Modes & Context
    interactionMode,
    setInteractionMode,
    listFs,
    findFs,
    readFs,
    // Queue
    queuedMessages,
    editingQueueItem,
    setEditingQueueItem,
    enqueueMessage,
    editQueuedMessage,
    deleteQueuedMessage,
    sendQueuedMessageNow,
    retryQueuedMessage,
    clearQueue,
    closeActiveSession: () => {
      latestRequestedSessionIdRef.current = null;
      setActiveSession(null);
      setActiveDiffFile(null);
      setActiveTab('chat');
      setEditingQueueItem(null);
    },
    refreshDevices: () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(createMessage('DEVICE_STATUS_REQUEST', {})));
      }
    },
    clearError: () => setLastError(null),
    reconnect: connect,
  };
}
