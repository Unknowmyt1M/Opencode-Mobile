import WebSocket from 'ws';
import {
  parseProtocolMessage,
  createMessage,
  PROTOCOL_VERSION,
  type ConnectionState,
  type ProtocolMessage,
  type OpenCodeStatus,
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
  private sequence = 1;
  private paired = false;

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

  private sessionTurns: Map<string, { messageId: string; startedEmitted: boolean; completedEmitted: boolean }> = new Map();

  private handleOpenCodeEvent(evt: any) {
    if (!evt || !evt.type) return;

    const eventType = evt.type;
    const props = evt.properties || evt.data || {};
    const sessionId = props.sessionID || evt.sessionID;

    if (!sessionId) {
      // Global/non-session event: broadcast raw event only
      const opencodeEvt = createMessage('OPENCODE_EVENT', {
        deviceId: this.config.deviceId,
        eventType,
        payload: evt,
        sequence: this.sequence++,
      });
      this.sendMessage(opencodeEvt);
      return;
    }

    let turn = this.sessionTurns.get(sessionId);
    const incomingMessageId = props.assistantMessageID || props.messageID;

    if (!turn) {
      const messageId = incomingMessageId || `msg_${sessionId}_${Date.now()}`;
      turn = { messageId, startedEmitted: false, completedEmitted: false };
      this.sessionTurns.set(sessionId, turn);
    } else if (incomingMessageId && turn.messageId !== incomingMessageId) {
      // OpenCode provided official assistant message ID
      turn.messageId = incomingMessageId;
    }

    const currentMessageId = turn.messageId;

    // Helper to emit MESSAGE_STARTED exactly once per turn
    const ensureStarted = () => {
      if (!turn.startedEmitted) {
        turn.startedEmitted = true;
        const msg = createMessage('MESSAGE_STARTED', {
          deviceId: this.config.deviceId,
          sessionId,
          messageId: currentMessageId,
          timestamp: Date.now(),
        });
        this.sendMessage(msg);
      }
    };

    // 1. Text streaming delta
    if (eventType === 'session.next.text.delta' && props.delta) {
      ensureStarted();
      const msg = createMessage('MESSAGE_DELTA', {
        deviceId: this.config.deviceId,
        sessionId,
        messageId: currentMessageId,
        delta: props.delta,
        sequence: this.sequence++,
      });
      this.sendMessage(msg);
    } else if (eventType === 'message.part.delta' && props.delta) {
      ensureStarted();
      const msg = createMessage('MESSAGE_DELTA', {
        deviceId: this.config.deviceId,
        sessionId,
        messageId: currentMessageId,
        delta: props.delta,
        sequence: this.sequence++,
      });
      this.sendMessage(msg);
    } else if (
      eventType === 'session.next.text.started' ||
      eventType === 'session.next.step.started' ||
      eventType === 'session.step.started'
    ) {
      ensureStarted();
    } else if (
      eventType === 'session.idle' ||
      eventType === 'session.next.text.ended' ||
      eventType === 'session.next.step.ended' ||
      (eventType === 'session.status' && props.status?.type === 'idle')
    ) {
      // Complete turn if not already completed
      if (!turn.completedEmitted) {
        turn.completedEmitted = true;
        ensureStarted(); // In case response was instant/empty
        const msg = createMessage('MESSAGE_COMPLETED', {
          deviceId: this.config.deviceId,
          sessionId,
          messageId: currentMessageId,
          totalText: props.text,
          timestamp: Date.now(),
        });
        this.sendMessage(msg);

        // Schedule cleanup so subsequent turns get a fresh turn object
        setTimeout(() => {
          if (this.sessionTurns.get(sessionId) === turn) {
            this.sessionTurns.delete(sessionId);
          }
        }, 2000);
      }
    } else if (eventType === 'session.error') {
      const errorText =
        props.error?.data?.message ||
        props.error?.message ||
        (typeof props.error === 'string' ? props.error : 'OpenCode session error');
      const msg = createMessage('MESSAGE_ERROR', {
        deviceId: this.config.deviceId,
        sessionId,
        error: errorText,
      });
      this.sendMessage(msg);
      this.sessionTurns.delete(sessionId);
    }

    // Always broadcast raw event for observability
    const opencodeEvt = createMessage('OPENCODE_EVENT', {
      deviceId: this.config.deviceId,
      eventType,
      payload: evt,
      sequence: this.sequence++,
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
      deviceToken: this.config.deviceCredential,
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
            console.log('[agent] ✓ Device has existing paired tokens.');
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
            const res = createMessage(
              'SESSION_LIST_RESULT',
              {
                deviceId: this.config.deviceId,
                sessions,
              },
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
            const res = createMessage(
              'SESSION_GET_RESULT',
              {
                deviceId: this.config.deviceId,
                session,
                messages,
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
            const { sessionId, content } = msg.payload;
            const messageId = await this.adapter.sendMessage(sessionId, content);

            // Fast ACK
            const ack = createMessage(
              'MESSAGE_SEND_ACK',
              {
                deviceId: this.config.deviceId,
                sessionId,
                messageId,
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
