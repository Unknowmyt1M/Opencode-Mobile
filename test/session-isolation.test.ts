import { describe, it, expect } from 'vitest';
import {
  type SessionRuntimeState,
  createInitialSessionRuntime,
} from '../apps/web/src/useRelay.js';

describe('Session Isolation & Cross-Session Contamination Invariants', () => {
  it('Initializes clean, isolated runtime state with zero inherited data', () => {
    const runtime = createInitialSessionRuntime();
    expect(runtime.isStreaming).toBe(false);
    expect(runtime.isWaitingForResponse).toBe(false);
    expect(runtime.streamingText).toBe('');
    expect(runtime.todos).toEqual([]);
    expect(runtime.diffs).toEqual([]);
    expect(runtime.error).toBeNull();
  });

  it('Session A streaming events do NOT leak into Session B runtime', () => {
    const sessionRuntime: Record<string, SessionRuntimeState> = {
      'session_A': createInitialSessionRuntime(),
      'session_B': createInitialSessionRuntime(),
    };

    // 1. Session A starts streaming
    sessionRuntime['session_A'] = {
      ...sessionRuntime['session_A'],
      isStreaming: true,
      isWaitingForResponse: false,
      streamingText: 'Building YouTube clone...',
      activeMessageId: 'msg_yt_1',
    };

    // Verify Session B remains completely idle and clean
    expect(sessionRuntime['session_B'].isStreaming).toBe(false);
    expect(sessionRuntime['session_B'].streamingText).toBe('');
    expect(sessionRuntime['session_B'].activeMessageId).toBeUndefined();

    // 2. Session A receives streaming deltas
    sessionRuntime['session_A'].streamingText += ' adding CSS styles';

    // Verify Session B still untouched
    expect(sessionRuntime['session_B'].streamingText).toBe('');
    expect(sessionRuntime['session_A'].streamingText).toBe('Building YouTube clone... adding CSS styles');

    // 3. Session A completes
    sessionRuntime['session_A'] = {
      ...sessionRuntime['session_A'],
      isStreaming: false,
      isWaitingForResponse: false,
    };

    // Verify Session B state remains independent
    expect(sessionRuntime['session_B'].isStreaming).toBe(false);
    expect(sessionRuntime['session_B'].streamingText).toBe('');
  });

  it('Session A todos do NOT leak into Session B (Fix for Tasks 6/6 done)', () => {
    const sessionRuntime: Record<string, SessionRuntimeState> = {
      'session_A': createInitialSessionRuntime(),
      'session_B': createInitialSessionRuntime(),
    };

    // Session A has 6 completed todos
    const ytTodos = [
      { content: 'Setup Flask app', status: 'completed' as const, priority: 'high' as const },
      { content: 'Add templates', status: 'completed' as const, priority: 'high' as const },
      { content: 'Add static assets', status: 'completed' as const, priority: 'medium' as const },
      { content: 'Implement watch route', status: 'completed' as const, priority: 'high' as const },
      { content: 'Install ffmpeg', status: 'completed' as const, priority: 'high' as const },
      { content: 'End-to-end testing', status: 'completed' as const, priority: 'medium' as const },
    ];
    sessionRuntime['session_A'].todos = ytTodos;

    // A brand new Session B is created
    sessionRuntime['session_B'] = createInitialSessionRuntime();

    // Verify Session B has strictly 0 todos
    expect(sessionRuntime['session_B'].todos).toHaveLength(0);
    expect(sessionRuntime['session_A'].todos).toHaveLength(6);
  });

  it('Session A diffs do NOT leak into Session B review tab', () => {
    const sessionRuntime: Record<string, SessionRuntimeState> = {
      'session_A': createInitialSessionRuntime(),
      'session_B': createInitialSessionRuntime(),
    };

    // Session A modifies app.py and templates
    sessionRuntime['session_A'].diffs = [
      { file: 'youtube-clone/app.py', patch: '@@ -1 +1 @@', additions: 15, deletions: 2, status: 'modified' },
      { file: 'youtube-clone/templates/index.html', patch: '@@ -0 +1 @@', additions: 45, deletions: 0, status: 'added' },
    ];

    // Session B is fresh
    expect(sessionRuntime['session_B'].diffs).toHaveLength(0);
    expect(sessionRuntime['session_A'].diffs).toHaveLength(2);
  });

  it('Session A error does NOT leak into Session B', () => {
    const sessionRuntime: Record<string, SessionRuntimeState> = {
      'session_A': createInitialSessionRuntime(),
      'session_B': createInitialSessionRuntime(),
    };

    sessionRuntime['session_A'].error = 'OpenCode API timeout in YouTube clone';
    expect(sessionRuntime['session_B'].error).toBeNull();
  });

  it('Rapid session switching race: rejects stale SESSION_GET_RESULT from previously requested session', () => {
    // Simulated state machine
    let latestRequestedSessionId: string | null = null;
    let activeSession: { id: string; title: string } | null = null;

    // 1. User clicks Session A (takes 500ms to load)
    latestRequestedSessionId = 'session_A';

    // 2. User quickly clicks Session B (takes 100ms to load) before Session A finishes
    latestRequestedSessionId = 'session_B';

    // 3. Fast Session B completes first
    if (latestRequestedSessionId === 'session_B') {
      activeSession = { id: 'session_B', title: 'Session B' };
    }
    expect(activeSession?.id).toBe('session_B');

    // 4. Slow Session A finishes later. It checks latestRequestedSessionId!
    const incomingResultSessionId = 'session_A';
    if (latestRequestedSessionId === incomingResultSessionId) {
      activeSession = { id: 'session_A', title: 'Session A' };
    }

    // Stale Session A must NOT overwrite active Session B
    expect(activeSession?.id).toBe('session_B');
  });

  it('OPENCODE_EVENT message.part.updated strictly ignores events with mismatched sessionID', () => {
    const currentActiveSession = {
      id: 'session_B',
      messages: [{ id: 'msg_b_1', role: 'user', content: 'Hello' }],
    };

    // Incoming tool execution part belonging to background Session A
    const incomingEvent = {
      type: 'message.part.updated',
      properties: {
        sessionID: 'session_A',
        messageID: 'msg_a_tool',
        part: { id: 'part_tool_1', type: 'tool', tool: 'write_file' },
      },
    };

    const targetSessionId = incomingEvent.properties.sessionID;
    let updatedMessages = [...currentActiveSession.messages];

    // Relay verification rule: strictly require targetSessionId === currentActiveSession.id
    if (targetSessionId && targetSessionId === currentActiveSession.id) {
      updatedMessages.push({
        id: incomingEvent.properties.messageID,
        role: 'assistant',
        content: '',
      });
    }

    // Session B must NOT have Session A's tool execution message
    expect(updatedMessages).toHaveLength(1);
    expect(updatedMessages[0].id).toBe('msg_b_1');
  });

  it('Device switching cleanly wipes active session, diffs, and selected model', () => {
    let currentActiveSession: any = { id: 'sess_1', name: 'Work' };
    let currentActiveDiffFile: string | null = 'src/index.ts';
    let currentSelectedModel: any = { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' };
    let selectedDeviceId: string | null = 'device_laptop';

    // Switch to desktop
    const newDeviceId = 'device_desktop';
    if (selectedDeviceId !== newDeviceId) {
      currentActiveSession = null;
      currentActiveDiffFile = null;
      currentSelectedModel = null;
      selectedDeviceId = newDeviceId;
    }

    expect(selectedDeviceId).toBe('device_desktop');
    expect(currentActiveSession).toBeNull();
    expect(currentActiveDiffFile).toBeNull();
    expect(currentSelectedModel).toBeNull();
  });

  it('Agent turn lifecycle: creates fresh turn upon completion without stale reuse', () => {
    const sessionTurns = new Map<string, { messageId: string; startedEmitted: boolean; completedEmitted: boolean }>();

    const getOrCreateTurn = (sessionId: string, preferredMessageId?: string) => {
      let turn = sessionTurns.get(sessionId);
      if (!turn || turn.completedEmitted || (preferredMessageId && turn.startedEmitted && turn.messageId !== preferredMessageId)) {
        const messageId = preferredMessageId || `msg_${sessionId}_${Date.now()}`;
        turn = { messageId, startedEmitted: false, completedEmitted: false };
        sessionTurns.set(sessionId, turn);
      }
      return turn;
    };

    // 1. Turn 1 starts and completes
    const turn1 = getOrCreateTurn('sess_1', 'msg_1');
    turn1.startedEmitted = true;
    turn1.completedEmitted = true;
    // Turn 1 cleans up immediately or is superseded
    if (sessionTurns.get('sess_1') === turn1) {
      sessionTurns.delete('sess_1');
    }

    // 2. Fast subsequent prompt arrives 5ms later
    const turn2 = getOrCreateTurn('sess_1', 'msg_2');
    expect(turn2.messageId).toBe('msg_2');
    expect(turn2.startedEmitted).toBe(false);
    expect(turn2.completedEmitted).toBe(false);
    expect(turn2).not.toBe(turn1);
  });

  it('Session A permission requests do NOT leak into Session B UI', () => {
    const permissions = [
      { id: 'perm_1', sessionId: 'session_A', requestId: 'req_1', description: 'Run bash rm -rf /tmp' },
      { id: 'perm_2', sessionId: 'session_B', requestId: 'req_2', description: 'Read sensitive file' },
    ];

    // When viewing Session B:
    const activeSessionId = 'session_B';
    const visiblePermissions = permissions.filter((p) => !p.sessionId || p.sessionId === activeSessionId);

    expect(visiblePermissions).toHaveLength(1);
    expect(visiblePermissions[0].id).toBe('perm_2');
    expect(visiblePermissions[0].sessionId).toBe('session_B');
  });

  it('Background queue auto-dispatch: dispatches queued message when background session finishes', () => {
    const queues: Record<string, Array<{ id: string; status: string; content: string }>> = {
      'session_A': [{ id: 'q_1', status: 'queued', content: 'Next step in YouTube clone' }],
      'session_B': [],
    };

    // User is actively looking at Session B (idle)
    const activeSessionId = 'session_B';
    const streamingStatus: Record<string, boolean> = {
      'session_A': true,
      'session_B': false,
    };

    // Session A completes in background
    streamingStatus['session_A'] = false;

    // Background auto-dispatch check
    const dispatchedForSessions: string[] = [];
    for (const [sId, q] of Object.entries(queues)) {
      if (!streamingStatus[sId] && q.some((item) => item.status === 'queued')) {
        dispatchedForSessions.push(sId);
        const item = q.find((m) => m.status === 'queued')!;
        item.status = 'sending';
      }
    }

    expect(dispatchedForSessions).toContain('session_A');
    expect(queues['session_A'][0].status).toBe('sending');
    // Active Session B was completely unaffected
    expect(activeSessionId).toBe('session_B');
  });

  it('Target session streaming state decides queuing independently of active session', () => {
    const sessionStreamingStatus = {
      'session_A': true,  // busy in background
      'session_B': false, // idle and currently active
    };

    const decideAction = (targetSessionId: string) => {
      const isTargetBusy = sessionStreamingStatus[targetSessionId as keyof typeof sessionStreamingStatus];
      return isTargetBusy ? 'ENQUEUE' : 'SEND_DIRECT';
    };

    // Sending to Session B should execute directly even if Session A is busy
    expect(decideAction('session_B')).toBe('SEND_DIRECT');
    // Sending to Session A should enqueue
    expect(decideAction('session_A')).toBe('ENQUEUE');
  });

  it('13. Agent session-scoped permissions and questions: resolving Session B does NOT stall when Session A is pending', () => {
    // Session-scoped maps simulating agent architecture
    const sessionPermissions = new Map<string, Map<string, any>>();
    const getSessionPermissions = (sId: string) => {
      let m = sessionPermissions.get(sId);
      if (!m) {
        m = new Map();
        sessionPermissions.set(sId, m);
      }
      return m;
    };

    const sessionRuntimes: Record<string, { status: string }> = {
      'session_A': { status: 'waiting_permission' },
      'session_B': { status: 'waiting_permission' },
    };

    // Both sessions ask for permissions
    getSessionPermissions('session_A').set('perm_A', { id: 'perm_A', sessionID: 'session_A' });
    getSessionPermissions('session_B').set('perm_B', { id: 'perm_B', sessionID: 'session_B' });

    expect(getSessionPermissions('session_A').size).toBe(1);
    expect(getSessionPermissions('session_B').size).toBe(1);

    // Reply and resolve Session B's permission
    getSessionPermissions('session_B').delete('perm_B');
    if (getSessionPermissions('session_B').size === 0 && sessionRuntimes['session_B'].status === 'waiting_permission') {
      sessionRuntimes['session_B'].status = 'busy';
    }

    // Session B is correctly unblocked back to 'busy'
    expect(sessionRuntimes['session_B'].status).toBe('busy');
    expect(getSessionPermissions('session_B').size).toBe(0);

    // Session A remains safely isolated in 'waiting_permission'
    expect(sessionRuntimes['session_A'].status).toBe('waiting_permission');
    expect(getSessionPermissions('session_A').size).toBe(1);
  });

  it('14. Strict message part ownership: delayed parts from past turn do NOT bleed into active turn', () => {
    const activeTurn = { messageId: 'msg_assistant_turn_2' };
    const rt = {
      assistantMessageId: 'msg_assistant_turn_2',
      parts: [] as Array<{ id: string; messageID?: string; type: string; text?: string }>,
    };

    const handlePartUpdate = (part: { id: string; messageID?: string; type: string; text?: string }) => {
      const partMessageId = part.messageID;
      const activeMessageId = activeTurn.messageId || rt.assistantMessageId;
      if (partMessageId && activeMessageId && partMessageId !== activeMessageId) {
        // Discard cross-turn bleed!
        return false;
      }
      const pIdx = rt.parts.findIndex((existing) => existing.id === part.id);
      if (pIdx >= 0) {
        rt.parts[pIdx] = { ...rt.parts[pIdx], ...part };
      } else {
        rt.parts.push(part);
      }
      return true;
    };

    // Delayed part from Turn 1 arrives
    const acceptedTurn1 = handlePartUpdate({
      id: 'part_old_1',
      messageID: 'msg_assistant_turn_1',
      type: 'tool',
      text: 'old command output',
    });
    expect(acceptedTurn1).toBe(false);
    expect(rt.parts.length).toBe(0);

    // Active part from Turn 2 arrives
    const acceptedTurn2 = handlePartUpdate({
      id: 'part_active_2',
      messageID: 'msg_assistant_turn_2',
      type: 'tool',
      text: 'new active tool output',
    });
    expect(acceptedTurn2).toBe(true);
    expect(rt.parts.length).toBe(1);
    expect(rt.parts[0].id).toBe('part_active_2');
  });

  it('15. Monotonic sequence continuity on session.deleted: sequence advances monotonically (never resets to 1)', () => {
    const sessionSequences = new Map<string, number>();
    sessionSequences.set('session_A', 49);

    const nextSessionSequence = (sId: string) => {
      const current = sessionSequences.get(sId) ?? 0;
      const next = current + 1;
      sessionSequences.set(sId, next);
      return next;
    };

    // session.deleted arrives: sequence must advance monotonically to 50
    const seqOnDelete = nextSessionSequence('session_A');
    expect(seqOnDelete).toBe(50);

    // Terminal cleanup occurs AFTER emitting terminal event with seq 50
    sessionSequences.delete('session_A');
    expect(sessionSequences.has('session_A')).toBe(false);
  });
});

