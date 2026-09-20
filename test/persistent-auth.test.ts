import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import * as fs from 'fs';
import { buildRelayServer } from '../apps/relay/src/server.js';
import {
  createMessage,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  type DeviceInfo,
} from '../packages/protocol/src/index.js';

describe('Persistent Device Authorization & Lifecycle Overhaul', () => {
  const port = 4595;
  const storePath = '.test-persistent-auth-store.json';
  const relayWsUrl = `ws://127.0.0.1:${port}/ws`;
  let relayApp: any;
  let registry: any;
  let store: any;

  const TEST_DEVICE_ID = 'dev_persistent_test_pc';
  const TEST_DEVICE_NAME = 'Darko-Test-PC';
  const TEST_AGENT_CREDENTIAL = 'a'.repeat(64); // 32-byte hex CSPRNG string
  const FAKE_AGENT_CREDENTIAL = 'b'.repeat(64);

  beforeAll(async () => {
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
    const server = buildRelayServer({ port, storePath });
    relayApp = server.app;
    registry = server.registry;
    store = server.store;

    await relayApp.listen({ port, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await relayApp.close();
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
  });

  function openWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage<T extends ProtocolMessage>(
    ws: WebSocket,
    predicate: (msg: ProtocolMessage) => boolean,
    timeoutMs = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', handler);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for matching message`));
      }, timeoutMs);

      function handler(data: any) {
        try {
          const msg = parseProtocolMessage(data.toString());
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(msg as T);
          }
        } catch {}
      }

      ws.on('message', handler);
    });
  }

  let savedDeviceToken = '';
  let pairingCode = '';

  it('Step 1: First-time enrollment generates pairing code and sets up paired state', async () => {
    const agentWs = await openWs(relayWsUrl);

    // Agent sends AGENT_HELLO with its credential
    agentWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME,
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { sessions: true, streaming: true },
          agentCredential: TEST_AGENT_CREDENTIAL,
        })
      )
    );

    const agentAck = await waitForMessage(
      agentWs,
      (m) => m.type === 'AGENT_HELLO_ACK'
    );
    expect(agentAck.payload.paired).toBe(false);
    expect(agentAck.payload.pairingCode).toBeDefined();
    pairingCode = agentAck.payload.pairingCode!;
    expect(pairingCode).toMatch(/^\d{3}-\d{3}$/);

    // Mobile Client connects and enters the pairing code
    const clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_1',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForMessage(clientWs, (m) => m.type === 'CLIENT_HELLO_ACK');

    // Client requests pairing
    clientWs.send(
      JSON.stringify(
        createMessage('PAIRING_REQUEST', {
          code: pairingCode,
          clientName: 'Darko Galaxy S24',
        })
      )
    );

    // Agent receives PAIRING_OFFER and approves
    const offer = await waitForMessage(
      agentWs,
      (m) => m.type === 'PAIRING_OFFER'
    );
    agentWs.send(
      JSON.stringify(
        createMessage('PAIRING_APPROVE', {
          pairingId: offer.payload.pairingId,
        })
      )
    );

    // Client receives PAIRING_COMPLETE with deviceToken
    const complete = await waitForMessage(
      clientWs,
      (m) => m.type === 'PAIRING_COMPLETE'
    );
    expect(complete.payload.success).toBe(true);
    expect(complete.payload.deviceToken).toBeDefined();
    savedDeviceToken = complete.payload.deviceToken;
    expect(savedDeviceToken.startsWith('tok_')).toBe(true);

    agentWs.close();
    clientWs.close();
  });

  it('Step 2: Agent reconnect NEVER generates pairing code once paired', async () => {
    const agentWs = await openWs(relayWsUrl);

    // Reconnect with same credential
    agentWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME,
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { sessions: true },
          agentCredential: TEST_AGENT_CREDENTIAL,
        })
      )
    );

    const ack = await waitForMessage(
      agentWs,
      (m) => m.type === 'AGENT_HELLO_ACK'
    );

    // Must be marked paired, and pairingCode MUST be undefined!
    expect(ack.payload.paired).toBe(true);
    expect(ack.payload.pairingCode).toBeUndefined();

    agentWs.close();
  });

  it('Step 3: Malicious agent with wrong credential is rejected (impersonation prevention)', async () => {
    const agentWs = await openWs(relayWsUrl);

    agentWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: TEST_DEVICE_ID,
          deviceName: 'Hacker-PC',
          agentVersion: '0.3.0',
          os: 'linux',
          protocolVersion: PROTOCOL_VERSION,
          agentCredential: FAKE_AGENT_CREDENTIAL,
        })
      )
    );

    const err = await waitForMessage(
      agentWs,
      (m) => m.type === 'ERROR'
    );
    expect(err.payload.code).toBe('AGENT_NOT_AUTHORIZED');

    // Wait for socket to be closed by server
    const closed = await new Promise<boolean>((resolve) => {
      agentWs.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });
    expect(closed).toBe(true);
  });

  it('Step 4: Client reconnects with saved token without re-pairing', async () => {
    // Agent is running
    const agentWs = await openWs(relayWsUrl);
    agentWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME,
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
          agentCredential: TEST_AGENT_CREDENTIAL,
        })
      )
    );
    await waitForMessage(agentWs, (m) => m.type === 'AGENT_HELLO_ACK');

    // Mock agent answering SESSION_LIST
    agentWs.on('message', (data) => {
      const msg = parseProtocolMessage(data.toString());
      if (msg.type === 'SESSION_LIST') {
        agentWs.send(
          JSON.stringify(
            createMessage(
              'SESSION_LIST_RESULT',
              {
                deviceId: TEST_DEVICE_ID,
                sessions: [{ id: 'ses_1', title: 'Darko Project Session', createdAt: Date.now() }],
              },
              msg.id
            )
          )
        );
      }
    });

    // Client reconnects after browser reload with saved deviceToken
    const clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_reconnected',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: {
            [TEST_DEVICE_ID]: savedDeviceToken,
          },
        })
      )
    );
    await waitForMessage(clientWs, (m) => m.type === 'CLIENT_HELLO_ACK');

    // Client sends SESSION_LIST RPC immediately without any pairing code
    const rpcId = `req_${Date.now()}`;
    clientWs.send(
      JSON.stringify(
        createMessage(
          'SESSION_LIST',
          {
            deviceId: TEST_DEVICE_ID,
            deviceToken: savedDeviceToken,
          },
          rpcId
        )
      )
    );

    const res = await waitForMessage(
      clientWs,
      (m) => m.type === 'SESSION_LIST_RESULT' && m.id === rpcId
    );
    expect(res.payload.sessions).toBeDefined();
    expect(res.payload.sessions.length).toBe(1);
    expect(res.payload.sessions[0].title).toBe('Darko Project Session');

    const agentClosed = new Promise((resolve) => agentWs.on('close', resolve));
    agentWs.close();
    clientWs.close();
    await agentClosed;
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('Step 5: Offline devices are preserved and listed as offline instead of disappearing', async () => {
    // Both agent and client are disconnected.
    const clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_offline_check',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: {
            [TEST_DEVICE_ID]: savedDeviceToken,
          },
        })
      )
    );

    // Client receives device status result on hello
    const statusResult = await waitForMessage(
      clientWs,
      (m) => m.type === 'DEVICE_STATUS_RESULT'
    );
    const targetDev = statusResult.payload.devices.find(
      (d: DeviceInfo) => d.deviceId === TEST_DEVICE_ID
    );
    expect(targetDev).toBeDefined();
    expect(targetDev.online).toBe(false);
    expect(targetDev.paired).toBe(true);
    expect(targetDev.opencodeStatus).toBe('unavailable');

    clientWs.close();
  });

  it('Step 6: Relay restart preserves authorized devices and saved tokens across restarts', async () => {
    // Shut down existing relay server instance
    await relayApp.close();

    // Boot a fresh relay server instance pointing to the exact same store file
    const rebootedServer = buildRelayServer({ port, storePath });
    relayApp = rebootedServer.app;
    registry = rebootedServer.registry;
    store = rebootedServer.store;
    await relayApp.listen({ port, host: '127.0.0.1' });

    // Client connects to rebooted relay
    const clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_after_reboot',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: {
            [TEST_DEVICE_ID]: savedDeviceToken,
          },
        })
      )
    );

    const devResult = await waitForMessage(
      clientWs,
      (m) => m.type === 'DEVICE_STATUS_RESULT'
    );
    const targetDev = devResult.payload.devices.find(
      (d: DeviceInfo) => d.deviceId === TEST_DEVICE_ID
    );
    // Device was loaded from disk into rebooted relay!
    expect(targetDev).toBeDefined();
    expect(targetDev.paired).toBe(true);
    expect(targetDev.online).toBe(false);

    // Agent also reconnects to rebooted relay
    const agentWs = await openWs(relayWsUrl);
    agentWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME,
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
          agentCredential: TEST_AGENT_CREDENTIAL,
        })
      )
    );
    const agentAck = await waitForMessage(
      agentWs,
      (m) => m.type === 'AGENT_HELLO_ACK'
    );
    // Zero pairing code requested!
    expect(agentAck.payload.paired).toBe(true);
    expect(agentAck.payload.pairingCode).toBeUndefined();

    agentWs.close();
    clientWs.close();
  });

  it('Step 7: Explicit revoke revokes device and rejects subsequent token use', async () => {
    const clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_revoker',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: {
            [TEST_DEVICE_ID]: savedDeviceToken,
          },
        })
      )
    );
    await waitForMessage(clientWs, (m) => m.type === 'CLIENT_HELLO_ACK');

    // Revoke device explicitly
    clientWs.send(
      JSON.stringify(
        createMessage('DEVICE_REVOKE', {
          deviceId: TEST_DEVICE_ID,
          deviceToken: savedDeviceToken,
        })
      )
    );

    const revokeRes = await waitForMessage(
      clientWs,
      (m) => m.type === 'DEVICE_REVOKE_RESULT'
    );
    expect(revokeRes.payload.success).toBe(true);

    // Try to perform RPC with revoked token
    clientWs.send(
      JSON.stringify(
        createMessage('SESSION_LIST', {
          deviceId: TEST_DEVICE_ID,
          deviceToken: savedDeviceToken,
        })
      )
    );

    const authErr = await waitForMessage(
      clientWs,
      (m) => m.type === 'ERROR'
    );
    expect(authErr.payload.code).toBe('DEVICE_NOT_AUTHORIZED');

    clientWs.close();
  });
});
