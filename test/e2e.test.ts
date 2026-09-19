import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { buildRelayServer } from '../apps/relay/src/server.js';
import {
  createMessage,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  type DeviceInfo,
} from '../packages/protocol/src/index.js';

describe('Phase 2: End-to-End Pairing, Sessions & Streaming Flow', () => {
  let relayApp: any;
  let registry: any;
  let store: any;
  let port: number;
  let relayWsUrl: string;

  beforeAll(async () => {
    port = 4589;
    const server = buildRelayServer({ port, storePath: '.test-relay-store.json' });
    relayApp = server.app;
    registry = server.registry;
    store = server.store;

    await relayApp.listen({ port, host: '127.0.0.1' });
    relayWsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await relayApp.close();
  });

  it('runs complete Phase 2 flow: Pairing -> Revoke -> Session RPC -> Streaming Deltas', async () => {
    console.log('[test] Step 1: Connecting agent...');
    const agentWs = new WebSocket(relayWsUrl);
    await new Promise((resolve) => {
      agentWs.on('open', () => {
        console.log('[test] Agent WS open!');
        resolve(true);
      });
    });

    const agentHello = createMessage('AGENT_HELLO', {
      deviceId: 'dev_test_phase2_pc',
      deviceName: 'Darko-Phase2-PC',
      agentVersion: '0.2.0',
      os: 'win32',
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { sessions: true, streaming: true, permissions: true },
    });
    agentWs.send(JSON.stringify(agentHello));
    console.log('[test] Sent AGENT_HELLO, awaiting ack...');

    const agentAck = await new Promise<ProtocolMessage>((resolve) => {
      agentWs.on('message', (data) => {
        console.log('[test] Agent received raw message:', data.toString());
        resolve(parseProtocolMessage(data.toString()));
      });
    });
    console.log('[test] Agent ack received:', agentAck.type);
    let pairingCode = '';
    if (agentAck.type === 'AGENT_HELLO_ACK') {
      expect(agentAck.payload.paired).toBe(false);
      expect(agentAck.payload.pairingCode).toBeDefined();
      pairingCode = agentAck.payload.pairingCode!;
    }
    console.log('[test] Agent pairingCode is:', pairingCode);
    console.log('[test] Step 2: Connecting clientWs to:', relayWsUrl);
    const clientWs = new WebSocket(relayWsUrl);
    await new Promise((resolve) => {
      clientWs.on('open', () => {
        console.log('[test] clientWs open!');
        resolve(true);
      });
    });

    console.log('[test] Sending CLIENT_HELLO...');
    const clientHello = createMessage('CLIENT_HELLO', {
      clientId: 'client_pwa_phase2',
      clientVersion: '0.2.0',
      protocolVersion: PROTOCOL_VERSION,
    });
    clientWs.send(JSON.stringify(clientHello));

    console.log('[test] Awaiting CLIENT_HELLO_ACK...');
    const clientAck = await new Promise<ProtocolMessage>((resolve) => {
      clientWs.once('message', (data) => {
        console.log('[test] clientWs received:', data.toString());
        resolve(parseProtocolMessage(data.toString()));
      });
    });
    console.log('[test] clientAck:', clientAck.type);

    // 3. Test Invalid Pairing Code
    const badPairingPromise = new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'PAIRING_REQUEST_RESULT') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    const badPairingReq = createMessage('PAIRING_REQUEST', {
      code: '999-999',
      clientName: 'Darko Pixel Phone',
    });
    clientWs.send(JSON.stringify(badPairingReq));

    const badPairingRes = await badPairingPromise;
    expect(badPairingRes.type).toBe('PAIRING_REQUEST_RESULT');
    if (badPairingRes.type === 'PAIRING_REQUEST_RESULT') {
      expect(badPairingRes.payload.success).toBe(false);
    }

    // 4. Test Valid Pairing Flow
    // Agent listens for PAIRING_OFFER
    const pairingOfferPromise = new Promise<ProtocolMessage>((resolve) => {
      agentWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'PAIRING_OFFER') {
          agentWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    // Client sends valid code
    const validPairingReq = createMessage('PAIRING_REQUEST', {
      code: pairingCode,
      clientName: 'Darko Galaxy Phone',
    });
    clientWs.send(JSON.stringify(validPairingReq));

    const offer = await pairingOfferPromise;
    expect(offer.type).toBe('PAIRING_OFFER');
    let pairingId = '';
    if (offer.type === 'PAIRING_OFFER') {
      expect(offer.payload.code).toBe(pairingCode);
      pairingId = offer.payload.pairingId;
    }

    // Agent approves pairing
    const clientPairingCompletePromise = new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'PAIRING_COMPLETE') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    agentWs.send(JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId })));

    const completeMsg = await clientPairingCompletePromise;
    expect(completeMsg.type).toBe('PAIRING_COMPLETE');
    let deviceToken = '';
    if (completeMsg.type === 'PAIRING_COMPLETE') {
      expect(completeMsg.payload.success).toBe(true);
      expect(completeMsg.payload.deviceId).toBe('dev_test_phase2_pc');
      expect(completeMsg.payload.deviceToken).toBeDefined();
      deviceToken = completeMsg.payload.deviceToken;
    }

    // 5. Test Session Listing RPC
    // When client sends SESSION_LIST, agent responds with mock session list
    agentWs.on('message', function sessionListResponder(data) {
      const msg = parseProtocolMessage(data.toString());
      if (msg.type === 'SESSION_LIST') {
        const res = createMessage(
          'SESSION_LIST_RESULT',
          {
            deviceId: 'dev_test_phase2_pc',
            sessions: [
              { id: 'ses_1', title: 'Fix OAuth callback', createdAt: Date.now() - 60000 },
              { id: 'ses_2', title: 'Refactor mobile relay', createdAt: Date.now() - 120000 },
            ],
          },
          msg.id
        );
        agentWs.send(JSON.stringify(res));
      }
    });

    const sessionListReq = createMessage('SESSION_LIST', {
      deviceId: 'dev_test_phase2_pc',
      deviceToken,
    });
    clientWs.send(JSON.stringify(sessionListReq));

    const sessionListResult = await new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_LIST_RESULT') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    expect(sessionListResult.type).toBe('SESSION_LIST_RESULT');
    if (sessionListResult.type === 'SESSION_LIST_RESULT') {
      expect(sessionListResult.payload.sessions.length).toBe(2);
      expect(sessionListResult.payload.sessions[0].title).toBe('Fix OAuth callback');
    }

    // 6. Test Live Message Streaming
    const clientReceivedDeltaPromise = new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'MESSAGE_DELTA') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    // Agent broadcasts delta chunk
    const deltaMsg = createMessage('MESSAGE_DELTA', {
      deviceId: 'dev_test_phase2_pc',
      sessionId: 'ses_1',
      messageId: 'msg_stream_1',
      delta: 'Inspecting auth.ts route...',
      sequence: 1,
    });
    agentWs.send(JSON.stringify(deltaMsg));

    const receivedDelta = await clientReceivedDeltaPromise;
    expect(receivedDelta.type).toBe('MESSAGE_DELTA');
    if (receivedDelta.type === 'MESSAGE_DELTA') {
      expect(receivedDelta.payload.delta).toBe('Inspecting auth.ts route...');
    }

    // 7. Test Device Revocation
    const revokeMsg = createMessage('DEVICE_REVOKE', {
      deviceId: 'dev_test_phase2_pc',
      deviceToken,
    });
    clientWs.send(JSON.stringify(revokeMsg));

    const revokeResult = await new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'DEVICE_REVOKE_RESULT') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });
    expect(revokeResult.type).toBe('DEVICE_REVOKE_RESULT');
    if (revokeResult.type === 'DEVICE_REVOKE_RESULT') {
      expect(revokeResult.payload.success).toBe(true);
    }

    // 8. Test that post-revocation RPC is strictly rejected
    const postRevokePromise = new Promise<ProtocolMessage>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          resolve(msg);
        }
      });
    });

    clientWs.send(
      JSON.stringify(
        createMessage('SESSION_LIST', {
          deviceId: 'dev_test_phase2_pc',
          deviceToken, // Revoked token!
        })
      )
    );

    const postRevokeError = await postRevokePromise;
    expect(postRevokeError.type).toBe('ERROR');
    if (postRevokeError.type === 'ERROR') {
      expect(postRevokeError.payload.code).toBe('DEVICE_NOT_AUTHORIZED');
    }

    agentWs.close();
    clientWs.close();
  }, 20000);
});
