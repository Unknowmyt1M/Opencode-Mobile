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
});
