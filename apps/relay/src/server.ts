import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import {
  parseProtocolMessage,
  createMessage,
  type ProtocolMessage,
  type QueuedMessage,
} from '@opencode-remote/protocol';
import { DeviceRegistry } from './registry.js';
import { RelayStore } from './store.js';

export interface RelayOptions {
  port?: number;
  host?: string;
  corsOrigin?: boolean | string | RegExp | Array<string | RegExp>;
  storePath?: string;
}

export function buildRelayServer(options: RelayOptions = {}): {
  app: FastifyInstance;
  registry: DeviceRegistry;
  store: RelayStore;
} {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
  });

  const registry = new DeviceRegistry();
  const store = new RelayStore(options.storePath);

  // Map to route RPC replies to specific client sockets: requestId -> clientSocket
  const requestToClient = new Map<string, WebSocket>();
  const pairingToClient = new Map<string, WebSocket>();

  app.register(cors, {
    origin: options.corsOrigin ?? true,
  });

  app.register(websocket, {
    options: {
      maxPayload: 52428800, // 50MB
    },
  });

  app.get('/health', async () => ({
    status: store.isPersistenceHealthy() ? 'ok' : 'degraded',
    persistence: store.isPersistenceHealthy(),
  }));
  app.get('/ready', async () => ({
    status: store.isPersistenceHealthy() ? 'ready' : 'not_ready',
    persistence: store.isPersistenceHealthy(),
  }));

  app.get('/api/devices', async () => ({
    devices: registry.getAllMergedDevices(store.getAllPersistedDevices()),
  }));

  const processedMutationIds = new Map<string, { revision: number; timestamp: number }>();

  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket: WebSocket) => {
      const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      let registeredDeviceId: string | null = null;
      let registeredClientId: string | null = null;

      const ensureClientAuthorized = (devId: string, tok?: string) => {
        if (!tok) return;
        const c = registeredClientId
          ? { clientId: registeredClientId }
          : registry.findClientBySocket(socket);
        if (c && store.verifyDeviceToken(devId, tok)) {
          registry.addClientDeviceToken(c.clientId, devId, tok);
        }
      };

      app.log.info({ connectionId }, '[relay] incoming websocket connection');

      socket.on('message', (rawData) => {
        try {
          const message: ProtocolMessage = parseProtocolMessage(rawData.toString());

          switch (message.type) {
            // ==========================================
            // Handshakes
            // ==========================================
            case 'AGENT_HELLO': {
              const { deviceId, deviceName, agentVersion, os, capabilities } = message.payload;
              const agentCredential = message.payload.agentCredential || message.payload.deviceToken;

              // Authenticate agent credential
              const agentAuthenticated = store.verifyAgentCredential(deviceId, agentCredential, {
                deviceName,
                agentVersion,
                os,
                capabilities,
              });

              if (!agentAuthenticated) {
                app.log.warn({ deviceId, connectionId }, '[relay] Agent authentication failed: credential mismatch');
                const err = createMessage('ERROR', {
                  code: 'AGENT_NOT_AUTHORIZED',
                  message: 'Agent authentication failed: credential mismatch for this device',
                  requestId: message.id,
                });
                socket.send(JSON.stringify(err));
                socket.close(4001, 'Agent credential mismatch');
                return;
              }

              registeredDeviceId = deviceId;
              const isPaired = store.isDevicePaired(deviceId);

              registry.registerAgent(
                deviceId,
                {
                  deviceName,
                  agentVersion,
                  os,
                  capabilities,
                  paired: isPaired,
                },
                socket
              );

              // Generate pairing code if device is NOT already paired, or if explicitly requested
              let pairingCode: string | undefined;
              let pairingExpiresAt: number | undefined;

              const shouldGeneratePairing = !isPaired || Boolean((message.payload as any)?.requestPairingCode);

              if (shouldGeneratePairing) {
                const session = store.createPairingCode(deviceId, deviceName);
                pairingCode = session.code;
                pairingExpiresAt = session.expiresAt;
                console.log(`[relay] >>> PAIRING CODE FOR ${deviceId}: ${pairingCode} <<<`);
              }

              const ack = createMessage('AGENT_HELLO_ACK', {
                success: true,
                connectionId,
                serverTime: Date.now(),
                paired: isPaired,
                pairingCode,
                pairingExpiresAt,
              });
              socket.send(JSON.stringify(ack));

              // Broadcast updated DeviceStatus to clients
              const currentDevice = registry.getMergedDevice(deviceId, store.getDeviceRecord(deviceId));
              if (currentDevice) {
                const statusMsg = createMessage('DEVICE_STATUS', {
                  deviceId: currentDevice.deviceId,
                  deviceName: currentDevice.deviceName,
                  online: currentDevice.online,
                  paired: currentDevice.paired,
                  agentVersion: currentDevice.agentVersion,
                  os: currentDevice.os,
                  opencodeStatus: currentDevice.opencodeStatus,
                  opencodeVersion: currentDevice.opencodeVersion,
                  lastSeen: currentDevice.lastSeen,
                });
                registry.broadcastToClients(statusMsg);
              }
              break;
            }

            case 'CLIENT_HELLO': {
              const { clientId, clientVersion } = message.payload;
              const rawTokens =
                message.payload.pairedDeviceTokens || (message.payload as any).tokens;
              registeredClientId = clientId;

              // Validate supplied device tokens against store
              const validatedTokens: Record<string, string> = {};
              if (rawTokens && typeof rawTokens === 'object') {
                for (const [devId, tok] of Object.entries(rawTokens)) {
                  if (typeof tok === 'string' && store.verifyDeviceToken(devId, tok)) {
                    validatedTokens[devId] = tok;
                  }
                }
              }

              registry.registerClient(clientId, clientVersion, socket, validatedTokens);

              const ack = createMessage('CLIENT_HELLO_ACK', {
                success: true,
                connectionId,
                serverTime: Date.now(),
              });
              socket.send(JSON.stringify(ack));

              // Send merged device list (live + persisted offline)
              const resultMsg = createMessage('DEVICE_STATUS_RESULT', {
                devices: registry.getAllMergedDevices(store.getAllPersistedDevices()),
              });
              socket.send(JSON.stringify(resultMsg));
              break;
            }

            case 'DEVICE_STATUS_REQUEST': {
              socket.send(
                JSON.stringify(
                  createMessage('DEVICE_STATUS_RESULT', {
                    devices: registry.getAllMergedDevices(store.getAllPersistedDevices()),
                  })
                )
              );
              break;
            }

            // ==========================================
            // Pairing Flow
            // ==========================================
            case 'PAIRING_REQUEST': {
              const { code, clientName } = message.payload;
              const clientKey = registeredClientId || connectionId;

              if (store.isClientRateLimited(clientKey)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'RATE_LIMITED',
                      message: 'Too many pairing attempts. Please wait before trying again.',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              const session = store.findPairingByCode(code);

              if (!session) {
                store.recordClientAttempt(clientKey);
                const { locked } = store.recordFailedPairingAttempt(code);
                const res = createMessage(
                  'PAIRING_REQUEST_RESULT',
                  {
                    success: false,
                    status: 'expired',
                    message: locked
                      ? 'Pairing code locked due to excessive failed attempts'
                      : 'Invalid or expired pairing code',
                  },
                  message.id
                );
                socket.send(JSON.stringify(res));
                return;
              }

              // Send offer to the agent
              const agentSocket = registry.getAgentSocket(session.deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                const res = createMessage(
                  'PAIRING_REQUEST_RESULT',
                  {
                    success: false,
                    pairingId: session.pairingId,
                    status: 'rejected',
                    message: 'Host computer is offline',
                  },
                  message.id
                );
                socket.send(JSON.stringify(res));
                return;
              }

              // Route offer to Agent
              const offer = createMessage('PAIRING_OFFER', {
                pairingId: session.pairingId,
                code: session.code,
                clientName: clientName || 'Mobile Phone',
                expiresAt: session.expiresAt,
              });
              pairingToClient.set(session.pairingId, socket);
              agentSocket.send(JSON.stringify(offer));

              // Respond to client
              const res = createMessage(
                'PAIRING_REQUEST_RESULT',
                {
                  success: true,
                  pairingId: session.pairingId,
                  status: 'pending',
                  message: 'Pairing request sent to computer for approval',
                },
                message.id
              );
              socket.send(JSON.stringify(res));
              break;
            }

            case 'PAIRING_APPROVE': {
              const { pairingId } = message.payload;
              const approved = store.approvePairing(pairingId);

              if (approved) {
                const { deviceToken, record } = approved;
                registry.setDevicePaired(record.deviceId, true);

                // Send ack to agent
                socket.send(
                  JSON.stringify(
                    createMessage('PAIRING_APPROVE_RESULT', {
                      success: true,
                      pairingId,
                    })
                  )
                );

                // Broadcast completion to clients
                const completeMsg = createMessage('PAIRING_COMPLETE', {
                  success: true,
                  deviceId: record.deviceId,
                  deviceName: record.deviceName,
                  deviceToken,
                });

                // Send directly to the client socket that initiated pairing ONLY
                const directClientSocket = pairingToClient.get(pairingId);
                if (directClientSocket && directClientSocket.readyState === WebSocket.OPEN) {
                  try {
                    directClientSocket.send(JSON.stringify(completeMsg));
                  } catch {}
                  const client = registry.findClientBySocket(directClientSocket);
                  if (client) {
                    registry.addClientDeviceToken(client.clientId, record.deviceId, deviceToken);
                  }
                }
                pairingToClient.delete(pairingId);

                // Broadcast updated device status (public status only, no token)
                const dev = registry.getMergedDevice(record.deviceId, record);
                if (dev) {
                  registry.broadcastToClients(createMessage('DEVICE_STATUS', dev));
                }
              } else {
                socket.send(
                  JSON.stringify(
                    createMessage('PAIRING_APPROVE_RESULT', {
                      success: false,
                      pairingId,
                      message: 'Pairing session expired or not found',
                    })
                  )
                );
              }
              break;
            }

            case 'PAIRING_REJECT': {
              const { pairingId } = message.payload;
              store.rejectPairing(pairingId);
              socket.send(
                JSON.stringify(
                  createMessage('PAIRING_REJECT_RESULT', {
                    success: true,
                    pairingId,
                  })
                )
              );
              break;
            }

            case 'DEVICE_REVOKE': {
              const { deviceId, deviceToken } = message.payload;
              if (store.verifyDeviceToken(deviceId, deviceToken)) {
                store.revokeDevice(deviceId);
                registry.setDevicePaired(deviceId, false);
                registry.removeClientDeviceToken(deviceId);

                socket.send(
                  JSON.stringify(
                    createMessage('DEVICE_REVOKE_RESULT', {
                      success: true,
                      deviceId,
                    })
                  )
                );

                // Broadcast updated status
                const dev = registry.getMergedDevice(deviceId, store.getDeviceRecord(deviceId));
                if (dev) {
                  registry.broadcastToClients(createMessage('DEVICE_STATUS', dev));
                }
              } else {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Unauthorized device revocation attempt',
                    })
                  )
                );
              }
              break;
            }

            // ==========================================
            // Session & Message RPC Routing (Relay <-> Agent)
            // ==========================================
            case 'SESSION_LIST': {
              const { deviceId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'SESSION_LIST_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'SESSION_CREATE': {
              const { deviceId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'SESSION_CREATE_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'SESSION_GET': {
              const { deviceId, deviceToken } = message.payload;
              console.log('[relay] Received SESSION_GET:', message.id, message.payload.sessionId, 'dir:', message.payload.directory, 'tokenValid:', store.verifyDeviceToken(deviceId, deviceToken));
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'SESSION_GET_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              console.log('[relay] Handling SESSION_GET_RESULT:', message.id, 'clientSocketFound:', Boolean(clientSocket));
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'SESSION_DIFF_GET': {
              const { deviceId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'SESSION_DIFF_GET_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'WORKSPACE_GET': {
              const { deviceId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'WORKSPACE_GET_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'MESSAGE_SEND': {
              const { deviceId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'MESSAGE_SEND_ACK': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            // Streamed deltas, completion, and events broadcast only to authorized clients
            case 'MESSAGE_STARTED':
            case 'MESSAGE_DELTA':
            case 'MESSAGE_COMPLETED':
            case 'MESSAGE_ERROR':
            case 'OPENCODE_EVENT':
            case 'PERMISSION_REQUEST':
            case 'PTY_OUTPUT':
            case 'PTY_CLOSED':
            case 'TODO_UPDATED':
            case 'SESSION_DIFF_UPDATED': {
              const { deviceId } = message.payload as { deviceId?: string };
              if (deviceId) {
                if (message.type === 'PTY_CLOSED' && (message.payload as any).ptyId) {
                  registry.unregisterPty((message.payload as any).ptyId);
                } else if (message.type === 'PTY_OUTPUT' && (message.payload as any).ptyId) {
                  if (!registry.getPty((message.payload as any).ptyId)) {
                    registry.registerPty((message.payload as any).ptyId, deviceId);
                  }
                } else if (message.type === 'OPENCODE_EVENT') {
                  const ev = (message.payload as any)?.payload || (message.payload as any)?.event;
                  const deletedSessionId = ev?.properties?.sessionID || ev?.sessionID;
                  if (ev?.type === 'session.deleted' && deletedSessionId) {
                    store.deleteSessionQueue(deviceId, deletedSessionId);
                  }
                }

                registry.broadcastToAuthorizedClients(
                  deviceId,
                  message,
                  (devId, token) => store.verifyDeviceToken(devId, token)
                );
              }
              break;
            }

            // Remote Queue Authoritative Synchronization
            case 'SESSION_QUEUE_GET': {
              const { deviceId, sessionId, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const stored = store.getSessionQueue(deviceId, sessionId);
              const syncMsg = createMessage('SESSION_QUEUE_SYNC', {
                deviceId,
                sessionId,
                queue: stored ? stored.messages : [],
                revision: stored ? stored.revision : 0,
              });
              socket.send(JSON.stringify(syncMsg));
              break;
            }

            case 'SESSION_QUEUE_UPDATE': {
              const { deviceId, sessionId, clientId, mutationId, baseRevision, queue, deviceToken } = message.payload;
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              // 1. Idempotency check: if mutationId has already been successfully processed, return cached result
              if (mutationId && store.hasProcessedMutation(mutationId, deviceId, sessionId)) {
                const cached = store.hasProcessedMutation(mutationId, deviceId, sessionId)!;
                socket.send(
                  JSON.stringify(
                    createMessage('SESSION_QUEUE_UPDATE_RESULT', {
                      accepted: true,
                      deviceId,
                      sessionId,
                      revision: cached.revision,
                      mutationId,
                    })
                  )
                );
                return;
              }

              // 2. Conflict check against current authoritative revision
              const current = store.getSessionQueue(deviceId, sessionId) || {
                deviceId,
                sessionId,
                revision: 0,
                messages: [],
                updatedAt: Date.now(),
              };

              const expectedBaseRevision = current.revision;
              if (baseRevision !== undefined && baseRevision !== expectedBaseRevision) {
                // Conflict detected!
                socket.send(
                  JSON.stringify(
                    createMessage('SESSION_QUEUE_CONFLICT', {
                      deviceId,
                      sessionId,
                      currentRevision: current.revision,
                      authoritativeQueue: current.messages,
                      rejectedMutationId: mutationId,
                    })
                  )
                );
                return;
              }

              // 3. Mutation accepted
              const nextRevision = current.revision + 1;
              const updatedRecord = {
                deviceId,
                sessionId,
                revision: nextRevision,
                messages: queue,
                updatedAt: Date.now(),
              };

              store.saveSessionQueue(updatedRecord);

              if (mutationId) {
                store.recordProcessedMutation(mutationId, nextRevision, deviceId, sessionId);
              }

              // 4. Send ACK to requesting client
              socket.send(
                JSON.stringify(
                  createMessage('SESSION_QUEUE_UPDATE_RESULT', {
                    accepted: true,
                    deviceId,
                    sessionId,
                    revision: nextRevision,
                    mutationId,
                  })
                )
              );

              // 5. Broadcast authoritative synchronized queue state to all authorized clients
              const syncMsg = createMessage('SESSION_QUEUE_SYNC', {
                deviceId,
                sessionId,
                queue,
                revision: nextRevision,
                mutationId,
              });
              registry.broadcastToAuthorizedClients(
                deviceId,
                syncMsg,
                (devId, tok) => store.verifyDeviceToken(devId, tok)
              );
              break;
            }

            case 'PTY_CREATE':
            case 'PTY_LIST':
            case 'PROJECT_LIST':
            case 'SESSION_LIST_GLOBAL':
            case 'SESSION_LIST_PROJECT':
            case 'SESSION_ABORT':
            case 'SESSION_FORK':
            case 'SESSION_REVERT':
            case 'QUESTION_REPLY':
            case 'MODEL_LIST':
            case 'PERMISSION_LIST':
            case 'PERMISSION_REPLY':
            case 'TODO_LIST_REQUEST':
            case 'FS_LIST':
            case 'FS_FIND':
            case 'FS_READ':
            case 'MCP_LIST':
            case 'MCP_TOGGLE':
            case 'PLUGIN_LIST':
            case 'LSP_LIST': {
              const { deviceId, deviceToken } = message.payload as { deviceId: string; deviceToken?: string };
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const agentSocket = registry.getAgentSocket(deviceId);
              if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_OFFLINE',
                      message: 'Target computer is offline',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              requestToClient.set(message.id, socket);
              agentSocket.send(JSON.stringify(message));
              break;
            }

            case 'PTY_CREATE_RESULT': {
              if (message.payload?.pty?.id && message.payload?.deviceId) {
                registry.registerPty(message.payload.pty.id, message.payload.deviceId);
              }
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'PTY_LIST_RESULT': {
              if (Array.isArray(message.payload?.ptys) && message.payload?.deviceId) {
                for (const p of message.payload.ptys) {
                  if (p?.id) {
                    registry.registerPty(p.id, message.payload.deviceId);
                  }
                }
              }
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'PERMISSION_REPLY_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              }
              if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'PROJECT_LIST_RESULT':
            case 'SESSION_LIST_GLOBAL_RESULT':
            case 'SESSION_LIST_PROJECT_RESULT':
            case 'SESSION_ABORT_RESULT':
            case 'SESSION_FORK_RESULT':
            case 'SESSION_REVERT_RESULT':
            case 'QUESTION_REPLY_RESULT':
            case 'MODEL_LIST_RESULT':
            case 'PERMISSION_LIST_RESULT':
            case 'TODO_LIST_RESULT':
            case 'FS_LIST_RESULT':
            case 'FS_FIND_RESULT':
            case 'FS_READ_RESULT':
            case 'MCP_LIST_RESULT':
            case 'MCP_TOGGLE_RESULT':
            case 'PLUGIN_LIST_RESULT':
            case 'LSP_LIST_RESULT': {
              const clientSocket = requestToClient.get(message.id);
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else if (message.payload?.deviceId) {
                registry.broadcastToAuthorizedClients(
                  message.payload.deviceId,
                  message,
                  (d, t) => store.verifyDeviceToken(d, t)
                );
              }
              break;
            }

            case 'PTY_INPUT':
            case 'PTY_RESIZE':
            case 'PTY_CLOSE': {
              const { deviceId, deviceToken, ptyId } = message.payload as {
                deviceId: string;
                deviceToken?: string;
                ptyId: string;
              };
              if (!store.verifyDeviceToken(deviceId, deviceToken)) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'DEVICE_NOT_AUTHORIZED',
                      message: 'Access denied: invalid or revoked device token',
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              ensureClientAuthorized(deviceId, deviceToken);

              const pty = registry.getPty(ptyId);
              if (!pty) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'PTY_NOT_FOUND',
                      message: `PTY session ${ptyId} not found`,
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              if (pty.deviceId !== deviceId) {
                socket.send(
                  JSON.stringify(
                    createMessage('ERROR', {
                      code: 'PTY_ACCESS_DENIED',
                      message: `PTY session ${ptyId} does not belong to device ${deviceId}`,
                      requestId: message.id,
                    })
                  )
                );
                return;
              }

              const agentSocket = registry.getAgentSocket(deviceId);
              if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
                agentSocket.send(JSON.stringify(message));
              }
              break;
            }

            case 'OPENCODE_STATUS': {
              const { deviceId, status, version, message: statusMsgText } = message.payload;
              const updated = registry.updateOpenCodeStatus(deviceId, status, version);

              if (updated) {
                registry.broadcastToClients(
                  createMessage('OPENCODE_STATUS', {
                    deviceId,
                    status,
                    version,
                    message: statusMsgText,
                  })
                );
                registry.broadcastToClients(createMessage('DEVICE_STATUS', updated));
              }
              break;
            }

            case 'PING': {
              socket.send(JSON.stringify(createMessage('PONG', { nonce: message.payload.nonce })));
              break;
            }

            case 'PONG': {
              break;
            }

            default:
              break;
          }
        } catch (err: any) {
          console.error('[relay] Error parsing message from socket:', err);
          try {
            socket.send(
              JSON.stringify(
                createMessage('ERROR', {
                  code: 'INVALID_PROTOCOL_MESSAGE',
                  message: err.message || 'Malformed message',
                })
              )
            );
          } catch {}
        }
      });

      socket.on('close', () => {
        // Clean up pending requests registered for this client socket to prevent memory leaks / stale routing
        for (const [reqId, clientSock] of requestToClient.entries()) {
          if (clientSock === socket) {
            requestToClient.delete(reqId);
          }
        }

        if (registeredDeviceId) {
          registry.clearPtysForDevice(registeredDeviceId);
          registry.unregisterAgent(registeredDeviceId, socket);
          const dev = registry.getMergedDevice(
            registeredDeviceId,
            store.getDeviceRecord(registeredDeviceId)
          );
          if (dev) {
            registry.broadcastToClients(createMessage('DEVICE_STATUS', dev));
          }
        }
        if (registeredClientId) {
          registry.unregisterClient(registeredClientId, socket);
        }
      });
    });
  });

  return { app, registry, store };
}
