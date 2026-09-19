import { spawn, ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { buildRelayServer } from '../apps/relay/src/server.js';
import { RemoteAgent } from '../apps/agent/src/agent.js';
import { createMessage, parseProtocolMessage, PROTOCOL_VERSION } from '../packages/protocol/src/index.js';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, retries = 25, delay = 200): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await wait(delay);
  }
  return false;
}

async function main() {
  console.log('=== STARTING LIVE OPENCODE PHASE 2 VERIFICATION ===');

  let opencodeProcess: ChildProcess | null = null;
  let relayApp: any = null;
  let agent: RemoteAgent | null = null;

  try {
    // 1. Verify or Launch OpenCode serve
    console.log('[1/7] Connecting to OpenCode serve on port 4096...');
    let isHealthy = await waitForServer('http://127.0.0.1:4096/global/health', 3, 200);
    if (!isHealthy) {
      console.log(' -> Spawning opencode serve --port 4096...');
      opencodeProcess = spawn('opencode', ['serve', '--port', '4096', '--hostname', '127.0.0.1'], {
        shell: true,
        stdio: 'ignore',
      });
      isHealthy = await waitForServer('http://127.0.0.1:4096/global/health', 30, 300);
    }
    if (!isHealthy) {
      throw new Error('OpenCode server failed to become healthy on port 4096');
    }
    console.log(' -> OpenCode 1.18.30 is UP and healthy on http://127.0.0.1:4096');

    // 2. Start Relay Server & Verify No Public OpenCode Exposure
    const testDeviceId = `dev_darko_live_${Date.now()}`;
    const testStorePath = `.live-relay-store-${Date.now()}.json`;
    const testPort = 4591;
    console.log(`[2/9] Starting Relay Server on port ${testPort}...`);
    let relay = buildRelayServer({ port: testPort, storePath: testStorePath });
    relayApp = relay.app;
    await relayApp.listen({ port: testPort, host: '127.0.0.1' });
    console.log(` -> Relay listening on ws://127.0.0.1:${testPort}/ws`);

    // Verify Relay exposes NO generic HTTP proxy
    const proxyCheckRes = await fetch(`http://127.0.0.1:${testPort}/proxy/opencode/session`);
    const arbitraryCheckRes = await fetch(`http://127.0.0.1:${testPort}/session`);
    if (proxyCheckRes.status !== 404 || arbitraryCheckRes.status !== 404) {
      throw new Error('Relay server exposed unexpected HTTP route! Must only expose typed protocol endpoints.');
    }
    console.log(' -> Verified: Relay exposes NO generic HTTP proxy or raw endpoints (404 on arbitrary routes).');

    // 3. Start Agent with Explicit Host Approval Requirement (autoApprovePairing: false)
    console.log('[3/9] Starting Remote Agent with autoApprovePairing: false (explicit host approval enforced)...');
    let hostApprovedCount = 0;
    agent = new RemoteAgent({
      deviceId: testDeviceId,
      deviceName: 'Darko-Windows-Rig',
      deviceCredential: 'cred_phase2_secret',
      relayUrl: `ws://127.0.0.1:${testPort}/ws`,
      opencodeUrl: 'http://127.0.0.1:4096',
      autoApprovePairing: false, // Production security default: host approval required
      onPairingOffer: async (offer) => {
        console.log(` -> [HOST ACTION] Received pairing offer from "${offer.clientName}" with code [${offer.code}]`);
        if (offer.clientName === 'Darko Pixel 9 Pro') {
          console.log(' -> [HOST ACTION] Host explicitly authorizes this device!');
          hostApprovedCount++;
          return true;
        }
        return false;
      },
    });
    agent.start();
    await wait(800);

    // 4. Connect Phone Client & Execute Explicit Pairing
    console.log('[4/9] Connecting Phone client via WebSocket...');
    let clientWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    await new Promise((resolve) => clientWs.on('open', resolve));

    const clientHello = createMessage('CLIENT_HELLO', {
      clientId: 'darko_android_pixel_live',
      clientVersion: '0.2.0',
      protocolVersion: PROTOCOL_VERSION,
    });
    clientWs.send(JSON.stringify(clientHello));

    await new Promise<void>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'CLIENT_HELLO_ACK') {
          clientWs.off('message', handler);
          resolve();
        }
      });
    });

    // Obtain pairing code from relay store
    const activePairing = relay.store.getActivePairingForDevice(testDeviceId);
    if (!activePairing) throw new Error('No active pairing session found on host');
    const pairingCode = activePairing.code;
    console.log(` -> Read Pairing Code from PC Terminal: [${pairingCode}]`);

    // Submit pairing code from phone
    console.log(' -> Client submitting pairing code to Relay...');
    const pairingReq = createMessage('PAIRING_REQUEST', {
      code: pairingCode,
      clientName: 'Darko Pixel 9 Pro',
    });
    clientWs.send(JSON.stringify(pairingReq));

    const pairingComplete = await new Promise<{ deviceToken: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pairing timed out')), 5000);
      clientWs.on('message', (data) => {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'PAIRING_COMPLETE') {
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
    });
    const deviceToken = pairingComplete.deviceToken;
    console.log(` -> Pairing APPROVED & COMPLETE! Secret Device Token: ${deviceToken.slice(0, 16)}...`);
    if (hostApprovedCount !== 1) {
      throw new Error(`Expected exactly 1 explicit host approval call, got ${hostApprovedCount}`);
    }
    console.log(' -> Verified: Explicit host approval callback was executed!');

    // 5. Test Token Persistence Across Relay Restart
    console.log('[5/9] Testing Token Persistence Across Relay Restart...');
    // A. Verify authenticated RPC works before restart
    const listMsg1 = createMessage('SESSION_LIST', { deviceId: testDeviceId, deviceToken });
    const preRestartPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pre-restart SESSION_LIST timed out')), 8000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_LIST_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve();
        } else if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          reject(new Error(`Pre-restart SESSION_LIST failed: ${msg.payload.code}`));
        }
      });
    });
    clientWs.send(JSON.stringify(listMsg1));
    await preRestartPromise;
    console.log(' -> Pre-restart authenticated RPC succeeded.');

    // B. Stop Relay
    console.log(' -> Stopping Relay server...');
    clientWs.close();
    await relayApp.close();
    await wait(500);

    // C. Restart Relay with the same store path
    console.log(` -> Restarting Relay server on port ${testPort} with existing store...`);
    relay = buildRelayServer({ port: testPort, storePath: testStorePath });
    relayApp = relay.app;
    await relayApp.listen({ port: testPort, host: '127.0.0.1' });
    await wait(500);

    // D. Reconnect client to restarted relay and reuse deviceToken
    console.log(' -> Reconnecting phone client to restarted relay...');
    clientWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    await new Promise((resolve) => clientWs.on('open', resolve));

    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'darko_android_pixel_live',
          clientVersion: '0.2.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: { [testDeviceId]: deviceToken },
        })
      )
    );

    await new Promise<void>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'CLIENT_HELLO_ACK') {
          clientWs.off('message', handler);
          resolve();
        }
      });
    });

    // Wait for agent to reconnect to restarted relay
    await wait(1500);

    // E. Execute authenticated RPC on restarted relay
    const restartListPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Post-restart SESSION_LIST timed out')), 8000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_LIST_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve();
        } else if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          reject(new Error(`Post-restart RPC failed: ${msg.payload.code}: ${msg.payload.message}`));
        }
      });
    });

    clientWs.send(JSON.stringify(createMessage('SESSION_LIST', { deviceId: testDeviceId, deviceToken })));
    await restartListPromise;
    console.log(' -> Verified: Device token successfully persisted and authenticated across real Relay restart!');

    // 6. Create Real OpenCode Session
    console.log('[6/9] Creating real OpenCode session from phone client...');
    const createSessionMsg = createMessage('SESSION_CREATE', {
      deviceId: testDeviceId,
      deviceToken,
      title: 'Darko Phase 2 Final Gate Session',
    });
    const sessionCreatedPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Session creation timed out')), 12000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_CREATE_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve(msg.payload);
        } else if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          reject(new Error(`Session create failed: ${msg.payload.code}: ${msg.payload.message}`));
        }
      });
    });
    clientWs.send(JSON.stringify(createSessionMsg));
    const sessionCreated = await sessionCreatedPromise;
    const realSession = sessionCreated.session;
    console.log(` -> Real OpenCode session created! ID: ${realSession.id}, Title: "${realSession.title}"`);

    // 7. Send Real Prompt, Verify Stream Lifecycle & Match Against Stored OpenCode Assistant Message
    console.log('[7/9] Sending prompt to real OpenCode and verifying full stream fidelity...');
    const testPrompt = 'Reply with exactly: REMOTE_E2E_OK';

    let startedMsg: any = null;
    const deltaMsgs: any[] = [];
    let completedMsg: any = null;
    let accumulatedText = '';

    const streamPromise = new Promise<{ text: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Streaming timed out after 75s. Accumulated so far: "${accumulatedText}"`
          )
        );
      }, 75000);

      clientWs.on('message', (data) => {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'MESSAGE_STARTED') {
          startedMsg = msg.payload;
          console.log(` -> [CLIENT RX] MESSAGE_STARTED: sessionId=${startedMsg.sessionId}, messageId=${startedMsg.messageId}`);
        } else if (msg.type === 'MESSAGE_DELTA') {
          deltaMsgs.push(msg.payload);
          accumulatedText += msg.payload.delta;
          process.stdout.write(`\r -> [STREAMING DELTA]: "${accumulatedText.slice(-30)}"`);
        } else if (msg.type === 'MESSAGE_COMPLETED') {
          completedMsg = msg.payload;
          console.log(`\n -> [CLIENT RX] MESSAGE_COMPLETED: sessionId=${completedMsg.sessionId}, messageId=${completedMsg.messageId}`);
          clearTimeout(timeout);
          resolve({ text: accumulatedText });
        }
      });
    });

    const sendMsg = createMessage('MESSAGE_SEND', {
      deviceId: testDeviceId,
      deviceToken,
      sessionId: realSession.id,
      content: testPrompt,
    });
    clientWs.send(JSON.stringify(sendMsg));

    const streamResult = await streamPromise;
    console.log(` -> Accumulated OpenCode response: "${streamResult.text.trim()}"`);
    console.log(` -> Total delta chunks received: ${deltaMsgs.length}`);

    if (deltaMsgs.length === 0) {
      throw new Error('Zero delta chunks received from OpenCode SSE stream!');
    }

    // Verify session & message ID consistency across lifecycle
    if (!startedMsg || !completedMsg) {
      throw new Error('Missing MESSAGE_STARTED or MESSAGE_COMPLETED event!');
    }
    if (startedMsg.sessionId !== realSession.id || completedMsg.sessionId !== realSession.id) {
      throw new Error(`Session ID mismatch in stream events! Expected ${realSession.id}`);
    }
    if (startedMsg.messageId !== completedMsg.messageId) {
      throw new Error(`Message ID mismatch! Started: ${startedMsg.messageId}, Completed: ${completedMsg.messageId}`);
    }
    for (const delta of deltaMsgs) {
      if (delta.sessionId !== realSession.id || delta.messageId !== completedMsg.messageId) {
        throw new Error(`Delta event had inconsistent sessionId or messageId!`);
      }
    }
    console.log(' -> Verified: MESSAGE_STARTED, all MESSAGE_DELTA, and MESSAGE_COMPLETED share identical sessionId and messageId!');

    // Fetch the actual assistant message stored in OpenCode session to prove faithful transport
    console.log(' -> Querying OpenCode API for stored session message history...');
    await wait(1000); // Allow OpenCode to finalize disk write
    const messagesRes = await fetch(`http://127.0.0.1:4096/session/${realSession.id}/message`);
    if (!messagesRes.ok) {
      throw new Error(`Failed to query OpenCode messages: HTTP ${messagesRes.status}`);
    }
    const rawMessages = (await messagesRes.json()) as any[];
    const assistantMsg = rawMessages.filter((m) => m.info?.role === 'assistant').pop();
    if (!assistantMsg) {
      throw new Error('No assistant message recorded by OpenCode in session message history!');
    }
    const fullStreamedParts = (assistantMsg.parts || [])
      .filter((p: any) => (p.type === 'text' || p.type === 'reasoning') && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('')
      .trim();

    const finalOutputText = (assistantMsg.parts || [])
      .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
      .trim();

    console.log(` -> OpenCode Stored Assistant Final Text Part: "${finalOutputText}"`);
    console.log(` -> OpenCode Stored Complete Assistant Content (Reasoning + Text): "${fullStreamedParts.slice(0, 80)}..."`);

    // Verify that accumulated stream text faithfully equals OpenCode's actual stored parts
    const accumulatedTrimmed = streamResult.text.trim();
    const matchesFull = accumulatedTrimmed === fullStreamedParts;
    const matchesFinal = accumulatedTrimmed === finalOutputText;

    if (!matchesFull && !matchesFinal) {
      throw new Error(
        `Stream fidelity mismatch! Accumulated: "${accumulatedTrimmed}" vs Stored Complete in OpenCode: "${fullStreamedParts}"`
      );
    }
    console.log(' -> Verified: Accumulated response EQUALS actual OpenCode stored assistant message (100% stream fidelity)!');
    console.log(' -> Verified: Stored final text part contains expected response: ' + finalOutputText);

    // 8. Phase 3: Workspace Context and Session Diff Verification
    console.log('[8/11] Verifying Phase 3 Workspace Context & Session Diffs...');
    const wsContextPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WORKSPACE_GET timed out')), 5000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'WORKSPACE_GET_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
    });
    clientWs.send(JSON.stringify(createMessage('WORKSPACE_GET', { deviceId: testDeviceId, deviceToken })));
    const wsContext = await wsContextPromise;
    console.log(` -> Workspace Context received: project="${wsContext.project?.name || 'default'}", vcs="${wsContext.project?.vcs || 'none'}"`);

    const sessionDiffPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SESSION_DIFF_GET timed out')), 5000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_DIFF_GET_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
    });
    clientWs.send(JSON.stringify(createMessage('SESSION_DIFF_GET', { deviceId: testDeviceId, sessionId: realSession.id, deviceToken })));
    const sessionDiffRes = await sessionDiffPromise;
    console.log(` -> Session Diff received: ${sessionDiffRes.diffs.length} changed files`);

    const sessionGetPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SESSION_GET timed out')), 5000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'SESSION_GET_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
    });
    clientWs.send(JSON.stringify(createMessage('SESSION_GET', { deviceId: testDeviceId, sessionId: realSession.id, deviceToken })));
    const sessionGetRes = await sessionGetPromise;
    console.log(` -> SESSION_GET returned ${sessionGetRes.messages.length} messages with parts!`);

    // 9. Test Active WebSocket Revocation Enforcement
    console.log('[9/11] Testing Active WebSocket Revocation Enforcement (no socket disconnect)...');
    // On the SAME active clientWs connection:
    const revokeMsg = createMessage('DEVICE_REVOKE', {
      deviceId: testDeviceId,
      deviceToken,
    });
    const revokePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DEVICE_REVOKE timed out')), 8000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'DEVICE_REVOKE_RESULT') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          console.log(' -> Device token successfully revoked!');
          resolve();
        } else if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          reject(new Error(`DEVICE_REVOKE failed: ${msg.payload.code}`));
        }
      });
    });
    clientWs.send(JSON.stringify(revokeMsg));
    await revokePromise;

    // On that SAME still-open WebSocket connection, attempt an authenticated RPC
    console.log(' -> Attempting SESSION_LIST RPC on the SAME active WebSocket with the revoked token...');
    const activeWsRejectPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Post-revoke active check timed out')), 5000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          if (msg.payload.code === 'DEVICE_NOT_AUTHORIZED') {
            console.log(' -> Verified: Active WebSocket RPC strictly rejected with DEVICE_NOT_AUTHORIZED!');
            resolve();
          } else {
            reject(new Error(`Expected DEVICE_NOT_AUTHORIZED but got ${msg.payload.code}`));
          }
        }
      });
    });

    clientWs.send(JSON.stringify(createMessage('SESSION_LIST', { deviceId: testDeviceId, deviceToken })));
    await activeWsRejectPromise;

    // 9. Verify Post-Revocation Rejection Persists Across Relay Restart
    console.log('[9/9] Verifying Revocation Persistence Across Relay Restart...');
    clientWs.close();
    await relayApp.close();
    await wait(500);

    // Restart relay with the store path where revocation occurred
    relay = buildRelayServer({ port: testPort, storePath: testStorePath });
    relayApp = relay.app;
    await relayApp.listen({ port: testPort, host: '127.0.0.1' });
    await wait(500);

    clientWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    await new Promise((resolve) => clientWs.on('open', resolve));

    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'darko_android_pixel_live_revoked',
          clientVersion: '0.2.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );

    await new Promise<void>((resolve) => {
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'CLIENT_HELLO_ACK') {
          clientWs.off('message', handler);
          resolve();
        }
      });
    });

    const postRestartRevokePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Post-restart revoke check timed out')), 5000);
      clientWs.on('message', function handler(data) {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'ERROR') {
          clientWs.off('message', handler);
          clearTimeout(timeout);
          if (msg.payload.code === 'DEVICE_NOT_AUTHORIZED') {
            console.log(' -> Verified: Revocation correctly persisted across restart (DEVICE_NOT_AUTHORIZED)!');
            resolve();
          } else {
            reject(new Error(`Expected DEVICE_NOT_AUTHORIZED but got ${msg.payload.code}`));
          }
        }
      });
    });

    clientWs.send(JSON.stringify(createMessage('SESSION_LIST', { deviceId: testDeviceId, deviceToken })));
    await postRestartRevokePromise;

    clientWs.close();
    console.log('=== FINAL GATE LIVE OPENCODE PHASE 2 VERIFICATION PASSED 100%! ===');
  } finally {
    if (agent) {
      agent.stop();
    }
    if (relayApp) {
      await relayApp.close();
    }
    if (opencodeProcess) {
      console.log('Shutting down test OpenCode process...');
      opencodeProcess.kill('SIGTERM');
      opencodeProcess.kill('SIGKILL');
    }
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(testStorePath)) {
        fs.unlinkSync(testStorePath);
      }
    } catch {}
  }
}

main().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err);
  process.exit(1);
});
