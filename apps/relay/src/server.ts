import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import {
  parseProtocolMessage,
  createMessage,
  type ProtocolMessage,
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

  app.register(websocket);

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async () => ({ status: 'ready' }));

  app.get('/api/devices', async () => ({
    devices: registry.getAllDevices(),
  }));

  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket: WebSocket) => {
      const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      let registeredDeviceId: string | null = null;
      let registeredClientId: string | null = null;

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

              // Generate short-lived pairing code so phone can pair
              const session = store.createPairingCode(deviceId, deviceName);
              const pairingCode = session.code;
              const pairingExpiresAt = session.expiresAt;

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
              const currentDevice = registry.getDevice(deviceId);
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
              const { clientId, clientVersion, pairedDeviceTokens } = message.payload;
              registeredClientId = clientId;

              registry.registerClient(clientId, clientVersion, socket, pairedDeviceTokens);

              const ack = createMessage('CLIENT_HELLO_ACK', {
                success: true,
                connectionId,
                serverTime: Date.now(),
              });
              socket.send(JSON.stringify(ack));

              // Send device list
              const resultMsg = createMessage('DEVICE_STATUS_RESULT', {
                devices: registry.getAllDevices(),
              });
              socket.send(JSON.stringify(resultMsg));
              break;
            }

            case 'DEVICE_STATUS_REQUEST': {
              socket.send(
                JSON.stringify(
                  createMessage('DEVICE_STATUS_RESULT', {
                    devices: registry.getAllDevices(),
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

                // Send directly to the client socket that initiated pairing
                const directClientSocket = pairingToClient.get(pairingId);
                if (directClientSocket && directClientSocket.readyState === WebSocket.OPEN) {
                  try {
                    directClientSocket.send(JSON.stringify(completeMsg));
                  } catch {}
                }
                pairingToClient.delete(pairingId);

                registry.broadcastToClients(completeMsg);

                // Broadcast updated device status
                const dev = registry.getDevice(record.deviceId);
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
                const dev = registry.getDevice(deviceId);
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
              } else {
                registry.broadcastToClients(message);
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
              } else {
                registry.broadcastToClients(message);
              }
              break;
            }

            case 'SESSION_GET': {
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
              if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
                clientSocket.send(JSON.stringify(message));
                requestToClient.delete(message.id);
              } else {
                registry.broadcastToClients(message);
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
              } else {
                registry.broadcastToClients(message);
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
              } else {
                registry.broadcastToClients(message);
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
              } else {
                registry.broadcastToClients(message);
              }
              break;
            }

            // Streamed deltas, completion, and events broadcast to all connected clients
            case 'MESSAGE_STARTED':
            case 'MESSAGE_DELTA':
            case 'MESSAGE_COMPLETED':
            case 'MESSAGE_ERROR':
            case 'OPENCODE_EVENT': {
              registry.broadcastToClients(message);
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
        if (registeredDeviceId) {
          const device = registry.unregisterAgent(registeredDeviceId, socket);
          if (device) {
            registry.broadcastToClients(createMessage('DEVICE_STATUS', device));
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
