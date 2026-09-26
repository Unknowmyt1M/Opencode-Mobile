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
  type QuestionItem,
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
  type SessionGetResultPayload,
  type OpenCodeProject,
  type ProjectListResultPayload,
  type SessionListGlobalResultPayload,
  type SessionListProjectResultPayload,
  type QueuedMessage,
  type McpServerInfo,
  type McpListResultPayload,
  type McpToggleResultPayload,
  type PluginListResultPayload,
  type LspItem,
  type LspListResultPayload,
  evaluateSequenceTransition,
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
  const [projects, setProjects] = useState<OpenCodeProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProjectRef = useRef<OpenCodeProject | null>(null);
  const selectedProject = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'all') return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');

  // Phase 3 Extensions: PTY Terminal, Model Selector, Permissions
  const [ptys, setPtys] = useState<PtySession[]>([]);
  const [activePtyId, setActivePtyId] = useState<string | null>(null);
  const ptyDataListeners = useRef<Map<string, Set<(data: string) => void>>>(new Map());

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const defaultModelRef = useRef<{ providerID: string; modelID: string } | null>(null);
  const sessionModelsRef = useRef<Map<string, { providerID: string; modelID: string }>>(new Map());

  const handleSelectModel = useCallback((model: { providerID: string; modelID: string } | null) => {
    setSelectedModel(model);
    if (activeSessionRef.current?.session?.id && model) {
      sessionModelsRef.current.set(activeSessionRef.current.session.id, model);
    }
  }, []);

  const [permissions, setPermissions] = useState<Record<string, PermissionItem[]>>({});
  const [questions, setQuestions] = useState<Record<string, QuestionItem[]>>({});

  // Phase 4: MCP, Plugins & LSP State
  const [mcps, setMcps] = useState<Record<string, McpServerInfo>>({});
  const [plugins, setPlugins] = useState<string[]>([]);
  const [lsps, setLsps] = useState<LspItem[]>([]);
  const [isTogglingMcp, setIsTogglingMcp] = useState<string | null>(null);

  const deviceTransitionGenerationRef = useRef<number>(0);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, string>>({});
  const fetchTodosRef = useRef<((deviceId: string, sessionId: string) => void) | null>(null);
  const fetchSessionsRef = useRef<((deviceId: string) => Promise<any>) | null>(null);
  const reconcileSessionRef = useRef<((deviceId: string, sessionId: string) => Promise<any>) | null>(null);
  const syncQueueRef = useRef<(sessionId: string, queue: QueuedMessage[], revision?: number) => void>(() => {});
  const clearQueueRef = useRef<(sessionId: string) => void>(() => {});
  const lastSequenceRef = useRef<Map<string, number>>(new Map());
  const agentEpochsRef = useRef<Map<string, string>>(new Map()); // sessionId -> agentInstanceId
  const reconciliationInFlightRef = useRef<Map<string, { promise: Promise<any>; generation: number }>>(new Map());
  const lastViewedSessionByDeviceRef = useRef<Record<string, string>>({});

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
    if (selectedDeviceIdRef.current && activeSession?.session?.id) {
      lastViewedSessionByDeviceRef.current[selectedDeviceIdRef.current] = activeSession.session.id;
      try {
        localStorage.setItem(`opencode_last_session_${selectedDeviceIdRef.current}`, activeSession.session.id);
      } catch {}
    }
  }, [activeSession]);

  const prevDeviceIdRef = useRef<string | null>(selectedDeviceId);
  useEffect(() => {
    if (prevDeviceIdRef.current && prevDeviceIdRef.current !== selectedDeviceId) {
      deviceTransitionGenerationRef.current++;
      const currentGen = deviceTransitionGenerationRef.current;
      // Switched to a different device - reset auxiliary states but avoid destructive wipe to prevent white flash
      setActiveDiffFile(null);
      setActivePtyId(null);
      setSelectedModel(null);
      setProjectContext(null);

      if (selectedDeviceId && fetchSessionsRef.current) {
        fetchSessionsRef.current(selectedDeviceId).then((loadedSessions: OpenCodeSession[]) => {
          if (deviceTransitionGenerationRef.current !== currentGen) return; // Stale device response discarded!
          if (!loadedSessions || loadedSessions.length === 0) {
            setActiveSession(null);
            return;
          }
          const prevViewedId = lastViewedSessionByDeviceRef.current[selectedDeviceId];
          const busySession = loadedSessions.find((s) => sessionStatuses[s.id] === 'busy');
          const targetSession =
            (prevViewedId && loadedSessions.find((s) => s.id === prevViewedId)) ||
            busySession ||
            loadedSessions[0];

          if (targetSession && reconcileSessionRef.current) {
            reconcileSessionRef.current(selectedDeviceId, targetSession.id);
          }
        });
      }
    }
    prevDeviceIdRef.current = selectedDeviceId;
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId, sessionStatuses]);

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

  // Authoritative event sequence tracking & gap-triggered reconciliation
  const handleEventSequence = useCallback(
    (sessionId: string, seq?: number, agentInstanceId?: string): boolean => {
      if (typeof seq !== 'number') return true;

      if (agentInstanceId) {
        const currentEpoch = agentEpochsRef.current.get(sessionId);
        if (currentEpoch && currentEpoch !== agentInstanceId) {
          // Agent restarted: reset sequence cursor for this new epoch without false alarm
          console.log(
            `[useRelay] Agent restarted (epoch ${currentEpoch} -> ${agentInstanceId}) for session ${sessionId}. Resetting sequence anchor.`
          );
          agentEpochsRef.current.set(sessionId, agentInstanceId);
          lastSequenceRef.current.set(sessionId, seq);
          return true;
        }
        agentEpochsRef.current.set(sessionId, agentInstanceId);
      }

      const last = lastSequenceRef.current.get(sessionId);
      const evaluation = evaluateSequenceTransition(last, seq);

      if (evaluation.action === 'STALE') {
        console.warn(
          `[useRelay] Stale/duplicate sequence ${seq} ignored for session ${sessionId} (last seen: ${last}). Monotonic cursor preserved.`
        );
        // Do NOT move cursor backwards!
        return false;
      }

      if (evaluation.action === 'GAP') {
        console.warn(
          `[useRelay] Event sequence gap detected for session ${sessionId}: expected ${last! + 1}, received ${seq} (gap: ${evaluation.gapSize}). Triggering authoritative snapshot reconciliation.`
        );
        if (activeSessionRef.current?.session?.id === sessionId && selectedDeviceIdRef.current) {
          const deviceId = selectedDeviceIdRef.current;
          if (!reconciliationInFlightRef.current.has(sessionId)) {
            const prom = reconcileSessionRef.current?.(deviceId, sessionId);
            if (prom) {
              reconciliationInFlightRef.current.set(sessionId, { promise: prom, generation: seq });
              prom.finally(() => {
                reconciliationInFlightRef.current.delete(sessionId);
              });
            }
          }
        }
      }

      // Update cursor monotonically
      lastSequenceRef.current.set(sessionId, evaluation.nextSequence);
      return true;
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
    async (deviceId: string, sessionId: string, directory?: string) => {
      const token = deviceTokens[deviceId];
      if (!token) return [];
      const targetDir = directory || activeSessionRef.current?.session?.directory;
      const msg = createMessage('SESSION_DIFF_GET', {
        deviceId,
        sessionId,
        deviceToken: token,
        directory: targetDir,
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
        const wasReconnecting = reconnectAttemptRef.current > 0;
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

        // Proactively reconcile on reconnect
        if (wasReconnecting && selectedDeviceIdRef.current) {
          fetchSessionsRef.current?.(selectedDeviceIdRef.current);
          if (activeSessionRef.current?.session?.id) {
            reconcileSessionRef.current?.(selectedDeviceIdRef.current, activeSessionRef.current.session.id);
          }
        }
      };

      ws.onmessage = (event) => {
        if (isUnmountedRef.current) return;
        try {
          const msg: ProtocolMessage = parseProtocolMessage(event.data);

          // Check if pending RPC request matches (by payload.requestId or message.id)
          const targetReqId = (msg.payload && typeof (msg.payload as any).requestId === 'string')
            ? (msg.payload as any).requestId
            : msg.id;
          if (pendingRequests.current.has(targetReqId)) {
            const resolver = pendingRequests.current.get(targetReqId);
            pendingRequests.current.delete(targetReqId);
            if (resolver) resolver(msg.payload);
          } else if (targetReqId !== msg.id && pendingRequests.current.has(msg.id)) {
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

            case 'PROJECT_LIST_RESULT': {
              const payload = msg.payload as ProjectListResultPayload;
              setProjects(payload.projects || []);
              break;
            }

            case 'SESSION_LIST_GLOBAL_RESULT': {
              const payload = msg.payload as SessionListGlobalResultPayload;
              setSessions(payload.sessions || []);
              if (payload.statuses) {
                setSessionStatuses(payload.statuses);
              }
              break;
            }

            case 'SESSION_LIST_PROJECT_RESULT': {
              const payload = msg.payload as SessionListProjectResultPayload;
              setSessions(payload.sessions || []);
              if (payload.statuses) {
                setSessionStatuses(payload.statuses);
              }
              break;
            }

            case 'SESSION_LIST_RESULT': {
              setSessions(msg.payload.sessions);
              if (msg.payload.statuses) {
                setSessionStatuses(msg.payload.statuses);
              }
              break;
            }

            case 'SESSION_GET_RESULT': {
              const payload = msg.payload as SessionGetResultPayload;
              const session = payload.session;
              const rawMessages = payload.messages || [];
              const runtime = payload.runtime;
              if (!session) break;

              // Stale response guard: Ignore if user switched to another session while this was in flight
              if (latestRequestedSessionIdRef.current && session.id !== latestRequestedSessionIdRef.current) {
                console.warn(
                  `[useRelay] Ignored stale SESSION_GET_RESULT for ${session.id} (current target: ${latestRequestedSessionIdRef.current})`
                );
                break;
              }

              // Ingest agent epoch
              if (runtime?.agentInstanceId) {
                agentEpochsRef.current.set(session.id, runtime.agentInstanceId);
              }

              // Snapshot sequence guard: prevent stale snapshot from regressing live streaming state
              const snapshotSeq = runtime?.snapshotSequence;
              const currentLastSeq = lastSequenceRef.current.get(session.id);
              const isSnapshotStale =
                typeof snapshotSeq === 'number' &&
                typeof currentLastSeq === 'number' &&
                currentLastSeq > snapshotSeq;

              if (typeof snapshotSeq === 'number') {
                if (!isSnapshotStale) {
                  lastSequenceRef.current.set(session.id, snapshotSeq);
                }
              } else if (typeof runtime?.lastEventSequence === 'number') {
                if (!isSnapshotStale) {
                  lastSequenceRef.current.set(session.id, runtime.lastEventSequence);
                }
              }

              const isStreaming = Boolean(runtime?.isStreaming ?? payload.isStreaming);
              const activeMsgId = runtime?.activeMessageId ?? payload.activeMessageId;
              const accumulatedText = runtime?.streamingText ?? payload.streamingText ?? '';
              const parts = runtime?.parts ?? [];
              const diffs = runtime?.diffs ?? payload.diffs ?? [];
              const sessionTodos = runtime?.todos ?? payload.todos ?? [];

              // Ingest multi-permissions and questions (session-scoped)
              if (Array.isArray(runtime?.pendingPermissions)) {
                setPermissions((prev) => ({
                  ...prev,
                  [session.id]: runtime.pendingPermissions,
                }));
              }
              if (Array.isArray(runtime?.pendingQuestions)) {
                setQuestions((prev) => ({
                  ...prev,
                  [session.id]: runtime.pendingQuestions,
                }));
              }

              // Authoritative in-flight message hydration
              let mergedMessages = [...rawMessages];
              if (!isSnapshotStale && isStreaming && activeMsgId) {
                const existingIdx = mergedMessages.findIndex((m) => m.id === activeMsgId);
                if (existingIdx >= 0) {
                  mergedMessages[existingIdx] = {
                    ...mergedMessages[existingIdx],
                    content: mergedMessages[existingIdx].content || accumulatedText,
                    parts:
                      mergedMessages[existingIdx].parts && mergedMessages[existingIdx].parts!.length > 0
                        ? mergedMessages[existingIdx].parts
                        : parts,
                  };
                } else {
                  mergedMessages.push({
                    id: activeMsgId,
                    sessionId: session.id,
                    role: 'assistant',
                    content: accumulatedText,
                    parts,
                    createdAt: Date.now(),
                  });
                }
              }

              setActiveSession({
                session,
                messages: mergedMessages,
              });

              // Per-session model isolation & restore
              const cachedModel = sessionModelsRef.current.get(session.id);
              if (cachedModel) {
                setSelectedModel(cachedModel);
              } else {
                const sessionModelFromMsg = [...mergedMessages]
                  .reverse()
                  .find((m) => m.providerID && m.modelID);
                if (sessionModelFromMsg?.providerID && sessionModelFromMsg?.modelID) {
                  const restored = {
                    providerID: sessionModelFromMsg.providerID,
                    modelID: sessionModelFromMsg.modelID,
                  };
                  sessionModelsRef.current.set(session.id, restored);
                  setSelectedModel(restored);
                } else if (defaultModelRef.current) {
                  setSelectedModel(defaultModelRef.current);
                }
              }

              if (!isSnapshotStale) {
                updateSessionRuntime(session.id, (prev) => ({
                  ...prev,
                  isStreaming,
                  isWaitingForResponse: false,
                  activeMessageId: activeMsgId || prev.activeMessageId,
                  streamingText: accumulatedText || prev.streamingText,
                  diffs: diffs,
                  todos: sessionTodos,
                }));
              } else {
                updateSessionRuntime(session.id, (prev) => ({
                  ...prev,
                  diffs,
                  todos: sessionTodos,
                }));
              }
              break;
            }

            case 'SESSION_QUEUE_SYNC': {
              const { sessionId, queue, revision } = msg.payload;
              if (sessionId && Array.isArray(queue)) {
                syncQueueRef.current(sessionId, queue, revision);
              }
              break;
            }

            case 'SESSION_QUEUE_CONFLICT': {
              const { sessionId, authoritativeQueue, currentRevision } = msg.payload;
              if (sessionId && Array.isArray(authoritativeQueue)) {
                console.warn(
                  `[useRelay] Remote queue conflict on session ${sessionId}. Syncing authoritative queue (rev ${currentRevision}).`
                );
                syncQueueRef.current(sessionId, authoritativeQueue, currentRevision);
              }
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
              const { sessionId, messageId, timestamp, sequence, agentInstanceId, clientMessageId } = msg.payload as any;
              if (!sessionId) break;
              handleEventSequence(sessionId, sequence, agentInstanceId);
              setSessionStatuses((prev) => ({ ...prev, [sessionId]: 'busy' }));

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
                  const msgs = [...curr.messages];
                  // Deterministic reconcile optimistic user message if clientMessageId is present
                  if (clientMessageId) {
                    const uIdx = msgs.findIndex(
                      (m) => m.clientMessageId === clientMessageId || m.id === clientMessageId
                    );
                    if (uIdx >= 0) {
                      msgs[uIdx] = {
                        ...msgs[uIdx],
                        clientMessageId,
                      };
                    }
                  }
                  const exists = msgs.some((m) => m.id === messageId);
                  if (exists) return { ...curr, messages: msgs };
                  return {
                    ...curr,
                    messages: [
                      ...msgs,
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

            case 'MESSAGE_SEND_ACK': {
              const { sessionId, messageId, clientMessageId } = msg.payload as any;
              if (!sessionId || !clientMessageId) break;
              if (activeSessionRef.current?.session?.id === sessionId) {
                setActiveSession((curr) => {
                  if (!curr || curr.session.id !== sessionId) return curr;
                  const idx = curr.messages.findIndex(
                    (m) => m.clientMessageId === clientMessageId || m.id === clientMessageId
                  );
                  if (idx >= 0 && messageId) {
                    const nextMsgs = [...curr.messages];
                    nextMsgs[idx] = {
                      ...nextMsgs[idx],
                      id: messageId,
                    };
                    return { ...curr, messages: nextMsgs };
                  }
                  return curr;
                });
              }
              break;
            }

            case 'MESSAGE_DELTA': {
              const { delta, messageId, sessionId, sequence, agentInstanceId } = msg.payload as any;
              if (!sessionId) break;
              handleEventSequence(sessionId, sequence, agentInstanceId);

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
              const { sessionId, messageId, totalText, sequence, agentInstanceId } = msg.payload as any;
              if (!sessionId) break;
              handleEventSequence(sessionId, sequence, agentInstanceId);
              setSessionStatuses((prev) => ({ ...prev, [sessionId]: 'idle' }));

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
                handleEventSequence(sessionId, (msg.payload as any)?.sequence, (msg.payload as any)?.agentInstanceId);
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

              // Handle native OpenCode v2 user prompt creation (session.next.prompted)
              if (eventType === 'session.next.prompted' && sessionId) {
                const promptText = props.prompt?.text || '';
                const messageId = props.messageID;
                const timestamp = props.timestamp || Date.now();
                const incomingClientMsgId = props.prompt?.clientMessageId || props.clientMessageId;

                if (activeSessionRef.current && activeSessionRef.current.session.id === sessionId) {
                  setActiveSession((curr) => {
                    if (!curr || curr.session.id !== sessionId) return curr;
                    const msgs = [...curr.messages];
                    const existingIdx = msgs.findIndex(
                      (m) =>
                        (incomingClientMsgId && m.clientMessageId === incomingClientMsgId) ||
                        m.id === messageId ||
                        (m.role === 'user' && m.id.startsWith('user_') && m.content === promptText)
                    );
                    if (existingIdx >= 0) {
                      msgs[existingIdx] = {
                        ...msgs[existingIdx],
                        id: messageId || msgs[existingIdx].id,
                        createdAt: timestamp,
                      };
                      return { ...curr, messages: msgs };
                    }
                    const peerUserMsg: SessionMessage = {
                      id: messageId || `user_${Date.now()}`,
                      sessionId,
                      role: 'user',
                      content: promptText,
                      createdAt: timestamp,
                    };
                    return { ...curr, messages: [...msgs, peerUserMsg] };
                  });
                }
              }

              // Handle native OpenCode v1 user message creation (message.updated with role: user)
              if (eventType === 'message.updated' && props.info?.role === 'user' && sessionId) {
                const info = props.info;
                const messageId = info.id;
                const content = info.content || '';
                const timestamp = info.time?.created || Date.now();
                const incomingClientMsgId = info.clientMessageId || props.clientMessageId;

                if (activeSessionRef.current && activeSessionRef.current.session.id === sessionId) {
                  setActiveSession((curr) => {
                    if (!curr || curr.session.id !== sessionId) return curr;
                    const msgs = [...curr.messages];
                    const existingIdx = msgs.findIndex(
                      (m) =>
                        (incomingClientMsgId && m.clientMessageId === incomingClientMsgId) ||
                        m.id === messageId ||
                        (m.role === 'user' && m.id.startsWith('user_') && m.content === content)
                    );
                    if (existingIdx >= 0) {
                      msgs[existingIdx] = {
                        ...msgs[existingIdx],
                        id: messageId || msgs[existingIdx].id,
                        createdAt: timestamp,
                      };
                      return { ...curr, messages: msgs };
                    }
                    const peerUserMsg: SessionMessage = {
                      id: messageId || `user_${Date.now()}`,
                      sessionId,
                      role: 'user',
                      content,
                      createdAt: timestamp,
                    };
                    return { ...curr, messages: [...msgs, peerUserMsg] };
                  });
                }
              }

              // Handle native OpenCode session status (busy / idle)
              if (eventType === 'session.status' && sessionId) {
                const statusType = props.status?.type;
                if (statusType === 'busy') {
                  setSessionStatuses((prev) => ({ ...prev, [sessionId]: 'busy' }));
                  updateSessionRuntime(sessionId, (prev) => ({
                    ...prev,
                    isStreaming: true,
                    isWaitingForResponse: false,
                  }));
                } else if (statusType === 'idle') {
                  setSessionStatuses((prev) => ({ ...prev, [sessionId]: 'idle' }));
                  updateSessionRuntime(sessionId, (prev) => ({
                    ...prev,
                    isStreaming: false,
                    isWaitingForResponse: false,
                  }));
                }
              }

              if (eventType === 'session.idle' && sessionId) {
                setSessionStatuses((prev) => ({ ...prev, [sessionId]: 'idle' }));
                updateSessionRuntime(sessionId, (prev) => ({
                  ...prev,
                  isStreaming: false,
                  isWaitingForResponse: false,
                }));
              }

              // Handle native OpenCode permission asked
              if (eventType === 'permission.asked' || eventType === 'permission.v2.asked') {
                const permId = props.id || props.requestID || props.requestId;
                const sId = sessionId || props.sessionID || props.sessionId || activeSessionRef.current?.session?.id || 'default';
                if (permId) {
                  const permItem: PermissionItem = {
                    id: permId,
                    title: props.title || props.description || 'Permission Requested',
                    command: props.command,
                    sessionID: sId,
                    time: props.time || Date.now(),
                  };
                  playSound('permission');
                  setPermissions((prev) => ({
                    ...prev,
                    [sId]: [...(prev[sId] || []).filter((item) => item.id !== permId), permItem],
                  }));
                }
              }

              // Handle native OpenCode permission resolved / replied
              if (
                (eventType === 'permission.replied' || eventType === 'permission.v2.replied') &&
                (props.requestID || props.requestId || props.id)
              ) {
                const targetReqId = props.requestID || props.requestId || props.id;
                setPermissions((prev) => {
                  const next = { ...prev };
                  for (const sId of Object.keys(next)) {
                    next[sId] = next[sId].filter((p) => p.id !== targetReqId && (p as any).requestId !== targetReqId);
                  }
                  return next;
                });
              }

              // Handle native OpenCode question asked / replied
              if (eventType === 'question.asked' || eventType === 'question.v2.asked') {
                const qId = props.id || props.requestID || props.requestId;
                const sId = sessionId || props.sessionID || props.sessionId || activeSessionRef.current?.session?.id || 'default';
                if (qId) {
                  const qItem: QuestionItem = {
                    id: qId,
                    sessionID: sId,
                    questions: props.questions || [],
                    time: props.time || Date.now(),
                  };
                  setQuestions((prev) => ({
                    ...prev,
                    [sId]: [...(prev[sId] || []).filter((item) => item.id !== qId), qItem],
                  }));
                }
              }

              if (
                (eventType === 'question.replied' || eventType === 'question.rejected') &&
                (props.requestID || props.requestId || props.id)
              ) {
                const targetQId = props.requestID || props.requestId || props.id;
                setQuestions((prev) => {
                  const next = { ...prev };
                  for (const sId of Object.keys(next)) {
                    next[sId] = next[sId].filter((q) => q.id !== targetQId);
                  }
                  return next;
                });
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

              if (eventType === 'session.deleted' && sessionId) {
                setSessions((prev) => prev.filter((s) => s.id !== sessionId));
                setSessionStatuses((prev) => {
                  const updated = { ...prev };
                  delete updated[sessionId];
                  return updated;
                });
                setSessionRuntime((prev) => {
                  const updated = { ...prev };
                  delete updated[sessionId];
                  return updated;
                });
                lastSequenceRef.current.delete(sessionId);
                agentEpochsRef.current.delete(sessionId);
                clearQueueRef.current?.(sessionId);
                if (activeSessionRef.current?.session?.id === sessionId) {
                  setActiveSession(null);
                  setActiveDiffFile(null);
                }
              }
              break;
            }

            case 'MESSAGE_ERROR': {
              const { sessionId, error, sequence, agentInstanceId } = msg.payload as any;
              if (sessionId) {
                handleEventSequence(sessionId, sequence, agentInstanceId);
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
              const p = msg.payload as any;
              const permId = p.id || p.requestId;
              if (permId) {
                const sId = p.sessionId || p.sessionID || activeSessionRef.current?.session?.id || 'default';
                const permItem: PermissionItem = {
                  id: permId,
                  title: p.title || p.description,
                  command: p.command,
                  sessionID: sId,
                  time: p.time || Date.now(),
                };
                playSound('permission');
                setPermissions((prev) => ({
                  ...prev,
                  [sId]: [...(prev[sId] || []).filter((item) => item.id !== permId), permItem],
                }));
              }
              break;
            }

            case 'PERMISSION_REPLY_RESULT': {
              const { requestId, success } = msg.payload;
              if (success && requestId) {
                setPermissions((prev) => {
                  const next = { ...prev };
                  for (const sId of Object.keys(next)) {
                    next[sId] = next[sId].filter((p) => p.id !== requestId && (p as any).requestId !== requestId);
                  }
                  return next;
                });
              }
              break;
            }

            case 'MCP_LIST_RESULT': {
              const payload = msg.payload as McpListResultPayload;
              if (payload.mcps) setMcps(payload.mcps);
              break;
            }

            case 'MCP_TOGGLE_RESULT': {
              const payload = msg.payload as McpToggleResultPayload;
              if (payload.mcps) {
                setMcps(payload.mcps);
              } else if (payload.name && payload.status) {
                setMcps((prev) => ({
                  ...prev,
                  [payload.name]: { status: payload.status!, error: payload.error },
                }));
              }
              break;
            }

            case 'PLUGIN_LIST_RESULT': {
              const payload = msg.payload as PluginListResultPayload;
              if (Array.isArray(payload.plugins)) setPlugins(payload.plugins);
              break;
            }

            case 'LSP_LIST_RESULT': {
              const payload = msg.payload as LspListResultPayload;
              if (Array.isArray(payload.lsps)) setLsps(payload.lsps);
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

  // ==========================================
  // Projects & Global Sessions API
  // ==========================================
  const fetchProjects = useCallback(
    async (deviceId: string) => {
      const token = deviceTokens[deviceId];
      if (!token) {
        setProjects([]);
        return [];
      }
      const msg = createMessage('PROJECT_LIST', {
        deviceId,
        deviceToken: token,
      });
      try {
        const res = await sendRpc<ProjectListResultPayload>(msg);
        const list = res.projects || [];
        setProjects(list);
        return list;
      } catch (err: any) {
        console.warn('[useRelay] Failed to fetch projects:', err.message);
        return [];
      }
    },
    [deviceTokens, sendRpc]
  );

  const fetchGlobalSessions = useCallback(
    async (deviceId: string, limit?: number) => {
      const token = deviceTokens[deviceId];
      if (!token) {
        setSessions([]);
        return [];
      }
      const msg = createMessage('SESSION_LIST_GLOBAL', {
        deviceId,
        deviceToken: token,
        limit: limit || 2000,
      });
      try {
        const res = await sendRpc<SessionListGlobalResultPayload>(msg);
        setSessions(res.sessions || []);
        if (res.statuses) {
          setSessionStatuses(res.statuses);
        }
        return res.sessions;
      } catch (err: any) {
        console.warn('[useRelay] Failed to fetch global sessions:', err.message);
        return [];
      }
    },
    [deviceTokens, sendRpc]
  );

  const fetchProjectSessions = useCallback(
    async (deviceId: string, directory?: string, projectId?: string, limit?: number) => {
      const token = deviceTokens[deviceId];
      if (!token) {
        setSessions([]);
        return [];
      }
      const msg = createMessage('SESSION_LIST_PROJECT', {
        deviceId,
        projectId,
        directory,
        deviceToken: token,
        limit,
      });
      try {
        const res = await sendRpc<SessionListProjectResultPayload>(msg);
        setSessions(res.sessions || []);
        if (res.statuses) {
          setSessionStatuses(res.statuses);
        }
        return res.sessions;
      } catch (err: any) {
        console.warn('[useRelay] Failed to fetch project sessions:', err.message);
        return [];
      }
    },
    [deviceTokens, sendRpc]
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProjectId(projectId);
      if (selectedDeviceIdRef.current) {
        try {
          if (projectId) {
            localStorage.setItem(`opencode_last_project_${selectedDeviceIdRef.current}`, projectId);
          } else {
            localStorage.removeItem(`opencode_last_project_${selectedDeviceIdRef.current}`);
          }
        } catch {}

        if (!projectId || projectId === 'all') {
          fetchGlobalSessions(selectedDeviceIdRef.current);
        } else {
          const proj = projects.find((p) => p.id === projectId);
          if (proj) {
            fetchProjectSessions(selectedDeviceIdRef.current, proj.worktree, proj.id);
          }
        }
      }
    },
    [projects, fetchGlobalSessions, fetchProjectSessions]
  );

  // Sessions API
  const fetchSessions = useCallback(
    async (deviceId: string) => {
      if (selectedProjectRef.current?.worktree) {
        return fetchProjectSessions(
          deviceId,
          selectedProjectRef.current.worktree,
          selectedProjectRef.current.id
        );
      }
      return fetchGlobalSessions(deviceId);
    },
    [fetchGlobalSessions, fetchProjectSessions]
  );

  useEffect(() => {
    fetchSessionsRef.current = fetchSessions;
  }, [fetchSessions]);

  const createSession = useCallback(
    async (deviceId: string, title?: string, directory?: string) => {
      const targetDir = directory || selectedProjectRef.current?.worktree;
      const targetProjectId = selectedProjectRef.current?.id;
      const msg = createMessage('SESSION_CREATE', {
        deviceId,
        title,
        deviceToken: deviceTokens[deviceId],
        directory: targetDir,
        projectId: targetProjectId,
      });
      const res = await sendRpc<{ session: OpenCodeSession }>(msg);
      if (res.session) {
        latestRequestedSessionIdRef.current = res.session.id;
        updateSessionRuntime(res.session.id, () => createInitialSessionRuntime());
        setSessions((prev) => [res.session, ...prev]);
        setActiveSession({ session: res.session, messages: [] });
        setActiveDiffFile(null);
        setActiveTab('chat');
        if (defaultModelRef.current) {
          setSelectedModel(defaultModelRef.current);
          sessionModelsRef.current.set(res.session.id, defaultModelRef.current);
        }
      }
      return res.session;
    },
    [deviceTokens, sendRpc, updateSessionRuntime]
  );

  const fetchTodos = useCallback(
    async (deviceId: string, sessionId: string, directory?: string) => {
      const token = deviceTokens[deviceId];
      if (!token || !sessionId) return;
      const targetDir = directory || activeSessionRef.current?.session?.directory;
      try {
        const res = await sendRpc<TodoListResultPayload>(
          createMessage('TODO_LIST_REQUEST', {
            deviceId,
            sessionId,
            deviceToken: token,
            directory: targetDir,
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

  const fetchQueue = useCallback((deviceId: string, sessionId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const token = deviceTokensRef.current[deviceId];
    const msg = createMessage('SESSION_QUEUE_GET', {
      deviceId,
      sessionId,
      deviceToken: token,
    });
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  const openSession = useCallback(
    async (deviceId: string, sessionId: string, directory?: string) => {
      latestRequestedSessionIdRef.current = sessionId;
      const currentDevGen = deviceTransitionGenerationRef.current;
      setIsLoadingSession(true);
      setLoadingSessionId(sessionId);
      try {
        const msg = createMessage('SESSION_GET', {
          deviceId,
          sessionId,
          deviceToken: deviceTokens[deviceId],
          directory,
        });
        const res = await sendRpc<{ session: OpenCodeSession; messages: SessionMessage[] }>(msg);
        if (
          deviceTransitionGenerationRef.current === currentDevGen &&
          res.session &&
          latestRequestedSessionIdRef.current === sessionId
        ) {
          setActiveSession(res);
          // Pre-fetch diffs, workspace context, and todos
          fetchSessionDiff(deviceId, sessionId, res.session.directory || directory);
          fetchWorkspace(deviceId);
          fetchTodos(deviceId, sessionId, res.session.directory || directory);
          fetchQueue(deviceId, sessionId);
        }
        return res;
      } finally {
        if (latestRequestedSessionIdRef.current === sessionId) {
          setIsLoadingSession(false);
          setLoadingSessionId(null);
        }
      }
    },
    [deviceTokens, sendRpc, fetchSessionDiff, fetchWorkspace, fetchTodos, fetchQueue]
  );

  useEffect(() => {
    reconcileSessionRef.current = openSession;
  }, [openSession]);

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
      const clientMessageId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const userMsg: SessionMessage = {
        id: `user_${Date.now()}`,
        clientMessageId,
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

      const dir = activeSessionRef.current?.session?.directory || selectedProjectRef.current?.worktree;
      const token = deviceTokensRef.current[deviceId] || deviceTokens[deviceId];
      const msg = createMessage('MESSAGE_SEND', {
        deviceId,
        sessionId,
        content,
        clientMessageId,
        deviceToken: token,
        model,
        directory: dir,
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

  const handleQueueUpdate = useCallback(
    (
      sessionId: string,
      newQueue: QueuedMessage[],
      mutationId?: string,
      baseRevision?: number
    ) => {
      if (!selectedDeviceRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const deviceId = selectedDeviceRef.current.deviceId;
      const token = deviceTokensRef.current[deviceId];
      const msg = createMessage('SESSION_QUEUE_UPDATE', {
        deviceId,
        sessionId,
        queue: newQueue,
        mutationId,
        baseRevision,
        deviceToken: token,
      });
      wsRef.current.send(JSON.stringify(msg));
    },
    []
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
    syncQueue,
  } = useMessageQueue({
    activeSessionId: activeSession?.session.id,
    selectedDeviceId: selectedDevice?.deviceId,
    isStreaming,
    sessionStreamingStatus,
    onSendMessage: sendDirectMessage,
    onQueueUpdate: handleQueueUpdate,
  });

  useEffect(() => {
    syncQueueRef.current = syncQueue;
    clearQueueRef.current = clearQueue;
  }, [syncQueue, clearQueue]);

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
      if (res.defaultModel) {
        defaultModelRef.current = res.defaultModel;
        if (!selectedModel) {
          setSelectedModel(res.defaultModel);
        }
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
      setPermissions({});
      return;
    }
    try {
      const res = await sendRpc<PermissionListResultPayload>(
        createMessage('PERMISSION_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      const list = res.permissions || [];
      const grouped: Record<string, PermissionItem[]> = {};
      for (const p of list) {
        const sId = p.sessionID || (p as any).sessionId || 'default';
        if (!grouped[sId]) grouped[sId] = [];
        grouped[sId].push(p);
      }
      setPermissions(grouped);
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
        setPermissions((prev) => {
          const next = { ...prev };
          for (const sId of Object.keys(next)) {
            next[sId] = next[sId].filter((p) => p.id !== requestId);
          }
          return next;
        });
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
    return permissions[currentId] || [];
  }, [permissions, activeSession?.session?.id]);

  const activeQuestions = useMemo(() => {
    const currentId = activeSession?.session?.id;
    if (!currentId) return [];
    return questions[currentId] || [];
  }, [questions, activeSession?.session?.id]);

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
        if (res.success) {
          setQuestions((prev) => {
            const next = { ...prev };
            for (const sId of Object.keys(next)) {
              next[sId] = next[sId].filter((q) => q.id !== requestId);
            }
            return next;
          });
        }
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

  // Phase 4: MCP, Plugins & LSP API
  const fetchMcps = useCallback(async () => {
    if (!selectedDevice) return {};
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    try {
      const res = await sendRpc<McpListResultPayload>(
        createMessage('MCP_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      if (res?.mcps) {
        setMcps(res.mcps);
      }
      return res?.mcps || {};
    } catch (err: any) {
      console.warn('Failed to fetch MCP list:', err.message);
      return {};
    }
  }, [selectedDevice, sendRpc]);

  const toggleMcp = useCallback(async (name: string): Promise<boolean> => {
    if (!selectedDevice) return false;
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    setIsTogglingMcp(name);
    try {
      const res = await sendRpc<McpToggleResultPayload>(
        createMessage('MCP_TOGGLE', {
          deviceId: selectedDevice.deviceId,
          name,
          deviceToken: token,
        })
      );
      if (res?.mcps) {
        setMcps(res.mcps);
      } else if (res?.status) {
        setMcps((prev) => ({
          ...prev,
          [name]: { status: res.status!, error: res.error },
        }));
      }
      return res?.success ?? false;
    } catch (err: any) {
      console.warn(`Failed to toggle MCP server '${name}':`, err.message);
      return false;
    } finally {
      setIsTogglingMcp(null);
    }
  }, [selectedDevice, sendRpc]);

  const fetchPlugins = useCallback(async () => {
    if (!selectedDevice) return [];
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    try {
      const res = await sendRpc<PluginListResultPayload>(
        createMessage('PLUGIN_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      if (Array.isArray(res?.plugins)) {
        setPlugins(res.plugins);
      }
      return res?.plugins || [];
    } catch (err: any) {
      console.warn('Failed to fetch plugins:', err.message);
      return [];
    }
  }, [selectedDevice, sendRpc]);

  const fetchLsps = useCallback(async () => {
    if (!selectedDevice) return [];
    const token = deviceTokensRef.current[selectedDevice.deviceId];
    try {
      const res = await sendRpc<LspListResultPayload>(
        createMessage('LSP_LIST', {
          deviceId: selectedDevice.deviceId,
          deviceToken: token,
        })
      );
      if (Array.isArray(res?.lsps)) {
        setLsps(res.lsps);
      }
      return res?.lsps || [];
    } catch (err: any) {
      console.warn('Failed to fetch LSP list:', err.message);
      return [];
    }
  }, [selectedDevice, sendRpc]);

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
    projects,
    selectedProjectId,
    selectedProject,
    selectProject,
    fetchProjects,
    fetchGlobalSessions,
    fetchProjectSessions,
    sessions,
    sessionStatuses,
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
    setSelectedModel: handleSelectModel,
    fetchModels,
    permissions: activePermissions,
    fetchPermissions,
    replyPermission,
    questions: activeQuestions,
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
    // Phase 4: MCP, Plugins & LSP
    mcps,
    plugins,
    lsps,
    isTogglingMcp,
    fetchMcps,
    toggleMcp,
    fetchPlugins,
    fetchLsps,
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
      if (defaultModelRef.current) {
        setSelectedModel(defaultModelRef.current);
      }
      if (selectedDeviceIdRef.current) {
        try {
          localStorage.removeItem(`opencode_last_session_${selectedDeviceIdRef.current}`);
        } catch {}
      }
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
