import WebSocket from 'ws';
import crypto from 'node:crypto';
import {
  parseProtocolMessage,
  createMessage,
  PROTOCOL_VERSION,
  type ConnectionState,
  type ProtocolMessage,
  type OpenCodeStatus,
  type TodoItem,
  type SnapshotFileDiff,
  type PermissionItem,
  type QuestionItem,
  type MessagePart,
  type SessionRuntimeSnapshot,
} from '@opencode-remote/protocol';
import type { AgentConfig } from './config.js';
import { OpenCodeDetector } from './opencode.js';
import { OpenCodeAdapter } from './opencodeAdapter.js';

export class RemoteAgent {
  private config: AgentConfig;
  private ws: WebSocket | null = null;
  private detector: OpenCodeDetector;
  private adapter: OpenCodeAdapter;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private readonly agentInstanceId: string = `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  private sessionSequences: Map<string, number> = new Map();
  private globalSequence = 1;
  private paired = false;
  private ptySockets: Map<string, WebSocket> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;
    this.detector = new OpenCodeDetector(config.opencodeUrl);
    this.adapter = new OpenCodeAdapter({
      baseUrl: config.opencodeUrl,
      password: process.env.OPENCODE_PASSWORD,
      username: process.env.OPENCODE_USERNAME,
    });

    this.detector.onStatusChange((res) => {
      console.log(`[agent] OpenCode status changed: ${res.status}${res.version ? ` (v${res.version})` : ''}`);
      this.sendOpenCodeStatus(res.status, res.version);

      if (res.status === 'connected') {
        this.setupEventStream();
      } else {
        this.adapter.stopEventStream();
      }
    });
  }

  private setupEventStream() {
    this.adapter.startEventStream((evt: any) => {
      this.handleOpenCodeEvent(evt);
    });
  }

  private attachPtySocket(ptyId: string, initialInput?: string): WebSocket {
    const existing = this.ptySockets.get(ptyId);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      if (initialInput && existing.readyState === WebSocket.OPEN) {
        existing.send(initialInput);
      }
      return existing;
    }

    const wsUrl = this.adapter.getPtyWsUrl(ptyId);
    const ptyWs = new WebSocket(wsUrl);
    this.ptySockets.set(ptyId, ptyWs);

    ptyWs.on('open', () => {
      console.log(`[agent] Connected to OpenCode PTY ${ptyId}`);
      if (initialInput) {
        ptyWs.send(initialInput);
      }
    });

    ptyWs.on('message', (data: any) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      this.sendMessage(
        createMessage('PTY_OUTPUT', {
          deviceId: this.config.deviceId,
          ptyId,
          data: text,
        })
      );
    });

    ptyWs.on('close', () => {
      console.log(`[agent] OpenCode PTY ${ptyId} closed`);
      this.ptySockets.delete(ptyId);
      this.sendMessage(
        createMessage('PTY_CLOSED', {
          deviceId: this.config.deviceId,
          ptyId,
        })
      );
    });

    ptyWs.on('error', (err) => {
      console.warn(`[agent] OpenCode PTY ${ptyId} error:`, err.message);
    });

    return ptyWs;
  }

  private pendingPermissions: Map<string, PermissionItem> = new Map();
  private pendingQuestions: Map<string, QuestionItem> = new Map();

  private nextSessionSequence(sessionId: string): number {
    const current = this.sessionSequences.get(sessionId) ?? 0;
    const next = current + 1;
    this.sessionSequences.set(sessionId, next);
    return next;
  }

  private cleanupSessionRuntime(sessionId: string) {
    this.sessionRuntimes.delete(sessionId);
    this.sessionTurns.delete(sessionId);
    this.sessionSequences.delete(sessionId);
    for (const [id, perm] of Array.from(this.pendingPermissions.entries())) {
      if (perm.sessionID === sessionId) {
        this.pendingPermissions.delete(id);
      }
    }
    for (const [id, q] of Array.from(this.pendingQuestions.entries())) {
      if (q.sessionID === sessionId) {
        this.pendingQuestions.delete(id);
      }
    }
  }

  private sessionTurns: Map<
    string,
    { turnId: string; messageId: string; startedEmitted: boolean; completedEmitted: boolean }
  > = new Map();

  private sessionRuntimes: Map<
    string,
    {
      sessionId: string;
      status: 'idle' | 'busy' | 'error';
      turnId?: string;
      userMessageId?: string;
      assistantMessageId?: string;
      streamingText: string;
      parts: MessagePart[];
      todos: TodoItem[];
      diffs: SnapshotFileDiff[];
      lastEventSequence: number;
    }
  > = new Map();

  private getOrCreateRuntime(sessionId: string) {
    let rt = this.sessionRuntimes.get(sessionId);
    if (!rt) {
      rt = {
        sessionId,
        status: 'idle',
        streamingText: '',
        parts: [],
        todos: [],
        diffs: [],
        lastEventSequence: 0,
      };
      this.sessionRuntimes.set(sessionId, rt);
    }
    return rt;
  }

  private getOrCreateTurn(sessionId: string, preferredMessageId?: string) {
    let turn = this.sessionTurns.get(sessionId);
    if (
      !turn ||
      turn.completedEmitted ||
      (preferredMessageId && turn.startedEmitted && turn.messageId !== preferredMessageId)
    ) {
      const messageId = preferredMessageId || `msg_${sessionId}_${Date.now()}`;
      const turnId = `turn_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      turn = { turnId, messageId, startedEmitted: false, completedEmitted: false };
      this.sessionTurns.set(sessionId, turn);
    } else if (preferredMessageId && !turn.startedEmitted && turn.messageId !== preferredMessageId) {
      turn.messageId = preferredMessageId;
    }
    return turn;
  }

  private handleOpenCodeEvent(evt: any) {
    if (!evt || !evt.type) return;

    const eventType = evt.type;
    const props = evt.properties || evt.data || {};
    const sessionId = props.sessionID || evt.sessionID || props.part?.sessionID;

    if (!sessionId) {
      // Global/non-session event: broadcast raw event only
      const seq = this.globalSequence++;
      const opencodeEvt = createMessage('OPENCODE_EVENT', {
        deviceId: this.config.deviceId,
        eventType,
        payload: evt,
        sequence: seq,
        agentInstanceId: this.agentInstanceId,
        scope: 'global',
        eventId: props.id || evt.id,
      });
      this.sendMessage(opencodeEvt);
      return;
    }

    const rt = this.getOrCreateRuntime(sessionId);
    const incomingMessageId = props.assistantMessageID || props.messageID;
    if (incomingMessageId) {
      rt.assistantMessageId = incomingMessageId;
    }

    const turn = this.getOrCreateTurn(sessionId, incomingMessageId);
    rt.turnId = turn.turnId;
    const currentMessageId = turn.messageId;

    // Helper to emit MESSAGE_STARTED exactly once per turn
    const ensureStarted = () => {
      if (!turn.startedEmitted) {
        turn.startedEmitted = true;
        rt.status = 'busy';
        rt.streamingText = '';
        rt.parts = [];
        const seq = this.nextSessionSequence(sessionId);
        rt.lastEventSequence = seq;
        const msg = createMessage('MESSAGE_STARTED', {
          deviceId: this.config.deviceId,
          sessionId,
          messageId: currentMessageId,
          timestamp: Date.now(),
          sequence: seq,
          agentInstanceId: this.agentInstanceId,
          scope: 'session',
          eventId: props.id || evt.id,
        });
        this.sendMessage(msg);
      }
    };

    // 1. Text streaming delta
    if ((eventType === 'session.next.text.delta' || eventType === 'session.text.delta' || eventType === 'message.part.delta') && props.delta) {
      ensureStarted();
      rt.status = 'streaming';
      rt.streamingText += props.delta;
      const seq = this.nextSessionSequence(sessionId);
      rt.lastEventSequence = seq;
      const msg = createMessage('MESSAGE_DELTA', {
        deviceId: this.config.deviceId,
        sessionId,
        messageId: currentMessageId,
        delta: props.delta,
        sequence: seq,
        agentInstanceId: this.agentInstanceId,
        scope: 'session',
        eventId: props.id || evt.id,
      });
      this.sendMessage(msg);
    } else if (
      eventType === 'session.next.reasoning.started' ||
      eventType === 'session.reasoning.started'
    ) {
      ensureStarted();
      rt.status = 'thinking';
    } else if (
      eventType === 'session.next.tool.started' ||
      eventType === 'session.tool.started'
    ) {
      ensureStarted();
      rt.status = 'tool_executing';
    } else if (
      eventType === 'session.next.text.started' ||
      eventType === 'session.next.step.started' ||
      eventType === 'session.step.started' ||
      (eventType === 'session.status' && props.status?.type === 'busy')
    ) {
      ensureStarted();
      rt.status = 'busy';
    } else if (
      eventType === 'session.idle' ||
      (eventType === 'session.status' && props.status?.type === 'idle')
    ) {
      rt.status = 'idle';
      // Complete turn ONLY when entire session is truly idle
      if (turn.startedEmitted && !turn.completedEmitted) {
        turn.completedEmitted = true;
        const seq = this.nextSessionSequence(sessionId);
        rt.lastEventSequence = seq;
        const msg = createMessage('MESSAGE_COMPLETED', {
          deviceId: this.config.deviceId,
          sessionId,
          messageId: currentMessageId,
          totalText: props.text || rt.streamingText,
          timestamp: Date.now(),
          sequence: seq,
          agentInstanceId: this.agentInstanceId,
          scope: 'session',
          eventId: props.id || evt.id,
        });
        this.sendMessage(msg);

        if (this.sessionTurns.get(sessionId) === turn) {
          this.sessionTurns.delete(sessionId);
        }
      }
    } else if (eventType === 'todo.updated' && Array.isArray(props.todos)) {
      const todoItems: TodoItem[] = props.todos.map((t: any) => ({
        content: t.content || '',
        status: t.status || 'pending',
        priority: t.priority || 'medium',
      }));
      rt.todos = todoItems;
      const msg = createMessage('TODO_UPDATED', {
        deviceId: this.config.deviceId,
        sessionId,
        todos: todoItems,
      });
      this.sendMessage(msg);
    } else if (eventType === 'session.diff' && Array.isArray(props.diff)) {
      const diffs: SnapshotFileDiff[] = props.diff.map((d: any) => ({
        file: (d.file || d.path || '').replace(/\\/g, '/'),
        patch: d.patch,
        additions: typeof d.additions === 'number' ? d.additions : 0,
        deletions: typeof d.deletions === 'number' ? d.deletions : 0,
        status: d.status,
      }));
      rt.diffs = diffs;
      const msg = createMessage('SESSION_DIFF_UPDATED', {
        deviceId: this.config.deviceId,
        sessionId,
        diff: diffs,
      });
      this.sendMessage(msg);
    } else if (eventType === 'permission.asked' || eventType === 'permission.v2.asked') {
      rt.status = 'waiting_permission';
      const permItem: PermissionItem = {
        id: props.id || props.requestID || props.requestId || `perm_${Date.now()}`,
        title: props.title,
        pattern: props.pattern,
        command: props.command,
        sessionID: sessionId,
        time: props.time || Date.now(),
      };
      this.pendingPermissions.set(permItem.id, permItem);
      const permMsg = createMessage('PERMISSION_REQUEST', {
        ...permItem,
        deviceId: this.config.deviceId,
      } as any);
      this.sendMessage(permMsg);
    } else if (eventType === 'permission.replied' || eventType === 'permission.v2.replied') {
      const permId = props.id || props.requestID || props.requestId;
      if (permId) {
        this.pendingPermissions.delete(permId);
      }
      if (this.pendingPermissions.size === 0 && this.pendingQuestions.size === 0 && rt.status === 'waiting_permission') {
        rt.status = 'busy';
      }
    } else if (eventType === 'question.asked') {
      rt.status = 'waiting_question';
      const qItem: QuestionItem = {
        id: props.id || props.requestID || props.requestId || `q_${Date.now()}`,
        sessionID: sessionId,
        questions: props.questions || props.question,
        time: props.time || Date.now(),
      };
      this.pendingQuestions.set(qItem.id, qItem);
    } else if (eventType === 'question.replied' || eventType === 'question.rejected') {
      const qId = props.id || props.requestID || props.requestId;
      if (qId) {
        this.pendingQuestions.delete(qId);
      }
      if (this.pendingPermissions.size === 0 && this.pendingQuestions.size === 0 && rt.status === 'waiting_question') {
        rt.status = 'busy';
      }
    } else if (eventType === 'session.deleted') {
      this.cleanupSessionRuntime(sessionId);
    } else if (
      (eventType === 'message.part.updated' || eventType === 'message.part') &&
      props.part
    ) {
      const p = props.part;
      const pIdx = rt.parts.findIndex(
        (existing) => existing.id === p.id || (p.callID && existing.callID === p.callID)
      );
      if (pIdx >= 0) {
        rt.parts[pIdx] = { ...rt.parts[pIdx], ...p };
      } else {
        rt.parts.push(p);
      }
    } else if (eventType === 'session.error') {
      rt.status = 'error';
      const errorText =
        props.error?.data?.message ||
        props.error?.message ||
        (typeof props.error === 'string' ? props.error : 'OpenCode session error');
      const seq = this.nextSessionSequence(sessionId);
      rt.lastEventSequence = seq;
      const msg = createMessage('MESSAGE_ERROR', {
        deviceId: this.config.deviceId,
        sessionId,
        error: errorText,
        sequence: seq,
        agentInstanceId: this.agentInstanceId,
        scope: 'session',
        eventId: props.id || evt.id,
      });
      this.sendMessage(msg);
      this.sessionTurns.delete(sessionId);
    }

    // Always broadcast raw event for observability
    const seq = this.nextSessionSequence(sessionId);
    rt.lastEventSequence = seq;
    const opencodeEvt = createMessage('OPENCODE_EVENT', {
      deviceId: this.config.deviceId,
      eventType,
      payload: evt,
      sequence: seq,
      agentInstanceId: this.agentInstanceId,
      scope: 'session',
      eventId: props.id || evt.id,
    });
    this.sendMessage(opencodeEvt);
  }

  start() {
    this.isShuttingDown = false;
    this.detector.startPolling(3000);
    this.connect();
  }

  stop() {
    this.isShuttingDown = true;
    this.detector.stopPolling();
    this.adapter.stopEventStream();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('DISCONNECTED');
  }

  /**
   * Explicit host approval of a pairing offer.
   */
  public approvePairing(pairingId: string) {
    console.log(`[agent] Explicit host approval dispatched for pairing: ${pairingId}`);
    const approveMsg = createMessage('PAIRING_APPROVE', { pairingId });
    this.sendMessage(approveMsg);
  }

  /**
   * Explicit host rejection of a pairing offer.
   */
  public rejectPairing(pairingId: string) {
    console.log(`[agent] Explicit host rejection dispatched for pairing: ${pairingId}`);
    const rejectMsg = createMessage('PAIRING_REJECT', { pairingId });
    this.sendMessage(rejectMsg);
  }

  private setState(newState: ConnectionState) {
    if (this.state !== newState) {
      this.state = newState;
      console.log(`[agent] Connection state: ${newState}`);
    }
  }

  private connect() {
    if (this.isShuttingDown) return;

    this.setState(this.reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING');
    console.log(`[agent] Connecting outbound to relay at ${this.config.relayUrl}...`);

    try {
      this.ws = new WebSocket(this.config.relayUrl);
    } catch (err: any) {
      console.error(`[agent] Failed to initiate WebSocket: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[agent] Outbound WebSocket connection established');
      this.reconnectAttempt = 0;
      this.sendHello();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[agent] Connection closed (code: ${code}, reason: ${reason.toString() || 'none'})`);
      this.stopHeartbeat();
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      } else {
        this.setState('DISCONNECTED');
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[agent] WebSocket error: ${err.message}`);
    });
  }

  private sendHello() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const hello = createMessage('AGENT_HELLO', {
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      agentVersion: '0.1.0',
      os: process.platform,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        sessions: true,
        streaming: true,
        permissions: true,
      },
      agentCredential: this.config.deviceCredential,
      deviceToken: this.config.deviceCredential,
      requestPairingCode: true,
    });

    this.ws.send(JSON.stringify(hello));
    console.log('[agent] Sent AGENT_HELLO');
  }

  private async handleMessage(raw: string) {
    try {
      const msg: ProtocolMessage = parseProtocolMessage(raw);

      switch (msg.type) {
        case 'AGENT_HELLO_ACK': {
          this.setState('CONNECTED');
          this.startHeartbeat();
          this.paired = msg.payload.paired;

          if (this.paired) {
            console.log('[agent] ✓ Device authenticated and authorized. No pairing required.');
          }
          if (msg.payload.pairingCode) {
            console.log('====================================================');
            console.log(`  PAIRING CODE: ${msg.payload.pairingCode}`);
            console.log('  Enter this code on your phone PWA to pair this PC!');
            console.log('  (Valid for 5 minutes)');
            console.log('====================================================');
          }

          // Initial status report
          this.sendOpenCodeStatus(this.detector.getStatus(), this.detector.getVersion());
          if (this.detector.getStatus() === 'connected') {
            this.setupEventStream();
          }
          break;
        }

        case 'PAIRING_OFFER': {
          const { pairingId, clientName, code } = msg.payload;
          console.log(`[agent] 🔔 Pairing offer received from "${clientName}" (Code: ${code})`);

          if (this.config.onPairingOffer) {
            console.log('[agent] Dispatching pairing offer to host approval handler...');
            Promise.resolve(this.config.onPairingOffer(msg.payload))
              .then((approved) => {
                if (approved) {
                  this.approvePairing(pairingId);
                } else {
                  this.rejectPairing(pairingId);
                }
              })
              .catch((err) => {
                console.error(`[agent] Host pairing approval handler error: ${err.message}`);
                this.rejectPairing(pairingId);
              });
          } else if (this.config.autoApprovePairing === true) {
            console.log('[agent] ⚠️ Auto-approving pairing offer (TEST_HARNESS_ONLY mode)...');
            this.approvePairing(pairingId);
          } else {
            console.log(
              `[agent] ⚠️ Host approval required for pairingId: ${pairingId}. Not auto-approving in production mode.`
            );
          }
          break;
        }

        case 'PAIRING_APPROVE_RESULT': {
          if (msg.payload.success) {
            this.paired = true;
            console.log('[agent] ✓ Computer successfully paired with phone!');
          }
          break;
        }

        // ==========================================
        // Session RPC Handlers
        // ==========================================
        case 'SESSION_LIST': {
          try {
            const sessions = await this.adapter.listSessions();
            let statuses: Record<string, { type: 'busy' | 'idle' }> = {};
            try {
              statuses = await this.adapter.getSessionStatuses();
            } catch {}

            for (const [sId, rt] of this.sessionRuntimes.entries()) {
              if (rt.status === 'busy') {
                statuses[sId] = { type: 'busy' };
              }
            }

            const res = createMessage(
              'SESSION_LIST_RESULT',
              {
                deviceId: this.config.deviceId,
                sessions,
                statuses,
              } as any,
              msg.id // Preserve requestId
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'OPENCODE_API_ERROR',
                message: err.message,
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'SESSION_CREATE': {
          try {
            const session = await this.adapter.createSession(msg.payload.title);
            const res = createMessage(
              'SESSION_CREATE_RESULT',
              {
                deviceId: this.config.deviceId,
                session,
              },
              msg.id
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'OPENCODE_API_ERROR',
                message: err.message,
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'SESSION_GET': {
          try {
            const { session, messages } = await this.adapter.getSession(msg.payload.sessionId);
            const rt = this.getOrCreateRuntime(msg.payload.sessionId);
            const currentTurn = this.sessionTurns.get(msg.payload.sessionId);
            const isStreaming = rt.status === 'busy' || Boolean(currentTurn && currentTurn.startedEmitted && !currentTurn.completedEmitted);

            try {
              const diffs = await this.adapter.getSessionDiff(msg.payload.sessionId);
              rt.diffs = diffs ?? [];
            } catch {
              rt.diffs = [];
            }

            try {
              const todos = await this.adapter.getTodos(msg.payload.sessionId);
              rt.todos = todos ?? [];
            } catch {
              rt.todos = [];
            }

            const sessionPerms = Array.from(this.pendingPermissions.values()).filter(
              (p) => !p.sessionID || p.sessionID === msg.payload.sessionId
            );
            const sessionQuestions = Array.from(this.pendingQuestions.values()).filter(
              (q) => !q.sessionID || q.sessionID === msg.payload.sessionId
            );

            const snapshotSeq = this.nextSessionSequence(msg.payload.sessionId);
            rt.lastEventSequence = snapshotSeq;

            const res = createMessage(
              'SESSION_GET_RESULT',
              {
                deviceId: this.config.deviceId,
                session,
                messages,
                isStreaming,
                activeMessageId: rt.assistantMessageId || currentTurn?.messageId,
                streamingText: isStreaming ? rt.streamingText : undefined,
                diffs: rt.diffs,
                todos: rt.todos,
                runtime: {
                  status: isStreaming ? 'busy' : 'idle',
                  isStreaming,
                  agentInstanceId: this.agentInstanceId,
                  snapshotSequence: snapshotSeq,
                  activeTurnId: currentTurn?.turnId,
                  activeMessageId: rt.assistantMessageId || currentTurn?.messageId,
                  streamingText: isStreaming ? rt.streamingText : undefined,
                  parts: rt.parts,
                  todos: rt.todos,
                  diffs: rt.diffs,
                  pendingPermissions: sessionPerms,
                  pendingQuestions: sessionQuestions,
                  lastEventSequence: snapshotSeq,
                },
              },
              msg.id
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'SESSION_NOT_FOUND',
                message: err.message,
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'SESSION_DIFF_GET': {
          try {
            const diffs = await this.adapter.getSessionDiff(msg.payload.sessionId);
            const res = createMessage(
              'SESSION_DIFF_GET_RESULT',
              {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                diffs,
              },
              msg.id
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'DIFF_ERROR',
                message: err.message,
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'WORKSPACE_GET': {
          try {
            const project = await this.adapter.getProjectContext();
            const res = createMessage(
              'WORKSPACE_GET_RESULT',
              {
                deviceId: this.config.deviceId,
                project,
              },
              msg.id
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'WORKSPACE_ERROR',
                message: err.message,
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'MESSAGE_SEND': {
          try {
            const { sessionId, content, model, clientMessageId } = msg.payload;
            const messageId = await this.adapter.sendMessage(sessionId, content, model);

            // Mark turn active
            const turn = this.getOrCreateTurn(sessionId, messageId);
            turn.startedEmitted = true;
            const rt = this.getOrCreateRuntime(sessionId);
            rt.status = 'busy';
            rt.turnId = turn.turnId;
            rt.userMessageId = messageId;
            rt.streamingText = '';
            rt.parts = [];

            const seq = this.nextSessionSequence(sessionId);
            rt.lastEventSequence = seq;
            this.sendMessage(
              createMessage('MESSAGE_STARTED', {
                deviceId: this.config.deviceId,
                sessionId,
                messageId,
                clientMessageId,
                timestamp: Date.now(),
                sequence: seq,
                agentInstanceId: this.agentInstanceId,
                scope: 'session',
              })
            );

            // Fast ACK
            const ack = createMessage(
              'MESSAGE_SEND_ACK',
              {
                deviceId: this.config.deviceId,
                sessionId,
                messageId,
                clientMessageId,
                status: 'accepted',
              },
              msg.id
            );
            this.sendMessage(ack);
          } catch (err: any) {
            this.sendMessage(
              createMessage('MESSAGE_ERROR', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                error: err.message,
              })
            );
          }
          break;
        }

        case 'TODO_LIST_REQUEST': {
          try {
            const todos = await this.adapter.getTodos(msg.payload.sessionId);
            const res = createMessage(
              'TODO_LIST_RESULT',
              {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                todos,
              },
              msg.id
            );
            this.sendMessage(res);
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'TODO_LIST_FAILED',
                message: err.message || 'Failed to fetch todos',
                requestId: msg.id,
              })
            );
          }
          break;
        }

        // ==========================================
        // PTY Handlers
        // ==========================================
        case 'PTY_CREATE': {
          try {
            const pty = await this.adapter.createPty(msg.payload.title, msg.payload.command, msg.payload.cwd);
            // Auto connect websocket to OpenCode
            this.attachPtySocket(pty.id);
            this.sendMessage(
              createMessage('PTY_CREATE_RESULT', {
                deviceId: this.config.deviceId,
                pty,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'PTY_CREATE_FAILED',
                message: err.message || 'Failed to create PTY',
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'PTY_LIST': {
          try {
            const ptys = await this.adapter.listPtys();
            this.sendMessage(
              createMessage('PTY_LIST_RESULT', {
                deviceId: this.config.deviceId,
                ptys,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'PTY_LIST_FAILED',
                message: err.message || 'Failed to list PTYs',
                requestId: msg.id,
              })
            );
          }
          break;
        }

        case 'PTY_INPUT': {
          try {
            const ws = this.attachPtySocket(msg.payload.ptyId);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(msg.payload.data);
            }
          } catch (err: any) {
            console.warn(`[agent] Failed to send PTY input:`, err.message);
          }
          break;
        }

        case 'PTY_RESIZE': {
          try {
            await this.adapter.resizePty(msg.payload.ptyId, msg.payload.rows, msg.payload.cols);
          } catch (err: any) {
            console.warn(`[agent] Failed to resize PTY:`, err.message);
          }
          break;
        }

        case 'PTY_CLOSE': {
          try {
            const ws = this.ptySockets.get(msg.payload.ptyId);
            if (ws) {
              try { ws.close(); } catch {}
              this.ptySockets.delete(msg.payload.ptyId);
            }
            await this.adapter.closePty(msg.payload.ptyId);
          } catch (err: any) {
            console.warn(`[agent] Failed to close PTY:`, err.message);
          }
          break;
        }

        // ==========================================
        // Session Abort
        // ==========================================
        case 'SESSION_ABORT': {
          try {
            const success = await this.adapter.abortSession(msg.payload.sessionId);
            this.sendMessage(
              createMessage('SESSION_ABORT_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                success,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('SESSION_ABORT_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                success: false,
              }, msg.id)
            );
          }
          break;
        }

        // ==========================================
        // Model & Provider List
        // ==========================================
        case 'MODEL_LIST': {
          try {
            const { models, defaultModel } = await this.adapter.getProvidersAndModels();
            this.sendMessage(
              createMessage('MODEL_LIST_RESULT', {
                deviceId: this.config.deviceId,
                models,
                defaultModel,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('ERROR', {
                code: 'MODEL_LIST_FAILED',
                message: err.message || 'Failed to list models',
                requestId: msg.id,
              })
            );
          }
          break;
        }

        // ==========================================
        // Permission Handlers
        // ==========================================
        case 'PERMISSION_LIST': {
          try {
            const permissions = await this.adapter.listPermissions();
            this.sendMessage(
              createMessage('PERMISSION_LIST_RESULT', {
                deviceId: this.config.deviceId,
                permissions,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('PERMISSION_LIST_RESULT', {
                deviceId: this.config.deviceId,
                permissions: [],
              }, msg.id)
            );
          }
          break;
        }

        case 'PERMISSION_REPLY': {
          try {
            const success = await this.adapter.replyPermission(msg.payload.requestId, msg.payload.reply);
            if (success) {
              this.pendingPermissions.delete(msg.payload.requestId);
            }
            this.sendMessage(
              createMessage('PERMISSION_REPLY_RESULT', {
                deviceId: this.config.deviceId,
                requestId: msg.payload.requestId,
                success,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('PERMISSION_REPLY_RESULT', {
                deviceId: this.config.deviceId,
                requestId: msg.payload.requestId,
                success: false,
              }, msg.id)
            );
          }
          break;
        }

        case 'SESSION_FORK': {
          try {
            const forkedSession = await this.adapter.forkSession(msg.payload.sessionId, msg.payload.messageId);
            this.sendMessage(
              createMessage('SESSION_FORK_RESULT', {
                deviceId: this.config.deviceId,
                session: forkedSession,
              }, msg.id)
            );
          } catch (err: any) {
            console.error(`[agent] Fork session error: ${err.message}`);
          }
          break;
        }

        case 'SESSION_REVERT': {
          try {
            const { success, revertedPrompt } = await this.adapter.revertSession(msg.payload.sessionId, msg.payload.messageId);
            this.sendMessage(
              createMessage('SESSION_REVERT_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                success,
                revertedPrompt,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('SESSION_REVERT_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                success: false,
              }, msg.id)
            );
          }
          break;
        }

        case 'QUESTION_REPLY': {
          try {
            const success = await this.adapter.replyQuestion(msg.payload.requestId, msg.payload.answers);
            if (success) {
              this.pendingQuestions.delete(msg.payload.requestId);
            }
            this.sendMessage(
              createMessage('QUESTION_REPLY_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                requestId: msg.payload.requestId,
                success,
              }, msg.id)
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage('QUESTION_REPLY_RESULT', {
                deviceId: this.config.deviceId,
                sessionId: msg.payload.sessionId,
                requestId: msg.payload.requestId,
                success: false,
              }, msg.id)
            );
          }
          break;
        }

        case 'FS_LIST': {
          try {
            const entries = await this.adapter.listFs(msg.payload.path);
            this.sendMessage(
              createMessage(
                'FS_LIST_RESULT',
                {
                  deviceId: this.config.deviceId,
                  path: msg.payload.path,
                  entries,
                },
                msg.id
              )
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage(
                'FS_LIST_RESULT',
                {
                  deviceId: this.config.deviceId,
                  path: msg.payload.path,
                  entries: [],
                },
                msg.id
              )
            );
          }
          break;
        }

        case 'FS_FIND': {
          try {
            const entries = await this.adapter.findFs(msg.payload.query, msg.payload.limit);
            this.sendMessage(
              createMessage(
                'FS_FIND_RESULT',
                {
                  deviceId: this.config.deviceId,
                  query: msg.payload.query,
                  entries,
                },
                msg.id
              )
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage(
                'FS_FIND_RESULT',
                {
                  deviceId: this.config.deviceId,
                  query: msg.payload.query,
                  entries: [],
                },
                msg.id
              )
            );
          }
          break;
        }

        case 'FS_READ': {
          try {
            const { content, mime } = await this.adapter.readFs(msg.payload.path);
            this.sendMessage(
              createMessage(
                'FS_READ_RESULT',
                {
                  deviceId: this.config.deviceId,
                  path: msg.payload.path,
                  content,
                  mime,
                },
                msg.id
              )
            );
          } catch (err: any) {
            this.sendMessage(
              createMessage(
                'ERROR',
                {
                  code: 'FS_READ_ERROR',
                  message: err.message,
                  requestId: msg.id,
                },
                msg.id
              )
            );
          }
          break;
        }

        case 'PING': {
          const pong = createMessage('PONG', { nonce: msg.payload.nonce });
          this.sendMessage(pong);
          break;
        }

        default:
          break;
      }
    } catch (err: any) {
      console.warn(`[agent] Message handling error: ${err.message}`);
    }
  }

  private sendOpenCodeStatus(status: OpenCodeStatus, version?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = createMessage('OPENCODE_STATUS', {
      deviceId: this.config.deviceId,
      status,
      version,
    });
    this.sendMessage(msg);
  }

  private sendMessage(msg: ProtocolMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const ping = createMessage('PING', {
          nonce: Math.random().toString(36).slice(2, 9),
        });
        this.sendMessage(ping);
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    this.setState('RECONNECTING');
    this.stopHeartbeat();

    this.reconnectAttempt++;
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;

    console.log(`[agent] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempt})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
