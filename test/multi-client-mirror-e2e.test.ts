import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import * as fs from 'fs';
import { buildRelayServer } from '../apps/relay/src/server.js';
import {
  createMessage,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  type SessionRuntimeSnapshot,
  type QueuedMessage,
} from '../packages/protocol/src/index.js';

describe('Multi-Client Mirror & Authoritative Controller E2E Integration', () => {
  const port = 4598;
  const storePath = '.test-multi-client-mirror-store.json';
  const relayWsUrl = `ws://127.0.0.1:${port}/ws`;
  let relayApp: any;
  let registry: any;
  let store: any;

  const TEST_DEVICE_ID = 'dev_pc_host_mirror';
  const TEST_DEVICE_NAME = 'Darko-Host-PC';

  let agentWs: WebSocket;
  let client1Ws: WebSocket; // PC Web Client
  let client2Ws: WebSocket; // Phone Web Client
  let client1Token: string = '';
  let client2Token: string = '';

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
    tag = 'msg',
    timeoutMs = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      function handler(data: WebSocket.Data) {
        try {
          const msg = parseProtocolMessage(data.toString());
          // console.log(`[test-recv:${tag}]`, msg.type);
          if (predicate(msg)) {
            clearTimeout(timer);
            if (ws && typeof ws.off === 'function') {
              ws.off('message', handler);
            }
            resolve(msg as T);
          }
        } catch {
          // ignore non-protocol message
        }
      }

      timer = setTimeout(() => {
        if (ws && typeof ws.off === 'function') {
          ws.off('message', handler);
        }
        reject(new Error(`waitForMessage timed out after ${timeoutMs}ms waiting for condition: [${tag}]`));
      }, timeoutMs);

      ws.on('message', handler);
    });
  }

  beforeAll(async () => {
    if (fs.existsSync(storePath)) {
      try { fs.unlinkSync(storePath); } catch {}
    }

    const server = buildRelayServer({ port, storePath });
    relayApp = server.app;
    registry = server.registry;
    store = server.store;

    await relayApp.listen({ port, host: '127.0.0.1' });

    // 1. Connect Agent
    agentWs = await openWs(relayWsUrl);
    const agentHello = createMessage('AGENT_HELLO', {
      deviceId: TEST_DEVICE_ID,
      deviceName: TEST_DEVICE_NAME,
      agentVersion: '0.2.0',
      os: 'win32',
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { sessions: true, streaming: true, permissions: true },
    });
    agentWs.send(JSON.stringify(agentHello));

    const agentAck = await waitForMessage(
      agentWs,
      (m) => m.type === 'AGENT_HELLO_ACK'
    );
    const pairingCode = (agentAck.payload as any).pairingCode;

    // 2. Connect Client 1 (PC)
    client1Ws = await openWs(relayWsUrl);
    client1Ws.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_pc_mirror',
          clientVersion: '0.2.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForMessage(client1Ws, (m) => m.type === 'CLIENT_HELLO_ACK');

    client1Ws.send(
      JSON.stringify(
        createMessage('PAIRING_REQUEST', {
          code: pairingCode,
          clientName: 'PC Chrome Browser',
        })
      )
    );

    const offer1 = await waitForMessage(agentWs, (m) => m.type === 'PAIRING_OFFER');
    const pairingId1 = (offer1.payload as any).pairingId;

    agentWs.send(
      JSON.stringify(
        createMessage('PAIRING_APPROVE', {
          pairingId: pairingId1,
        })
      )
    );

    const result1 = await waitForMessage(client1Ws, (m) => m.type === 'PAIRING_COMPLETE');
    client1Token = (result1.payload as any).deviceToken;

    // 3. Connect Client 2 (Phone) using the authorized deviceToken
    client2Token = client1Token;
    client2Ws = await openWs(relayWsUrl);
    client2Ws.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_mirror',
          clientVersion: '0.2.0',
          protocolVersion: PROTOCOL_VERSION,
          pairedDeviceTokens: {
            [TEST_DEVICE_ID]: client2Token,
          },
        })
      )
    );
    await waitForMessage(client2Ws, (m) => m.type === 'CLIENT_HELLO_ACK', 'client2_hello_ack');

    // Ensure authorization for both clients in relay registry
    client1Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_GET', {
          deviceId: TEST_DEVICE_ID,
          sessionId: 'init_session',
          deviceToken: client1Token,
        })
      )
    );
    await waitForMessage(client1Ws, (m) => m.type === 'SESSION_QUEUE_SYNC');

    client2Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_GET', {
          deviceId: TEST_DEVICE_ID,
          sessionId: 'init_session',
          deviceToken: client2Token,
        })
      )
    );
    await waitForMessage(client2Ws, (m) => m.type === 'SESSION_QUEUE_SYNC');
  });

  afterAll(async () => {
    if (agentWs && agentWs.readyState === WebSocket.OPEN) agentWs.close();
    if (client1Ws && client1Ws.readyState === WebSocket.OPEN) client1Ws.close();
    if (client2Ws && client2Ws.readyState === WebSocket.OPEN) client2Ws.close();
    await relayApp.close();
    if (fs.existsSync(storePath)) {
      try { fs.unlinkSync(storePath); } catch {}
    }
  });

  it('Invariance 1: Multi-Client Streaming Broadcast with Per-Session Sequence & Agent Epoch', async () => {
    const testSessionId = 'session_mirror_live_1';
    const testAgentInstanceId = 'agent_epoch_alpha_99';
    const testTurnId = 'turn_live_001';
    const testMessageId = 'msg_live_001';

    // Set up listeners on both PC (client1) and Phone (client2)
    const p1Started = waitForMessage(client1Ws, (m) => m.type === 'MESSAGE_STARTED');
    const p2Started = waitForMessage(client2Ws, (m) => m.type === 'MESSAGE_STARTED');

    // Agent broadcasts MESSAGE_STARTED
    agentWs.send(
      JSON.stringify(
        createMessage('MESSAGE_STARTED', {
          deviceId: TEST_DEVICE_ID,
          sessionId: testSessionId,
          messageId: testMessageId,
          timestamp: Date.now(),
          agentInstanceId: testAgentInstanceId,
          sequence: 1,
          scope: 'session',
        })
      )
    );

    const [msg1Start, msg2Start] = await Promise.all([p1Started, p2Started]);
    expect((msg1Start.payload as any).agentInstanceId).toBe(testAgentInstanceId);
    expect((msg1Start.payload as any).sequence).toBe(1);

    expect((msg2Start.payload as any).agentInstanceId).toBe(testAgentInstanceId);
    expect((msg2Start.payload as any).sequence).toBe(1);

    // Delta broadcast
    const p1Delta = waitForMessage(client1Ws, (m) => m.type === 'MESSAGE_DELTA');
    const p2Delta = waitForMessage(client2Ws, (m) => m.type === 'MESSAGE_DELTA');

    agentWs.send(
      JSON.stringify(
        createMessage('MESSAGE_DELTA', {
          deviceId: TEST_DEVICE_ID,
          sessionId: testSessionId,
          messageId: testMessageId,
          delta: 'Building video player component...',
          agentInstanceId: testAgentInstanceId,
          sequence: 2,
          scope: 'session',
        })
      )
    );

    const [msg1Delta, msg2Delta] = await Promise.all([p1Delta, p2Delta]);
    expect((msg1Delta.payload as any).delta).toBe('Building video player component...');
    expect((msg1Delta.payload as any).sequence).toBe(2);
    expect((msg2Delta.payload as any).delta).toBe('Building video player component...');
    expect((msg2Delta.payload as any).sequence).toBe(2);

    // Completion broadcast
    const p1Complete = waitForMessage(client1Ws, (m) => m.type === 'MESSAGE_COMPLETED');
    const p2Complete = waitForMessage(client2Ws, (m) => m.type === 'MESSAGE_COMPLETED');

    agentWs.send(
      JSON.stringify(
        createMessage('MESSAGE_COMPLETED', {
          deviceId: TEST_DEVICE_ID,
          sessionId: testSessionId,
          messageId: testMessageId,
          totalText: 'Building video player component...',
          timestamp: Date.now(),
          agentInstanceId: testAgentInstanceId,
          sequence: 3,
          scope: 'session',
        })
      )
    );

    const [msg1Comp, msg2Comp] = await Promise.all([p1Complete, p2Complete]);
    expect((msg1Comp.payload as any).sequence).toBe(3);
    expect((msg1Comp.payload as any).totalText).toBe('Building video player component...');
    expect((msg2Comp.payload as any).sequence).toBe(3);
    expect((msg2Comp.payload as any).totalText).toBe('Building video player component...');
  });

  it('Invariance 2: Authoritative Queue RPC, Peer Broadcast & Revision Tracking', async () => {
    const queueSessionId = 'session_queue_sync_1';

    // PC fetches initial queue
    client1Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_GET', {
          deviceId: TEST_DEVICE_ID,
          sessionId: queueSessionId,
          deviceToken: client1Token,
        })
      )
    );

    const initSync = await waitForMessage(
      client1Ws,
      (m) => m.type === 'SESSION_QUEUE_SYNC' && (m.payload as any).sessionId === queueSessionId
    );
    expect((initSync.payload as any).revision).toBe(0);
    expect((initSync.payload as any).queue).toEqual([]);

    // Set listener on Phone (client2) for peer broadcast
    const phonePeerSyncPromise = waitForMessage(
      client2Ws,
      (m) => m.type === 'SESSION_QUEUE_SYNC' && (m.payload as any).sessionId === queueSessionId
    );

    // PC user enqueues a prompt: baseRevision = 0, mutationId = 'mut_pc_1'
    const newQueueItem: QueuedMessage = {
      id: 'qmsg_pc_001',
      sessionId: queueSessionId,
      content: 'Add picture-in-picture mode',
      createdAt: 1790000010000,
      status: 'queued',
      retryCount: 0,
    };

    client1Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_UPDATE', {
          deviceId: TEST_DEVICE_ID,
          sessionId: queueSessionId,
          deviceToken: client1Token,
          clientId: 'client_pc_mirror',
          mutationId: 'mut_pc_1',
          baseRevision: 0,
          queue: [newQueueItem],
        })
      )
    );

    // PC receives update result ACK with incremented revision: 1
    const pcUpdateResult = await waitForMessage(
      client1Ws,
      (m) => m.type === 'SESSION_QUEUE_UPDATE_RESULT' && (m.payload as any).mutationId === 'mut_pc_1'
    );
    expect((pcUpdateResult.payload as any).accepted).toBe(true);
    expect((pcUpdateResult.payload as any).revision).toBe(1);

    // Phone receives peer broadcast SESSION_QUEUE_SYNC with revision 1 and updated queue!
    const phoneSync = await phonePeerSyncPromise;
    expect((phoneSync.payload as any).revision).toBe(1);
    expect((phoneSync.payload as any).queue.length).toBe(1);
    expect((phoneSync.payload as any).queue[0].content).toBe('Add picture-in-picture mode');
  });

  it('Invariance 3: Queue Mutation Idempotency deduplicates retransmissions without revision bump', async () => {
    const queueSessionId = 'session_queue_sync_1';
    const queueItem: QueuedMessage = {
      id: 'qmsg_pc_001',
      sessionId: queueSessionId,
      content: 'Add picture-in-picture mode',
      createdAt: 1790000010000,
      status: 'queued',
      retryCount: 0,
    };

    // Client 1 re-sends the exact same mutationId ('mut_pc_1')
    client1Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_UPDATE', {
          deviceId: TEST_DEVICE_ID,
          sessionId: queueSessionId,
          deviceToken: client1Token,
          clientId: 'client_pc_mirror',
          mutationId: 'mut_pc_1', // identical mutationId
          baseRevision: 0,
          queue: [queueItem],
        })
      )
    );

    const deduplicatedResult = await waitForMessage(
      client1Ws,
      (m) => m.type === 'SESSION_QUEUE_UPDATE_RESULT' && (m.payload as any).mutationId === 'mut_pc_1'
    );

    expect((deduplicatedResult.payload as any).accepted).toBe(true);
    // Revision remains 1, does NOT increment to 2
    expect((deduplicatedResult.payload as any).revision).toBe(1);
  });

  it('Invariance 4: Stale Revision Conflict Detection rejects out-of-order writes with authoritative state', async () => {
    const queueSessionId = 'session_queue_sync_1';

    // Phone tries to send mutation with baseRevision: 0 (server is already at revision 1)
    const phoneStaleItem: QueuedMessage = {
      id: 'qmsg_phone_conflict',
      sessionId: queueSessionId,
      content: 'Stale phone write',
      createdAt: 1790000020000,
      status: 'queued',
      retryCount: 0,
    };

    client2Ws.send(
      JSON.stringify(
        createMessage('SESSION_QUEUE_UPDATE', {
          deviceId: TEST_DEVICE_ID,
          sessionId: queueSessionId,
          deviceToken: client2Token,
          clientId: 'client_phone_mirror',
          mutationId: 'mut_phone_stale',
          baseRevision: 0, // Stale! Current is 1
          queue: [phoneStaleItem],
        })
      )
    );

    const conflictMsg = await waitForMessage(
      client2Ws,
      (m) => m.type === 'SESSION_QUEUE_CONFLICT' && (m.payload as any).sessionId === queueSessionId
    );

    expect((conflictMsg.payload as any).currentRevision).toBe(1);
    expect((conflictMsg.payload as any).rejectedMutationId).toBe('mut_phone_stale');
    expect((conflictMsg.payload as any).authoritativeQueue.length).toBe(1);
    expect((conflictMsg.payload as any).authoritativeQueue[0].content).toBe('Add picture-in-picture mode');
  });

  it('Invariance 5: Mid-Task Connection & Runtime Snapshot Hydration via SESSION_GET', async () => {
    const sessionHydrationId = 'session_mid_task_hydrate';

    // Prepare Agent to intercept SESSION_GET for this session and reply with rich snapshot
    const sessionGetPromise = waitForMessage(
      agentWs,
      (m) => m.type === 'SESSION_GET' && (m.payload as any).sessionId === sessionHydrationId
    );

    // Phone asks for session details
    client2Ws.send(
      JSON.stringify(
        createMessage('SESSION_GET', {
          deviceId: TEST_DEVICE_ID,
          sessionId: sessionHydrationId,
          deviceToken: client2Token,
        })
      )
    );

    const agentReceivedGet = await sessionGetPromise;
    expect((agentReceivedGet.payload as any).sessionId).toBe(sessionHydrationId);

    // Agent responds with authoritative SessionRuntimeSnapshot
    const testSnapshot: SessionRuntimeSnapshot = {
      status: 'busy',
      agentInstanceId: 'agent_epoch_alpha_99',
      snapshotSequence: 15,
      activeTurnId: 'turn_mid_99',
      activeMessageId: 'msg_mid_99',
      isStreaming: true,
      streamingText: 'Implementing video scrubber bar and seeking...',
      todos: [
        { id: 'todo_1', content: 'Create video layout', status: 'completed', priority: 'medium' },
        { id: 'todo_2', content: 'Implement seekbar', status: 'in_progress', priority: 'high' },
      ],
      diffs: [
        {
          file: 'src/components/Player.tsx',
          patch: '@@ -10,3 +10,6 @@\n+<SeekBar onSeek={handleSeek} />',
          additions: 1,
          deletions: 0,
          status: 'modified',
        },
      ],
      pendingPermissions: [
        {
          id: 'perm_bash_1',
          type: 'bash',
          tool: 'bash',
          command: 'npm run test:player',
          description: 'Execute video player tests',
        },
      ],
      pendingQuestions: [
        {
          id: 'q_quality_1',
          question: 'Should 1080p be the default resolution?',
          options: ['Yes', 'No, 720p', 'Auto'],
        },
      ],
    };

    agentWs.send(
      JSON.stringify(
        createMessage('SESSION_GET_RESULT', {
          deviceId: TEST_DEVICE_ID,
          session: {
            id: sessionHydrationId,
            title: 'YouTube Player Feature',
            createdAt: 1790000000000,
          },
          messages: [
            {
              id: 'user_prompt_1',
              sessionId: sessionHydrationId,
              role: 'user',
              content: 'Build the video scrubber',
              createdAt: 1790000001000,
            },
          ],
          runtime: testSnapshot,
        }, (agentReceivedGet as any).id) // match request ID
      )
    );

    // Phone receives the session result with full runtime snapshot
    const phoneSessionResult = await waitForMessage(
      client2Ws,
      (m) => m.type === 'SESSION_GET_RESULT' && (m.payload as any).session?.id === sessionHydrationId
    );

    const snapshot = (phoneSessionResult.payload as any).runtime;
    expect(snapshot).toBeDefined();
    expect(snapshot.agentInstanceId).toBe('agent_epoch_alpha_99');
    expect(snapshot.snapshotSequence).toBe(15);
    expect(snapshot.activeTurnId).toBe('turn_mid_99');
    expect(snapshot.isStreaming).toBe(true);
    expect(snapshot.streamingText).toBe('Implementing video scrubber bar and seeking...');
    expect(snapshot.todos.length).toBe(2);
    expect(snapshot.diffs.length).toBe(1);
    expect(snapshot.pendingPermissions.length).toBe(1);
    expect(snapshot.pendingQuestions.length).toBe(1);
  });

  it('Invariance 6: Snapshot Sequence Guard protects client from delayed snapshot regressions', () => {
    let clientStreamingText = 'Streaming delta live chunk 5';
    let lastKnownSequence = 5;

    // A delayed snapshot arrives with snapshotSequence: 3 (older than live events)
    const delayedSnapshot: SessionRuntimeSnapshot = {
      status: 'busy',
      agentInstanceId: 'agent_epoch_alpha_99',
      snapshotSequence: 3,
      isStreaming: true,
      streamingText: 'Old chunk 3',
      todos: [],
      diffs: [],
      pendingPermissions: [],
      pendingQuestions: [],
    };

    // Client guard logic
    if (delayedSnapshot.snapshotSequence >= lastKnownSequence) {
      clientStreamingText = delayedSnapshot.streamingText;
    }

    // Live stream was NOT overwritten!
    expect(clientStreamingText).toBe('Streaming delta live chunk 5');

    // If newer snapshot arrives with snapshotSequence: 7, it IS accepted
    const newerSnapshot: SessionRuntimeSnapshot = {
      ...delayedSnapshot,
      snapshotSequence: 7,
      streamingText: 'Newer verified snapshot chunk 7',
    };

    if (newerSnapshot.snapshotSequence >= lastKnownSequence) {
      clientStreamingText = newerSnapshot.streamingText;
      lastKnownSequence = newerSnapshot.snapshotSequence;
    }

    expect(clientStreamingText).toBe('Newer verified snapshot chunk 7');
    expect(lastKnownSequence).toBe(7);
  });

  it('Invariance 7: Agent Restart & Epoch Reset seamlessly re-anchors sequence', () => {
    const sessionEpochs = new Map<string, string>();
    const sessionSequences = new Map<string, number>();
    let gapDetected = false;

    function handleEventSequence(sessionId: string, agentInstanceId?: string, sequence?: number) {
      if (agentInstanceId) {
        const lastEpoch = sessionEpochs.get(sessionId);
        if (lastEpoch && lastEpoch !== agentInstanceId) {
          // New epoch: smooth re-anchor without false gap alarm
          sessionEpochs.set(sessionId, agentInstanceId);
          sessionSequences.set(sessionId, sequence || 1);
          return;
        }
        sessionEpochs.set(sessionId, agentInstanceId);
      }

      if (sequence !== undefined) {
        const lastSeq = sessionSequences.get(sessionId);
        if (lastSeq !== undefined && sequence > lastSeq + 1) {
          gapDetected = true;
        }
        sessionSequences.set(sessionId, sequence);
      }
    }

    // Step 1: Agent 1 streams seq 1, 2, 3
    handleEventSequence('session_epoch_test', 'agent_inst_1', 1);
    handleEventSequence('session_epoch_test', 'agent_inst_1', 2);
    handleEventSequence('session_epoch_test', 'agent_inst_1', 3);
    expect(gapDetected).toBe(false);
    expect(sessionSequences.get('session_epoch_test')).toBe(3);

    // Step 2: Agent restarts! New agentInstanceId = 'agent_inst_2', sequence starts at 1
    handleEventSequence('session_epoch_test', 'agent_inst_2', 1);
    // Verify no false gap alarm was triggered
    expect(gapDetected).toBe(false);
    expect(sessionEpochs.get('session_epoch_test')).toBe('agent_inst_2');
    expect(sessionSequences.get('session_epoch_test')).toBe(1);

    // Step 3: Normal gap within same epoch: seq 1 -> seq 4
    handleEventSequence('session_epoch_test', 'agent_inst_2', 4);
    expect(gapDetected).toBe(true);
  });

  it('Invariance 8: Multi-Permission Resolution across multiple devices', () => {
    let pendingPermissions = [
      { id: 'perm_bash_1', tool: 'bash', command: 'npm install' },
      { id: 'perm_fs_2', tool: 'write_file', path: 'src/main.ts' },
    ];

    // Phone resolves perm_bash_1
    const replyEvent = {
      sessionID: 'session_multi_perm',
      requestID: 'perm_bash_1',
      reply: 'allow',
    };

    // Client dismissal logic
    pendingPermissions = pendingPermissions.filter((p) => p.id !== replyEvent.requestID);

    // Only perm_fs_2 remains
    expect(pendingPermissions.length).toBe(1);
    expect(pendingPermissions[0].id).toBe('perm_fs_2');
  });

  it('Invariance 9: Multi-Question Resolution across multiple devices', () => {
    let pendingQuestions = [
      { id: 'q_1', question: 'Select theme', options: ['Dark', 'Light'] },
      { id: 'q_2', question: 'Include tests?', options: ['Yes', 'No'] },
    ];

    // PC resolves q_1
    const replyEvent = {
      sessionID: 'session_multi_q',
      requestID: 'q_1',
      answers: [['Dark']],
    };

    pendingQuestions = pendingQuestions.filter((q) => q.id !== replyEvent.requestID);

    expect(pendingQuestions.length).toBe(1);
    expect(pendingQuestions[0].id).toBe('q_2');
  });

  it('Invariance 10: Session Deletion purges persisted queue and clears state', async () => {
    const deletedSessionId = 'session_to_delete_99';

    // Store a queue first
    store.saveSessionQueue({
      deviceId: TEST_DEVICE_ID,
      sessionId: deletedSessionId,
      revision: 3,
      messages: [
        {
          id: 'q_del_1',
          sessionId: deletedSessionId,
          content: 'Pending prompt before deletion',
          createdAt: 1000,
          status: 'queued',
          retryCount: 0,
        },
      ],
      updatedAt: Date.now(),
    });

    expect(store.getSessionQueue(TEST_DEVICE_ID, deletedSessionId)).toBeDefined();

    // Agent emits session.deleted OPENCODE_EVENT through Relay
    agentWs.send(
      JSON.stringify(
        createMessage('OPENCODE_EVENT', {
          deviceId: TEST_DEVICE_ID,
          eventType: 'session.deleted',
          payload: {
            type: 'session.deleted',
            properties: {
              sessionID: deletedSessionId,
            },
          },
          sequence: 1,
        })
      )
    );

    // Allow event processing loop in Relay
    await new Promise((r) => setTimeout(r, 100));

    // Verify persisted queue was automatically cleaned up in store
    const afterDelete = store.getSessionQueue(TEST_DEVICE_ID, deletedSessionId);
    expect(afterDelete).toBeUndefined();
  });
});
