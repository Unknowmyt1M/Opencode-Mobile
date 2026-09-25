import type {
  SessionMessage,
  SnapshotFileDiff,
  OpenCodeSession,
  PtySession,
} from '@opencode-remote/protocol';

export interface TimelineSubagent {
  id: string;
  name: string;
  subagentType?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  duration?: string;
  durationSeconds?: number;
  directory?: string;
  createdAt: number;
}

export interface TimelineChangedFile {
  file: string;
  filename: string;
  dirPath: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch?: string;
}

export interface TimelineUpload {
  id: string;
  filename: string;
  mime?: string;
  url?: string;
  size?: string;
  sizeBytes?: number;
  createdAt: number;
}

export interface TimelineBackgroundTask {
  id: string;
  title: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  output: string;
  startedAt: number;
  duration?: string;
  durationSeconds?: number;
  exitCode?: number;
}

export interface TimelineTerminal {
  id: string;
  name: string;
  shell?: string;
  directory?: string;
  running: boolean;
}

function formatDurationSeconds(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  if (remaining === 0) return `${m}m`;
  return `${m}m ${remaining}s`;
}

function formatRelativeTimestamp(ts: number): string {
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes?: number): string | undefined {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 1. Select Subagents:
 * Discovers real subagent sessions started during the current main session.
 * Sources:
 * - Child sessions where session.parentID === sessionId
 * - Tool parts in messages where part.tool === 'task' | 'subagent' | 'call_subagent'
 */
export function selectSubagents(
  sessionId: string,
  messages: SessionMessage[],
  allSessions: OpenCodeSession[] = [],
  sessionStatuses: Record<string, string> = {}
): TimelineSubagent[] {
  if (!sessionId) return [];

  const subagentsMap = new Map<string, TimelineSubagent>();

  // Source A: Child sessions in allSessions having parentID === sessionId
  for (const sess of allSessions) {
    if (sess.parentID && sess.parentID === sessionId) {
      const isBusy = sessionStatuses[sess.id] === 'busy';
      const cleanTitle = (sess.title || 'Subagent')
        .replace(/\s*\(@[\w-]+\s+subagent\)/gi, '')
        .trim();

      const typeMatch = (sess.title || '').match(/@([\w-]+)\s+subagent/i);
      const subagentType = typeMatch ? typeMatch[1] : undefined;

      const durSec = sess.updatedAt && sess.createdAt ? Math.max(1, (sess.updatedAt - sess.createdAt) / 1000) : undefined;
      const durationStr = isBusy
        ? 'Working...'
        : durSec
        ? `Worked for ${formatDurationSeconds(durSec)}`
        : formatRelativeTimestamp(sess.createdAt);

      subagentsMap.set(sess.id, {
        id: sess.id,
        name: cleanTitle || 'Subagent',
        subagentType,
        status: isBusy ? 'running' : 'completed',
        duration: durationStr,
        durationSeconds: durSec,
        directory: sess.directory,
        createdAt: sess.createdAt,
      });
    }
  }

  // Source B: Tool parts in current session's messages
  const sessionMessages = messages.filter((m) => m.sessionId === sessionId);
  for (const msg of sessionMessages) {
    const parts = msg.parts || [];
    for (const part of parts) {
      const toolName = (part.tool || '').toLowerCase();
      if (['task', 'subagent', 'call_subagent', 'invoke_subagent'].includes(toolName)) {
        const state = (part.state || {}) as any;
        const input = (state.input || {}) as any;
        const meta = (state.metadata || {}) as any;
        const subId = meta.sessionId || meta.subagentSessionId || state.sessionId || part.id || `sub_${Date.now()}`;
        const subagentType = input.subagent_type || meta.model?.id || meta.subagentType;
        const taskTitle = input.description || meta.title || input.prompt || 'Subagent Task';

        const rawStatus = state.status || (sessionStatuses[subId] === 'busy' ? 'running' : 'completed');
        const status: TimelineSubagent['status'] =
          rawStatus === 'running'
            ? 'running'
            : rawStatus === 'error' || state.error
            ? 'error'
            : rawStatus === 'cancelled'
            ? 'cancelled'
            : 'completed';

        const startTime = state.time?.start || msg.createdAt;
        const endTime = state.time?.end;
        const durSec = endTime && startTime ? Math.max(1, (endTime - startTime) / 1000) : part.duration ? part.duration / 1000 : undefined;
        const durationStr =
          status === 'running'
            ? 'Working...'
            : durSec
            ? `Worked for ${formatDurationSeconds(durSec)}`
            : formatRelativeTimestamp(startTime);

        const existing = subagentsMap.get(subId);
        if (existing) {
          existing.status = status;
          if (durSec) {
            existing.durationSeconds = durSec;
            existing.duration = durationStr;
          }
          if (subagentType) existing.subagentType = subagentType;
        } else {
          subagentsMap.set(subId, {
            id: subId,
            name: taskTitle,
            subagentType,
            status,
            duration: durationStr,
            durationSeconds: durSec,
            createdAt: startTime,
          });
        }
      }
    }
  }

  // Sort chronological descending (most recent first)
  return Array.from(subagentsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 2. Select Changed Files:
 * Uses authoritative snapshot file diffs for the current session.
 */
export function selectChangedFiles(
  sessionId: string,
  diffs: SnapshotFileDiff[] = []
): TimelineChangedFile[] {
  if (!sessionId) return [];

  return diffs.map((d) => {
    const clean = d.file.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = clean.split('/');
    const filename = parts.pop() || clean;
    const dirPath = parts.join('/');

    let status: TimelineChangedFile['status'] = 'modified';
    const rawStatus = (d.status || '').toLowerCase();
    if (rawStatus === 'added' || rawStatus === 'a' || (d.additions > 0 && d.deletions === 0)) {
      status = 'added';
    } else if (rawStatus === 'deleted' || rawStatus === 'd' || (d.additions === 0 && d.deletions > 0)) {
      status = 'deleted';
    } else if (rawStatus === 'renamed' || rawStatus === 'r') {
      status = 'renamed';
    }

    return {
      file: clean,
      filename,
      dirPath,
      additions: d.additions || 0,
      deletions: d.deletions || 0,
      status,
      patch: d.patch,
    };
  });
}

/**
 * 3. Select Uploads:
 * Discovers files attached or uploaded by the USER in the current session.
 */
export function selectUploads(
  sessionId: string,
  messages: SessionMessage[]
): TimelineUpload[] {
  if (!sessionId) return [];

  const uploads: TimelineUpload[] = [];
  const seenIds = new Set<string>();

  const sessionMessages = messages.filter((m) => m.sessionId === sessionId && m.role === 'user');

  for (const msg of sessionMessages) {
    const parts = msg.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as any;
      const isFilePart = part.type === 'file' || part.type === 'image' || part.type === 'media';

      if (isFilePart) {
        const id = part.id || `${msg.id}_file_${i}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const filename =
          part.filename ||
          (part.path ? part.path.split(/[\\/]/).pop() : undefined) ||
          (part.url ? part.url.split(/[\\/]/).pop()?.split('?')[0] : undefined) ||
          `Media (${formatRelativeTimestamp(msg.createdAt)})`;

        uploads.push({
          id,
          filename,
          mime: part.mime || part.mediaType || (part.type === 'image' ? 'image/png' : undefined),
          url: part.url || part.path,
          size: formatFileSize(part.size),
          sizeBytes: part.size,
          createdAt: msg.createdAt,
        });
      }
    }

    // Check custom attachments array if present on user message
    const customAttachments = (msg as any).attachments;
    if (Array.isArray(customAttachments)) {
      for (let i = 0; i < customAttachments.length; i++) {
        const att = customAttachments[i];
        const id = att.id || `${msg.id}_att_${i}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        uploads.push({
          id,
          filename: att.filename || att.name || `File ${i + 1}`,
          mime: att.mime || att.type,
          url: att.url || att.data,
          size: formatFileSize(att.size),
          sizeBytes: att.size,
          createdAt: msg.createdAt,
        });
      }
    }
  }

  // Sort chronological descending (most recent upload first)
  return uploads.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 4. Select Background Tasks:
 * Discovers real commands / tasks executed or running in the current session.
 */
export function selectBackgroundTasks(
  sessionId: string,
  messages: SessionMessage[]
): TimelineBackgroundTask[] {
  if (!sessionId) return [];

  const tasks: TimelineBackgroundTask[] = [];
  const seenIds = new Set<string>();

  const sessionMessages = messages.filter((m) => m.sessionId === sessionId);

  for (const msg of sessionMessages) {
    const parts = msg.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === 'tool') {
        const toolName = (part.tool || '').toLowerCase();
        const state = (part.state || {}) as any;
        const input = (state.input || {}) as any;
        const meta = (state.metadata || {}) as any;

        const isCommandTool = ['bash', 'terminal', 'sh', 'exec', 'command', 'run_command', 'cmd', 'powershell'].includes(toolName);
        const hasCmdParam = Boolean(input.command || input.cmd || input.CommandLine || input.script);

        if (isCommandTool || hasCmdParam) {
          const taskId = part.id || part.callID || `${msg.id}_task_${i}`;
          if (seenIds.has(taskId)) continue;
          seenIds.add(taskId);

          const fullCommand = String(input.command || input.cmd || input.CommandLine || input.script || state.input || '');
          const rawOutput = meta.output || state.output || '';
          const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);

          const rawStatus = state.status;
          let status: TimelineBackgroundTask['status'] = 'completed';
          if (rawStatus === 'running') {
            status = 'running';
          } else if (rawStatus === 'error' || meta.exitCode !== undefined && meta.exitCode !== 0) {
            status = 'error';
          }

          const startedAt = state.time?.start || msg.createdAt;
          const endedAt = state.time?.end;
          const durSec = endedAt && startedAt ? Math.max(1, (endedAt - startedAt) / 1000) : part.duration ? part.duration / 1000 : undefined;
          const durationStr = durSec ? formatDurationSeconds(durSec) : undefined;

          // Short title for display
          const displayTitle = fullCommand.length > 60 ? `${fullCommand.slice(0, 58)}...` : fullCommand || toolName;

          tasks.push({
            id: taskId,
            title: displayTitle,
            command: fullCommand,
            status,
            output: outputStr,
            startedAt,
            duration: durationStr,
            durationSeconds: durSec,
            exitCode: meta.exitCode,
          });
        }
      }
    }
  }

  // Sort chronological descending (most recent first)
  return tasks.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * 5. Select Active Terminals:
 * Discovers real currently active terminals/PTY sessions.
 */
export function selectActiveTerminals(
  _sessionId: string,
  ptys: PtySession[] = []
): TimelineTerminal[] {
  return ptys
    .filter((p) => p.status !== 'closed' && p.status !== 'exit' && p.status !== 'exited')
    .map((p) => ({
      id: p.id,
      name: p.title || p.command || 'Terminal',
      shell: p.command,
      directory: p.cwd,
      running: p.status === 'running' || p.status === 'active' || !p.status,
    }));
}
