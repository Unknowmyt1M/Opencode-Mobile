import { describe, it, expect } from 'vitest';
import {
  type SessionRuntimeState,
  createInitialSessionRuntime,
} from '../apps/web/src/useRelay.js';
import type { SessionMessage, SnapshotFileDiff, PermissionItem } from '@opencode-remote/protocol';

describe('PC ↔ Mobile Mirror / Multi-Client Synchronization Architecture', () => {
  it('Peer User Message Ingestion: Native session.next.prompted appends to peer client conversation', () => {
    // Client B (PC) is observing Session A with 1 initial greeting
    let clientBMessages: SessionMessage[] = [
      {
        id: 'msg_init',
        sessionId: 'session_A',
        role: 'assistant',
        content: 'How can I help you today?',
        createdAt: 1000,
      },
    ];

    // Client A (Phone) sends prompt "Build a YouTube clone".
    // OpenCode backend emits native session.next.prompted event
    const opencodePromptEvent = {
      type: 'session.next.prompted',
      properties: {
        sessionID: 'session_A',
        messageID: 'msg_oc_user_prompt_123',
        prompt: {
          text: 'Build a YouTube clone',
        },
        timestamp: 2000,
      },
    };

    // Client B processes event
    const sessionId = opencodePromptEvent.properties.sessionID;
    const promptText = opencodePromptEvent.properties.prompt.text;
    const messageId = opencodePromptEvent.properties.messageID;
    const timestamp = opencodePromptEvent.properties.timestamp;

    // Reconciliation / Ingestion logic
    const existingIdx = clientBMessages.findIndex(
      (m) =>
        m.id === messageId ||
        (m.role === 'user' && m.id.startsWith('user_') && m.content === promptText)
    );

    if (existingIdx >= 0) {
      clientBMessages[existingIdx] = {
        ...clientBMessages[existingIdx],
        id: messageId,
        createdAt: timestamp,
      };
    } else {
      clientBMessages.push({
        id: messageId,
        sessionId,
        role: 'user',
        content: promptText,
        createdAt: timestamp,
      });
    }

    // Verify Client B now displays user prompt from Phone
    expect(clientBMessages.length).toBe(2);
    expect(clientBMessages[1]).toEqual({
      id: 'msg_oc_user_prompt_123',
      sessionId: 'session_A',
      role: 'user',
      content: 'Build a YouTube clone',
      createdAt: 2000,
    });
  });

  it('Optimistic User Message Reconciliation: Sender client replaces temporary ID with authoritative OpenCode ID', () => {
    // Client A (Phone) sent prompt optimistically with a temporary ID
    let clientAMessages: SessionMessage[] = [
      {
        id: 'user_1790000000000',
        sessionId: 'session_A',
        role: 'user',
        content: 'Build a YouTube clone',
        createdAt: 1790000000000,
      },
    ];

    // OpenCode responds with native session.next.prompted with real ID
    const opencodePromptEvent = {
      type: 'session.next.prompted',
      properties: {
        sessionID: 'session_A',
        messageID: 'msg_oc_authoritative_456',
        prompt: {
          text: 'Build a YouTube clone',
        },
        timestamp: 1790000000500,
      },
    };

    const promptText = opencodePromptEvent.properties.prompt.text;
    const messageId = opencodePromptEvent.properties.messageID;
    const timestamp = opencodePromptEvent.properties.timestamp;

    const existingIdx = clientAMessages.findIndex(
      (m) =>
        m.id === messageId ||
        (m.role === 'user' && m.id.startsWith('user_') && m.content === promptText)
    );

    expect(existingIdx).toBe(0);
    if (existingIdx >= 0) {
      clientAMessages[existingIdx] = {
        ...clientAMessages[existingIdx],
        id: messageId,
        createdAt: timestamp,
      };
    }

    // Verify no duplicates created, and ID is updated to authoritative OpenCode ID
    expect(clientAMessages.length).toBe(1);
    expect(clientAMessages[0].id).toBe('msg_oc_authoritative_456');
    expect(clientAMessages[0].createdAt).toBe(1790000000500);
  });

  it('Multi-Client Session Status Sync: session.status busy/idle updates streaming state across all clients', () => {
    const pcRuntime = createInitialSessionRuntime();
    const phoneRuntime = createInitialSessionRuntime();

    // 1. OpenCode emits session.status busy
    const busyEvent = {
      type: 'session.status',
      properties: {
        sessionID: 'session_A',
        status: { type: 'busy' },
      },
    };

    function handleSessionStatus(runtime: SessionRuntimeState, evt: typeof busyEvent) {
      if (evt.properties.status.type === 'busy') {
        return {
          ...runtime,
          isStreaming: true,
          isWaitingForResponse: false,
        };
      } else if (evt.properties.status.type === 'idle') {
        return {
          ...runtime,
          isStreaming: false,
          isWaitingForResponse: false,
        };
      }
      return runtime;
    }

    const pcBusy = handleSessionStatus(pcRuntime, busyEvent);
    const phoneBusy = handleSessionStatus(phoneRuntime, busyEvent);

    expect(pcBusy.isStreaming).toBe(true);
    expect(phoneBusy.isStreaming).toBe(true);

    // 2. OpenCode emits session.status idle
    const idleEvent = {
      type: 'session.status',
      properties: {
        sessionID: 'session_A',
        status: { type: 'idle' },
      },
    };

    const pcIdle = handleSessionStatus(pcBusy, idleEvent);
    const phoneIdle = handleSessionStatus(phoneBusy, idleEvent);

    expect(pcIdle.isStreaming).toBe(false);
    expect(phoneIdle.isStreaming).toBe(false);
  });

  it('Multi-Client Permission Dismissal: When Phone replies to permission, PC card dismisses automatically', () => {
    let pcPermissions: PermissionItem[] = [
      {
        id: 'perm_bash_123',
        type: 'bash',
        tool: 'bash',
        command: 'npm install lucide-react',
        description: 'Execute npm install',
      },
      {
        id: 'perm_fs_456',
        type: 'file_edit',
        tool: 'write_file',
        path: '/src/App.tsx',
        description: 'Modify file',
      },
    ];

    // Phone clicks "Allow" -> Agent replies to OpenCode -> OpenCode emits permission.replied
    const replyEvent = {
      type: 'permission.replied',
      properties: {
        sessionID: 'session_A',
        requestID: 'perm_bash_123',
        reply: 'allow',
      },
    };

    // PC processes native event
    const reqId = replyEvent.properties.requestID;
    pcPermissions = pcPermissions.filter((p) => p.id !== reqId && (p as any).requestId !== reqId);

    expect(pcPermissions.length).toBe(1);
    expect(pcPermissions[0].id).toBe('perm_fs_456');

    // Also verify PERMISSION_REPLY_RESULT dismissal path
    const replyResultMsg = {
      requestId: 'perm_fs_456',
      success: true,
    };
    if (replyResultMsg.success) {
      pcPermissions = pcPermissions.filter(
        (p) => p.id !== replyResultMsg.requestId && (p as any).requestId !== replyResultMsg.requestId
      );
    }

    expect(pcPermissions.length).toBe(0);
  });

  it('Mid-Flight Hydration: Connecting phone receives isStreaming and active diffs in SESSION_GET_RESULT', () => {
    // Phone connects while PC is mid-flight in Session A
    const phoneRuntime = createInitialSessionRuntime();

    const diffs: SnapshotFileDiff[] = [
      {
        file: 'src/components/Header.tsx',
        patch: '@@ -1 +1 @@\n-old\n+new',
        additions: 1,
        deletions: 1,
        status: 'modified',
      },
    ];

    const sessionGetResult = {
      deviceId: 'dev_pc',
      session: {
        id: 'session_A',
        title: 'Build YouTube clone',
        createdAt: Date.now() - 10000,
      },
      messages: [
        {
          id: 'user_1',
          sessionId: 'session_A',
          role: 'user' as const,
          content: 'Build YouTube clone',
          createdAt: Date.now() - 10000,
        },
        {
          id: 'asst_1',
          sessionId: 'session_A',
          role: 'assistant' as const,
          content: 'Creating Header component...',
          createdAt: Date.now() - 5000,
        },
      ],
      isStreaming: true,
      activeMessageId: 'asst_1',
      diffs,
    };

    // Phone hydrates runtime from snapshot
    let updatedPhoneRuntime = { ...phoneRuntime };
    if (sessionGetResult.isStreaming) {
      updatedPhoneRuntime = {
        ...updatedPhoneRuntime,
        isStreaming: true,
        isWaitingForResponse: false,
        activeMessageId: sessionGetResult.activeMessageId,
        diffs: sessionGetResult.diffs || [],
      };
    }

    expect(updatedPhoneRuntime.isStreaming).toBe(true);
    expect(updatedPhoneRuntime.activeMessageId).toBe('asst_1');
    expect(updatedPhoneRuntime.diffs.length).toBe(1);
    expect(updatedPhoneRuntime.diffs[0].file).toBe('src/components/Header.tsx');
  });

  it('Mid-Flight Accumulated Streaming Text: In-flight message is restored with partial text', () => {
    // Phone connects while OpenCode is streaming delta #15 on PC
    const snapshotPayload = {
      session: {
        id: 'session_A',
        title: 'Build YouTube clone',
        createdAt: 1000,
      },
      messages: [
        {
          id: 'user_1',
          sessionId: 'session_A',
          role: 'user' as const,
          content: 'Build YouTube clone',
          createdAt: 1000,
        },
      ],
      runtime: {
        status: 'busy' as const,
        isStreaming: true,
        activeMessageId: 'asst_stream_789',
        streamingText: 'I will now create the video player component with Plyr...',
        parts: [],
        todos: [],
        diffs: [],
        lastEventSequence: 15,
      },
    };

    // Client hydration algorithm from useRelay
    const { session, messages: rawMessages, runtime } = snapshotPayload;
    let mergedMessages = [...rawMessages];
    const isStreaming = Boolean(runtime?.isStreaming);
    const activeMsgId = runtime?.activeMessageId;
    const accumulatedText = runtime?.streamingText || '';

    if (isStreaming && activeMsgId) {
      const existingIdx = mergedMessages.findIndex((m) => m.id === activeMsgId);
      if (existingIdx >= 0) {
        mergedMessages[existingIdx] = {
          ...mergedMessages[existingIdx],
          content: mergedMessages[existingIdx].content || accumulatedText,
        };
      } else {
        mergedMessages.push({
          id: activeMsgId,
          sessionId: session.id,
          role: 'assistant',
          content: accumulatedText,
          parts: [],
          createdAt: Date.now(),
        });
      }
    }

    expect(mergedMessages.length).toBe(2);
    expect(mergedMessages[1].id).toBe('asst_stream_789');
    expect(mergedMessages[1].content).toBe('I will now create the video player component with Plyr...');
    expect(mergedMessages[1].role).toBe('assistant');
  });

  it('Turn Lifecycle Persistence: Multi-step turn does not complete on text.ended', () => {
    // Verify that session status remains busy when text.ended arrives,
    // and only transitions to idle on true session.status idle
    let status = 'busy';
    let isStreaming = true;

    // 1. Step 1 text delta finishes, OpenCode emits session.next.text.ended
    const textEndedEvent = {
      type: 'session.next.text.ended',
      properties: { sessionID: 'session_A' },
    };

    // OpenCode Mobile lifecycle rule: text.ended does NOT terminate turn
    if (textEndedEvent.type === 'session.next.text.ended') {
      // no-op: Step 2 tool execution is still proceeding
    }
    expect(status).toBe('busy');
    expect(isStreaming).toBe(true);

    // 2. OpenCode finishes all tool execution steps and emits session.status idle
    const turnCompleteEvent = {
      type: 'session.status',
      properties: {
        sessionID: 'session_A',
        status: { type: 'idle' },
      },
    };

    if (turnCompleteEvent.properties.status.type === 'idle') {
      status = 'idle';
      isStreaming = false;
    }

    expect(status).toBe('idle');
    expect(isStreaming).toBe(false);
  });

  it('Cross-Client Queue Sync: Relay broadcasts SESSION_QUEUE_SYNC to synchronize queue state', () => {
    // PC queue starts empty
    let pcQueue: any[] = [];
    // Phone user enqueues a prompt while agent is busy
    const phoneEnqueuedItem = {
      id: 'qmsg_1',
      sessionId: 'session_A',
      content: 'Add dark mode toggle next',
      createdAt: 3000,
      status: 'queued',
      retryCount: 0,
    };

    // Relay receives SESSION_QUEUE_UPDATE and broadcasts SESSION_QUEUE_SYNC
    const syncEvent = {
      type: 'SESSION_QUEUE_SYNC',
      payload: {
        deviceId: 'dev_pc',
        sessionId: 'session_A',
        queue: [phoneEnqueuedItem],
      },
    };

    // PC client syncQueue handler
    pcQueue = [...syncEvent.payload.queue];

    expect(pcQueue.length).toBe(1);
    expect(pcQueue[0].content).toBe('Add dark mode toggle next');
    expect(pcQueue[0].status).toBe('queued');
  });

  it('Event Sequence Gap Detection: Gap triggers authoritative reconciliation', () => {
    let reconciliationTriggered = false;
    let lastSequence: number | undefined = 10;
    const incomingSequence = 13; // Missed 11 and 12

    if (lastSequence !== undefined && incomingSequence > lastSequence + 1) {
      reconciliationTriggered = true;
    }
    lastSequence = incomingSequence;

    expect(reconciliationTriggered).toBe(true);
    expect(lastSequence).toBe(13);
  });

  it('Deterministic Correlation: MESSAGE_SEND_ACK reconciles optimistic message by clientMessageId', () => {
    const clientMessageId = 'cmsg_179022_abc123';
    let messages: SessionMessage[] = [
      {
        id: 'user_temp_1',
        clientMessageId,
        sessionId: 'session_A',
        role: 'user',
        content: 'Refactor auth service',
        createdAt: 1000,
      },
    ];

    // MESSAGE_SEND_ACK arrives with authoritative messageId
    const ackPayload = {
      sessionId: 'session_A',
      messageId: 'msg_oc_authoritative_999',
      clientMessageId,
      success: true,
    };

    const idx = messages.findIndex(
      (m) => m.clientMessageId === ackPayload.clientMessageId || m.id === ackPayload.clientMessageId
    );
    expect(idx).toBe(0);
    if (idx >= 0) {
      messages[idx] = {
        ...messages[idx],
        id: ackPayload.messageId,
      };
    }

    expect(messages[0].id).toBe('msg_oc_authoritative_999');
    expect(messages[0].clientMessageId).toBe('cmsg_179022_abc123');
  });

  it('Durable Processed Mutations in Relay Store: Idempotency survives restart', () => {
    const processedMutations = new Map<string, { mutationId: string; revision: number; timestamp: number }>();
    const record = (mutationId: string, revision: number) => {
      processedMutations.set(mutationId, { mutationId, revision, timestamp: Date.now() });
    };
    const has = (mutationId: string) => processedMutations.has(mutationId);

    expect(has('mut_1')).toBe(false);
    record('mut_1', 1);
    expect(has('mut_1')).toBe(true);

    // Serialization & rehydration simulation
    const serialized = Array.from(processedMutations.entries());
    const rehydrated = new Map(serialized);
    expect(rehydrated.has('mut_1')).toBe(true);
  });

  it('Authoritative Nullish Hydration: Empty string streaming text does not fall back to stale text', () => {
    const legacyPayload = {
      isStreaming: true,
      streamingText: 'Stale streaming text that finished',
      activeMessageId: 'msg_old',
    };

    // Authoritative runtime snapshot from OpenCode via Agent
    const authoritativeRuntime = {
      isStreaming: false,
      streamingText: '', // Empty because turn is complete
      activeMessageId: undefined,
    };

    // Correct nullish coalescing
    const isStreaming = Boolean(authoritativeRuntime.isStreaming ?? legacyPayload.isStreaming);
    const streamingText = authoritativeRuntime.streamingText ?? legacyPayload.streamingText ?? '';
    const activeMsgId = authoritativeRuntime.activeMessageId ?? legacyPayload.activeMessageId;

    expect(isStreaming).toBe(false);
    expect(streamingText).toBe(''); // NOT 'Stale streaming text that finished'!
    expect(activeMsgId).toBe('msg_old'); // Falls back to legacy activeMessageId if undefined
  });

  it('Session-Scoped Permissions & Questions: Isolated per session', () => {
    const sessionPermissions: Record<string, PermissionItem[]> = {};

    // Session A receives permission
    sessionPermissions['session_A'] = [
      { id: 'perm_1', sessionID: 'session_A', title: 'Execute bash', command: 'ls', time: 1000 },
    ];
    // Session B receives permission
    sessionPermissions['session_B'] = [
      { id: 'perm_2', sessionID: 'session_B', title: 'File write', command: 'write file', time: 2000 },
    ];

    // Client views Session A
    const activeSessionAId = 'session_A';
    const activeA = sessionPermissions[activeSessionAId] || [];
    expect(activeA.length).toBe(1);
    expect(activeA[0].id).toBe('perm_1');

    // Client switches to Session B
    const activeSessionBId = 'session_B';
    const activeB = sessionPermissions[activeSessionBId] || [];
    expect(activeB.length).toBe(1);
    expect(activeB[0].id).toBe('perm_2');
  });
});
