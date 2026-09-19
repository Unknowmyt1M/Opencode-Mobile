import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import * as fs from 'fs';
import { buildRelayServer } from '../apps/relay/src/server.js';
import {
  createMessage,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type ProtocolMessage,
} from '../packages/protocol/src/index.js';

describe('Security & Cross-Device Isolation', () => {
  let relayApp: any;
  let registry: any;
  let store: any;
  const port = 4591;
  const storePath = '.test-isolation-store.json';
  const relayWsUrl = `ws://127.0.0.1:${port}/ws`;

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

  function waitForNextMessage(ws: WebSocket): Promise<ProtocolMessage> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(parseProtocolMessage(data.toString()));
      });
    });
  }

  it('Pairing Privacy: Client B never receives PAIRING_COMPLETE or deviceToken of Device A', async () => {
    // 1. Connect Agent A
    const agentAWs = await openWs(relayWsUrl);
    agentAWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: 'dev_iso_A',
          deviceName: 'Isolation-Device-A',
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { sessions: true, streaming: true, terminal: true },
        })
      )
    );

    const agentAck = await waitForNextMessage(agentAWs);
    expect(agentAck.type).toBe('AGENT_HELLO_ACK');
    const pairingCode = (agentAck.payload as any).pairingCode;
    expect(pairingCode).toBeDefined();

    // 2. Connect Client A
    const clientAWs = await openWs(relayWsUrl);
    clientAWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_iso_A',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const clientAAck = await waitForNextMessage(clientAWs);
    expect(clientAAck.type).toBe('CLIENT_HELLO_ACK');

    // 3. Connect Client B (eavesdropper / other user)
    const clientBWs = await openWs(relayWsUrl);
    clientBWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_iso_B',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const clientBAck = await waitForNextMessage(clientBWs);
    expect(clientBAck.type).toBe('CLIENT_HELLO_ACK');

    // Collect all messages received by Client B
    const clientBMessages: ProtocolMessage[] = [];
    clientBWs.on('message', (data) => {
      clientBMessages.push(parseProtocolMessage(data.toString()));
    });

    // 4. Client A initiates pairing
    clientAWs.send(
      JSON.stringify(
        createMessage('PAIRING_REQUEST', {
          code: pairingCode,
          clientName: 'Client-A-Phone',
        })
      )
    );

    // Agent A gets PAIRING_OFFER
    const offerMsg = await waitForNextMessage(agentAWs);
    expect(offerMsg.type).toBe('PAIRING_OFFER');
    const pairingId = (offerMsg.payload as any).pairingId;

    // Agent A approves pairing
    agentAWs.send(
      JSON.stringify(
        createMessage('PAIRING_APPROVE', {
          pairingId,
        })
      )
    );

    // Agent A gets approve ack
    const approveResult = await waitForNextMessage(agentAWs);
    expect(approveResult.type).toBe('PAIRING_APPROVE_RESULT');

    // Client A receives PAIRING_COMPLETE
    let clientAPairingComplete: ProtocolMessage | undefined;
    while (!clientAPairingComplete) {
      const msg = await waitForNextMessage(clientAWs);
      if (msg.type === 'PAIRING_COMPLETE') {
        clientAPairingComplete = msg;
      }
    }
    expect(clientAPairingComplete).toBeDefined();
    const deviceTokenA = (clientAPairingComplete!.payload as any).deviceToken;
    expect(deviceTokenA).toBeDefined();

    // Wait for any potential broadcasts to deliver
    await new Promise((r) => setTimeout(r, 150));

    // Client B must NEVER receive PAIRING_COMPLETE or deviceTokenA
    const clientBCompleteMsgs = clientBMessages.filter((m) => m.type === 'PAIRING_COMPLETE');
    expect(clientBCompleteMsgs.length).toBe(0);

    const clientBLeakedTokenMsgs = clientBMessages.filter(
      (m) => JSON.stringify(m).includes(deviceTokenA)
    );
    expect(clientBLeakedTokenMsgs.length).toBe(0);

    agentAWs.close();
    clientAWs.close();
    clientBWs.close();
  });

  it('Cross-Device Stream & Event Isolation: Client A (Dev A) vs Client B (Dev B)', async () => {
    // 1. Connect Agent A and pair with Client A
    const agentAWs = await openWs(relayWsUrl);
    agentAWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: 'dev_stream_A',
          deviceName: 'Stream-Device-A',
          agentVersion: '0.3.0',
          os: 'linux',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const agentAAck = await waitForNextMessage(agentAWs);
    const codeA = (agentAAck.payload as any).pairingCode;

    const clientAWs = await openWs(relayWsUrl);
    clientAWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_stream_A',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForNextMessage(clientAWs);

    clientAWs.send(JSON.stringify(createMessage('PAIRING_REQUEST', { code: codeA, clientName: 'ClientA' })));
    const offerA = await waitForNextMessage(agentAWs);
    agentAWs.send(JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId: (offerA.payload as any).pairingId })));
    await waitForNextMessage(agentAWs); // approve result

    let completeA: ProtocolMessage | undefined;
    while (!completeA) {
      const msg = await waitForNextMessage(clientAWs);
      if (msg.type === 'PAIRING_COMPLETE') completeA = msg;
    }
    const tokenA = (completeA!.payload as any).deviceToken;

    // 2. Connect Agent B and pair with Client B
    const agentBWs = await openWs(relayWsUrl);
    agentBWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: 'dev_stream_B',
          deviceName: 'Stream-Device-B',
          agentVersion: '0.3.0',
          os: 'linux',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const agentBAck = await waitForNextMessage(agentBWs);
    const codeB = (agentBAck.payload as any).pairingCode;

    const clientBWs = await openWs(relayWsUrl);
    clientBWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_stream_B',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForNextMessage(clientBWs);

    clientBWs.send(JSON.stringify(createMessage('PAIRING_REQUEST', { code: codeB, clientName: 'ClientB' })));
    const offerB = await waitForNextMessage(agentBWs);
    agentBWs.send(JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId: (offerB.payload as any).pairingId })));
    await waitForNextMessage(agentBWs);

    let completeB: ProtocolMessage | undefined;
    while (!completeB) {
      const msg = await waitForNextMessage(clientBWs);
      if (msg.type === 'PAIRING_COMPLETE') completeB = msg;
    }
    const tokenB = (completeB!.payload as any).deviceToken;

    // Setup message capture
    const clientAMsgs: ProtocolMessage[] = [];
    clientAWs.on('message', (d) => clientAMsgs.push(parseProtocolMessage(d.toString())));

    const clientBMsgs: ProtocolMessage[] = [];
    clientBWs.on('message', (d) => clientBMsgs.push(parseProtocolMessage(d.toString())));

    // 3. Agent A emits events
    agentAWs.send(
      JSON.stringify(
        createMessage('MESSAGE_STARTED', {
          deviceId: 'dev_stream_A',
          sessionId: 'ses_A_1',
          messageId: 'msg_A_1',
          timestamp: Date.now(),
        })
      )
    );
    agentAWs.send(
      JSON.stringify(
        createMessage('MESSAGE_DELTA', {
          deviceId: 'dev_stream_A',
          sessionId: 'ses_A_1',
          messageId: 'msg_A_1',
          delta: 'Agent A private delta',
          sequence: 0,
        })
      )
    );
    agentAWs.send(
      JSON.stringify(
        createMessage('MESSAGE_COMPLETED', {
          deviceId: 'dev_stream_A',
          sessionId: 'ses_A_1',
          messageId: 'msg_A_1',
          timestamp: Date.now(),
        })
      )
    );
    agentAWs.send(
      JSON.stringify(
        createMessage('OPENCODE_EVENT', {
          deviceId: 'dev_stream_A',
          eventType: 'session.updated',
          payload: { sessionID: 'ses_A_1' },
          sequence: 1,
        })
      )
    );
    agentAWs.send(
      JSON.stringify(
        createMessage('PTY_OUTPUT', {
          deviceId: 'dev_stream_A',
          ptyId: 'pty_A_1',
          data: 'root@deviceA:~$ ls\n',
        })
      )
    );

    // 4. Agent B emits events
    agentBWs.send(
      JSON.stringify(
        createMessage('MESSAGE_DELTA', {
          deviceId: 'dev_stream_B',
          sessionId: 'ses_B_1',
          messageId: 'msg_B_1',
          delta: 'Agent B private delta',
          sequence: 0,
        })
      )
    );
    agentBWs.send(
      JSON.stringify(
        createMessage('PTY_OUTPUT', {
          deviceId: 'dev_stream_B',
          ptyId: 'pty_B_1',
          data: 'root@deviceB:~$ pwd\n',
        })
      )
    );

    // Wait for propagation
    await new Promise((r) => setTimeout(r, 200));

    // Verify Client A received all Device A events
    const clientADeltas = clientAMsgs.filter((m) => m.type === 'MESSAGE_DELTA');
    expect(clientADeltas.some((m) => (m.payload as any).delta === 'Agent A private delta')).toBe(true);

    const clientAPty = clientAMsgs.filter((m) => m.type === 'PTY_OUTPUT');
    expect(clientAPty.some((m) => (m.payload as any).ptyId === 'pty_A_1')).toBe(true);

    // Verify Client A received ZERO stream / session / PTY events from Device B
    const streamEventTypes = [
      'MESSAGE_STARTED',
      'MESSAGE_DELTA',
      'MESSAGE_COMPLETED',
      'MESSAGE_ERROR',
      'OPENCODE_EVENT',
      'PTY_OUTPUT',
      'PTY_CLOSED',
      'PERMISSION_REQUEST',
    ];

    const clientAStreamFromB = clientAMsgs.filter(
      (m) => streamEventTypes.includes(m.type) && (m.payload as any)?.deviceId === 'dev_stream_B'
    );
    expect(clientAStreamFromB.length).toBe(0);

    // Verify Client B received all Device B events
    const clientBDeltas = clientBMsgs.filter((m) => m.type === 'MESSAGE_DELTA');
    expect(clientBDeltas.some((m) => (m.payload as any).delta === 'Agent B private delta')).toBe(true);

    const clientBPty = clientBMsgs.filter((m) => m.type === 'PTY_OUTPUT');
    expect(clientBPty.some((m) => (m.payload as any).ptyId === 'pty_B_1')).toBe(true);

    // Verify Client B received ZERO stream / session / PTY events from Device A
    const clientBStreamFromA = clientBMsgs.filter(
      (m) => streamEventTypes.includes(m.type) && (m.payload as any)?.deviceId === 'dev_stream_A'
    );
    expect(clientBStreamFromA.length).toBe(0);

    agentAWs.close();
    agentBWs.close();
    clientAWs.close();
    clientBWs.close();
  });

  it('PTY Cross-Device Rejection & Ownership Enforcement', async () => {
    // 1. Connect Agent A
    const agentAWs = await openWs(relayWsUrl);
    agentAWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: 'dev_pty_A',
          deviceName: 'Pty-Device-A',
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const ackA = await waitForNextMessage(agentAWs);
    const codeA = (ackA.payload as any).pairingCode;

    // Connect Client A and pair
    const clientAWs = await openWs(relayWsUrl);
    clientAWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_pty_A',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForNextMessage(clientAWs);
    clientAWs.send(JSON.stringify(createMessage('PAIRING_REQUEST', { code: codeA, clientName: 'ClientA' })));
    const offerA = await waitForNextMessage(agentAWs);
    agentAWs.send(JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId: (offerA.payload as any).pairingId })));
    await waitForNextMessage(agentAWs);
    let completeA: ProtocolMessage | undefined;
    while (!completeA) {
      const msg = await waitForNextMessage(clientAWs);
      if (msg.type === 'PAIRING_COMPLETE') completeA = msg;
    }
    const tokenA = (completeA!.payload as any).deviceToken;

    // 2. Connect Agent B
    const agentBWs = await openWs(relayWsUrl);
    agentBWs.send(
      JSON.stringify(
        createMessage('AGENT_HELLO', {
          deviceId: 'dev_pty_B',
          deviceName: 'Pty-Device-B',
          agentVersion: '0.3.0',
          os: 'win32',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    const ackB = await waitForNextMessage(agentBWs);
    const codeB = (ackB.payload as any).pairingCode;

    // Connect Client B and pair
    const clientBWs = await openWs(relayWsUrl);
    clientBWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_pty_B',
          clientVersion: '0.3.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForNextMessage(clientBWs);
    clientBWs.send(JSON.stringify(createMessage('PAIRING_REQUEST', { code: codeB, clientName: 'ClientB' })));
    const offerB = await waitForNextMessage(agentBWs);
    agentBWs.send(JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId: (offerB.payload as any).pairingId })));
    await waitForNextMessage(agentBWs);
    let completeB: ProtocolMessage | undefined;
    while (!completeB) {
      const msg = await waitForNextMessage(clientBWs);
      if (msg.type === 'PAIRING_COMPLETE') completeB = msg;
    }
    const tokenB = (completeB!.payload as any).deviceToken;

    // 3. Register PTYs via PTY_CREATE_RESULT
    // Device A registers pty_A_100
    agentAWs.send(
      JSON.stringify(
        createMessage('PTY_CREATE_RESULT', {
          deviceId: 'dev_pty_A',
          pty: { id: 'pty_A_100', title: 'Bash A', command: 'bash', status: 'running', createdAt: Date.now() },
        })
      )
    );

    // Device B registers pty_B_200
    agentBWs.send(
      JSON.stringify(
        createMessage('PTY_CREATE_RESULT', {
          deviceId: 'dev_pty_B',
          pty: { id: 'pty_B_200', title: 'PowerShell B', command: 'powershell', status: 'running', createdAt: Date.now() },
        })
      )
    );

    await new Promise((r) => setTimeout(r, 100));

    // Verify registry tracked both PTYs
    expect(registry.getPty('pty_A_100')).toBeDefined();
    expect(registry.getPty('pty_A_100')?.deviceId).toBe('dev_pty_A');
    expect(registry.getPty('pty_B_200')).toBeDefined();
    expect(registry.getPty('pty_B_200')?.deviceId).toBe('dev_pty_B');

    // 4. Test Case A: Client B attempts PTY_INPUT on Device A using invalid token (or tokenB)
    clientBWs.send(
      JSON.stringify(
        createMessage('PTY_INPUT', {
          deviceId: 'dev_pty_A',
          deviceToken: 'bad_token',
          ptyId: 'pty_A_100',
          data: 'malicious input',
        })
      )
    );
    const errAuth = await waitForNextMessage(clientBWs);
    expect(errAuth.type).toBe('ERROR');
    expect((errAuth.payload as any).code).toBe('DEVICE_NOT_AUTHORIZED');

    // 5. Test Case B: Client B claims deviceId: dev_pty_B with valid tokenB, but targets ptyId: pty_A_100 (cross-device attack)
    clientBWs.send(
      JSON.stringify(
        createMessage('PTY_INPUT', {
          deviceId: 'dev_pty_B',
          deviceToken: tokenB,
          ptyId: 'pty_A_100',
          data: 'cross device injection',
        })
      )
    );
    const errDenied = await waitForNextMessage(clientBWs);
    expect(errDenied.type).toBe('ERROR');
    expect((errDenied.payload as any).code).toBe('PTY_ACCESS_DENIED');

    // 6. Test Case C: Client A attempts PTY_INPUT on a nonexistent PTY
    clientAWs.send(
      JSON.stringify(
        createMessage('PTY_INPUT', {
          deviceId: 'dev_pty_A',
          deviceToken: tokenA,
          ptyId: 'pty_nonexistent_999',
          data: 'test',
        })
      )
    );
    const errNotFound = await waitForNextMessage(clientAWs);
    expect(errNotFound.type).toBe('ERROR');
    expect((errNotFound.payload as any).code).toBe('PTY_NOT_FOUND');

    // 7. Test Case D: Client A sends legitimate PTY_INPUT on pty_A_100
    // Agent A should receive this forward!
    const agentAPromise = waitForNextMessage(agentAWs);
    clientAWs.send(
      JSON.stringify(
        createMessage('PTY_INPUT', {
          deviceId: 'dev_pty_A',
          deviceToken: tokenA,
          ptyId: 'pty_A_100',
          data: 'echo hello\n',
        })
      )
    );
    const forwardedInput = await agentAPromise;
    expect(forwardedInput.type).toBe('PTY_INPUT');
    expect((forwardedInput.payload as any).data).toBe('echo hello\n');

    // 8. Test Case E: PTY unregistration on PTY_CLOSED
    agentAWs.send(
      JSON.stringify(
        createMessage('PTY_CLOSED', {
          deviceId: 'dev_pty_A',
          ptyId: 'pty_A_100',
        })
      )
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(registry.getPty('pty_A_100')).toBeUndefined();

    // After unregistration, PTY_INPUT should return PTY_NOT_FOUND
    clientAWs.send(
      JSON.stringify(
        createMessage('PTY_INPUT', {
          deviceId: 'dev_pty_A',
          deviceToken: tokenA,
          ptyId: 'pty_A_100',
          data: 'ls\n',
        })
      )
    );
    const closedNotFound = await waitForNextMessage(clientAWs);
    expect(closedNotFound.type).toBe('ERROR');
    expect((closedNotFound.payload as any).code).toBe('PTY_NOT_FOUND');

    agentAWs.close();
    agentBWs.close();
    clientAWs.close();
    clientBWs.close();
  });
});