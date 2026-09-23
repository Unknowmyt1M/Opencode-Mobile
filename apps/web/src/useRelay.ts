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
} from '@opencode-remote/protocol';
import { useMessageQueue } from './hooks/useMessageQueue';

export type WorkspaceTab = 'chat' | 'review' | 'terminal' | 'activity' | 'files' | 'diff';

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
  const [sessionDiffs, setSessionDiffs] = useState<SnapshotFileDiff[]>([]);
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');

  // Phase 3 Extensions: PTY Terminal, Model Selector, Permissions
  const [ptys, setPtys] = useState<PtySession[]>([]);
  const [activePtyId, setActivePtyId] = useState<string | null>(null);
  const ptyDataListeners = useRef<Map<string, Set<(data: string) => void>>>(new Map());

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; modelID: string } | null>(null);

  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const fetchTodosRef = useRef<((deviceId: string, sessionId: string) => void) | null>(null);

  const [streamingText, setStreamingText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState<boolean>(false);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const deltaBufferRef = useRef<{
    deltaText: string;
    messageId: string;
    sessionId: string;
    rafId: number | null;
  }>({ deltaText: '', messageId: '', sessionId: '', rafId: null });

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
        setSessionDiffs(diffs);
        if (diffs.length > 0 && !activeDiffFile) {
          setActiveDiffFile(diffs[0].file);
        }
        return diffs;
      } catch (err: any) {
        console.warn('Failed to fetch session diff:', err.message);
        return [];
      }
    },
    [deviceTokens, sendRpc, activeDiffFile]
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
              setActiveSession({
                session: msg.payload.session,
                messages: msg.payload.messages,
              });
              break;
            }

            case 'SESSION_DIFF_GET_RESULT': {
              setSessionDiffs(msg.payload.diffs || []);
              if (msg.payload.diffs && msg.payload.diffs.length > 0) {
                setActiveDiffFile((prev) => prev || msg.payload.diffs[0].file);
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
              if (msg.payload.sessionId === activeSession?.session?.id) {
                setTodos(msg.payload.todos || []);
              }
              break;
            }

            case 'SESSION_DIFF_UPDATED': {
              if (msg.payload.sessionId === activeSession?.session?.id) {
                setSessionDiffs(msg.payload.diff || []);
              }
              break;
            }

            case 'MESSAGE_STARTED': {
              setIsStreaming(true);
              setIsWaitingForResponse(false);
              setStreamingText('');
              if (deltaBufferRef.current.rafId !== null) {
                cancelAnimationFrame(deltaBufferRef.current.rafId);
                deltaBufferRef.current.rafId = null;
              }
              deltaBufferRef.current.deltaText = '';
              const messageId = msg.payload.messageId;
              const sessionId = msg.payload.sessionId;
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
                      createdAt: msg.payload.timestamp || Date.now(),
                    },
                  ],
                };
              });
              break;
            }

            case 'MESSAGE_DELTA': {
              setIsStreaming(true);
              setIsWaitingForResponse(false);
              const { delta, messageId, sessionId } = msg.payload;
              deltaBufferRef.current.deltaText += delta;
              deltaBufferRef.current.messageId = messageId;
              deltaBufferRef.current.sessionId = sessionId;

              if (deltaBufferRef.current.rafId === null) {
                deltaBufferRef.current.rafId = requestAnimationFrame(() => {
                  const { deltaText, messageId: bMsgId, sessionId: bSessId } = deltaBufferRef.current;
                  deltaBufferRef.current.deltaText = '';
                  deltaBufferRef.current.rafId = null;

                  if (!deltaText) return;

                  setStreamingText((prev) => prev + deltaText);
                  setActiveSession((curr) => {
                    if (!curr || curr.session.id !== bSessId) return curr;
                    const msgs = [...curr.messages];
                    const mIdx = msgs.findIndex((m) => m.id === bMsgId);
                    if (mIdx >= 0) {
                      const targetMsg = msgs[mIdx];
                      const newContent = (targetMsg.content || '') + deltaText;
                      msgs[mIdx] = { ...targetMsg, content: newContent };
                      return { ...curr, messages: msgs };
                    }
                    return curr;
                  });
                });
              }
              break;
            }

            case 'MESSAGE_COMPLETED': {
              setIsStreaming(false);
              setIsWaitingForResponse(false);
              if (deltaBufferRef.current.rafId !== null) {
                cancelAnimationFrame(deltaBufferRef.current.rafId);
                deltaBufferRef.current.rafId = null;
              }
              deltaBufferRef.current.deltaText = '';
              const totalText = msg.payload.totalText;
              setStreamingText((final) => {
                const completedText = totalText || final;
                setActiveSession((curr) => {
                  if (!curr) return null;
                  const msgs = [...curr.messages];
                  const existingIdx = msgs.findIndex((m) => m.id === msg.payload.messageId);
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
                          id: msg.payload.messageId,
                          sessionId: msg.payload.sessionId,
                          role: 'assistant',
                          content: completedText,
                          createdAt: msg.payload.timestamp || Date.now(),
                        },
                      ],
                    };
                  }
                  return curr;
                });
                return '';
              });
              // Refresh diffs and todos after completion of assistant turn
              if (selectedDeviceRef.current && msg.payload.sessionId) {
                fetchSessionDiffRef.current?.(selectedDeviceRef.current.deviceId, msg.payload.sessionId);
                fetchTodosRef.current?.(selectedDeviceRef.current.deviceId, msg.payload.sessionId);
              }
              break;
            }

            case 'OPENCODE_EVENT': {
              // Handle incoming OpenCode events for live tool parts & activities
              setIsWaitingForResponse(false);
              const evt = msg.payload as any;
              const props = evt.payload?.properties || evt.payload?.data || {};

              const eventType = evt.payload?.type || evt.eventType;
              const sessionId = props.sessionID || evt.payload?.sessionID;

              // If todo event arrived inside raw opencode event
              if (eventType === 'todo.updated' && Array.isArray(props.todos)) {
                if (sessionId === activeSession?.session?.id) {
                  setTodos(props.todos);
                }
              }

              // If diff event arrived inside raw opencode event
              if (eventType === 'session.diff' && Array.isArray(props.diff)) {
                if (sessionId === activeSession?.session?.id) {
                  setSessionDiffs(props.diff);
                }
              }

              // Handle message.part.updated or message.part
              if ((eventType === 'message.part.updated' || eventType === 'message.part') && props.part) {
                const part = props.part;
                const messageId = props.messageID || props.assistantMessageID;

                setActiveSession((curr) => {
                  if (!curr) return null;
                  const msgs = [...curr.messages];
                  let mIdx = messageId ? msgs.findIndex((m) => m.id === messageId) : -1;
                  // If messageId not found, create or update active assistant message so parts are never dropped
                  if (mIdx < 0) {
                    const newMsg: SessionMessage = {
                      id: messageId || `msg_${Date.now()}`,
                      sessionId: sessionId || curr.session.id,
                      role: 'assistant',
                      content: '',
                      parts: [part],
                      createdAt: Date.now(),
                    };
                    return { ...curr, messages: [...msgs, newMsg] };
                  }

                  const existingParts = msgs[mIdx].parts || [];
                  const pIdx = existingParts.findIndex((p) => p.id === part.id || (part.callID && p.callID === part.callID));
                  const updatedParts = pIdx >= 0
                    ? existingParts.map((p, i) => (i === pIdx ? { ...p, ...part } : p))
                    : [...existingParts, part];
                  msgs[mIdx] = { ...msgs[mIdx], parts: updatedParts };
                  return { ...curr, messages: msgs };
                });
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
              setIsStreaming(false);
              setIsWaitingForResponse(false);
              if (deltaBufferRef.current.rafId !== null) {
                cancelAnimationFrame(deltaBufferRef.current.rafId);
                deltaBufferRef.current.rafId = null;
              }
              deltaBufferRef.current.deltaText = '';
              setLastError(`Message error: ${msg.payload.error}`);
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
        setSessions((prev) => [res.session, ...prev]);
        setActiveSession({ session: res.session, messages: [] });
        setSessionDiffs([]);
        setActiveTab('chat');
      }
      return res.session;
    },
    [deviceTokens, sendRpc]
  );

  const fetchTodos = useCallback(
    async (deviceId: string, sessionId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) return;
      try {
        const res = await sendRpc<TodoListResultPayload>(
          createMessage('TODO_LIST_REQUEST', {
            deviceId,
            sessionId,
            deviceToken: token,
          })
        );
        if (res?.todos) {
          setTodos(res.todos);
        }
      } catch (err: any) {
        console.warn('Failed to fetch todos:', err.message);
      }
    },
    [deviceTokens, sendRpc]
  );

  useEffect(() => {
    fetchTodosRef.current = fetchTodos;
  }, [fetchTodos]);

  const openSession = useCallback(
    async (deviceId: string, sessionId: string) => {
      setIsLoadingSession(true);
      setLoadingSessionId(sessionId);
      try {
        const msg = createMessage('SESSION_GET', {
          deviceId,
          sessionId,
          deviceToken: deviceTokens[deviceId],
        });
        const res = await sendRpc<{ session: OpenCodeSession; messages: SessionMessage[] }>(msg);
        if (res.session) {
          setActiveSession(res);
          // Pre-fetch diffs, workspace context, and todos
          fetchSessionDiff(deviceId, sessionId);
          fetchWorkspace(deviceId);
          fetchTodos(deviceId, sessionId);
        }
        return res;
      } finally {
        setIsLoadingSession(false);
        setLoadingSessionId(null);
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

      setIsWaitingForResponse(true);
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
      if (isStreaming) {
        enqueueMessage(sessionId, content, model);
        return;
      }
      sendDirectMessage(deviceId, sessionId, content, model);
    },
    [isStreaming, enqueueMessage, sendDirectMessage]
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
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    try {
      const res = await sendRpc<SessionAbortResultPayload>(
        createMessage('SESSION_ABORT', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
          sessionId: activeSession.session.id,
        })
      );
      if (deltaBufferRef.current.rafId !== null) {
        cancelAnimationFrame(deltaBufferRef.current.rafId);
        deltaBufferRef.current.rafId = null;
      }
      deltaBufferRef.current.deltaText = '';
      setIsStreaming(false);
      setIsWaitingForResponse(false);
      return res.success;
    } catch {
      if (deltaBufferRef.current.rafId !== null) {
        cancelAnimationFrame(deltaBufferRef.current.rafId);
        deltaBufferRef.current.rafId = null;
      }
      deltaBufferRef.current.deltaText = '';
      setIsStreaming(false);
      setIsWaitingForResponse(false);
      return false;
    }
  }, [selectedDevice, activeSession, sendRpc]);

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
    permissions,
    fetchPermissions,
    replyPermission,
    todos,
    fetchTodos,
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
      setActiveSession(null);
      setSessionDiffs([]);
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
