import { useState, useEffect, useRef, useCallback } from 'react';
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
} from '@opencode-remote/protocol';

export type WorkspaceTab = 'chat' | 'files' | 'diff' | 'terminal' | 'activity';

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

  const [streamingText, setStreamingText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const pendingRequests = useRef<Map<string, (payload: any) => void>>(new Map());
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

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) || devices[0];

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

        pendingRequests.current.set(message.id, (payload) => {
          clearTimeout(timer);
          resolve(payload as TResult);
        });

        wsRef.current.send(JSON.stringify(message));
      });
    },
    []
  );

  const fetchSessionDiff = useCallback(
    async (deviceId: string, sessionId: string) => {
      const msg = createMessage('SESSION_DIFF_GET', {
        deviceId,
        sessionId,
        deviceToken: deviceTokens[deviceId],
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
      const msg = createMessage('WORKSPACE_GET', {
        deviceId,
        deviceToken: deviceTokens[deviceId],
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

            case 'MESSAGE_STARTED': {
              setIsStreaming(true);
              setStreamingText('');
              break;
            }

            case 'MESSAGE_DELTA': {
              setIsStreaming(true);
              setStreamingText((prev) => prev + msg.payload.delta);
              break;
            }

            case 'MESSAGE_COMPLETED': {
              setIsStreaming(false);
              const totalText = msg.payload.totalText;
              setStreamingText((final) => {
                const completedText = totalText || final;
                if (completedText) {
                  setActiveSession((curr) => {
                    if (!curr) return null;
                    const existingIdx = curr.messages.findIndex((m) => m.id === msg.payload.messageId);
                    if (existingIdx >= 0) {
                      const updatedMsgs = [...curr.messages];
                      updatedMsgs[existingIdx] = {
                        ...updatedMsgs[existingIdx],
                        content: completedText,
                      };
                      return { ...curr, messages: updatedMsgs };
                    }
                    return {
                      ...curr,
                      messages: [
                        ...curr.messages,
                        {
                          id: msg.payload.messageId,
                          sessionId: msg.payload.sessionId,
                          role: 'assistant',
                          content: completedText,
                          createdAt: msg.payload.timestamp || Date.now(),
                        },
                      ],
                    };
                  });
                }
                return '';
              });
              // Refresh diffs after completion of assistant turn
              if (selectedDeviceRef.current && msg.payload.sessionId) {
                fetchSessionDiffRef.current?.(selectedDeviceRef.current.deviceId, msg.payload.sessionId);
              }
              break;
            }

            case 'OPENCODE_EVENT': {
              // Handle incoming OpenCode events for live tool parts & activities
              const evt = msg.payload as any;
              const props = evt.payload?.properties || evt.payload?.data || {};
              const eventType = evt.payload?.type || evt.eventType;

              if (eventType === 'message.part' && props.part) {
                const part = props.part;
                const messageId = props.messageID || props.assistantMessageID;
                if (messageId) {
                  setActiveSession((curr) => {
                    if (!curr) return null;
                    const msgs = [...curr.messages];
                    const mIdx = msgs.findIndex((m) => m.id === messageId);
                    if (mIdx >= 0) {
                      const existingParts = msgs[mIdx].parts || [];
                      const pIdx = existingParts.findIndex((p) => p.id === part.id || (part.callID && p.callID === part.callID));
                      const updatedParts = pIdx >= 0
                        ? existingParts.map((p, i) => (i === pIdx ? { ...p, ...part } : p))
                        : [...existingParts, part];
                      msgs[mIdx] = { ...msgs[mIdx], parts: updatedParts };
                      return { ...curr, messages: msgs };
                    }
                    return curr;
                  });
                }
              }
              break;
            }

            case 'MESSAGE_ERROR': {
              setIsStreaming(false);
              setLastError(`Message error: ${msg.payload.error}`);
              break;
            }

            case 'ERROR': {
              setLastError(`[${msg.payload.code}] ${msg.payload.message}`);
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
      const msg = createMessage('SESSION_LIST', {
        deviceId,
        deviceToken: deviceTokens[deviceId],
      });
      try {
        const res = await sendRpc<{ sessions: OpenCodeSession[] }>(msg);
        setSessions(res.sessions || []);
        return res.sessions;
      } catch (err: any) {
        setLastError(err.message);
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

  const openSession = useCallback(
    async (deviceId: string, sessionId: string) => {
      const msg = createMessage('SESSION_GET', {
        deviceId,
        sessionId,
        deviceToken: deviceTokens[deviceId],
      });
      const res = await sendRpc<{ session: OpenCodeSession; messages: SessionMessage[] }>(msg);
      if (res.session) {
        setActiveSession(res);
        // Pre-fetch diffs and workspace context
        fetchSessionDiff(deviceId, sessionId);
        fetchWorkspace(deviceId);
      }
      return res;
    },
    [deviceTokens, sendRpc, fetchSessionDiff, fetchWorkspace]
  );

  const sendMessage = useCallback(
    async (deviceId: string, sessionId: string, content: string) => {
      if (!content.trim()) return;

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

      const msg = createMessage('MESSAGE_SEND', {
        deviceId,
        sessionId,
        content,
        deviceToken: deviceTokens[deviceId],
      });

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [deviceTokens]
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
    devices,
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
    closeActiveSession: () => {
      setActiveSession(null);
      setSessionDiffs([]);
      setActiveDiffFile(null);
      setActiveTab('chat');
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
