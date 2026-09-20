import type { SessionMessage, SnapshotFileDiff } from '@opencode-remote/protocol';

export type ActivityType =
  | 'thought'
  | 'analyze'
  | 'edit'
  | 'create'
  | 'delete'
  | 'command'
  | 'search'
  | 'explore';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  label: string;
  verb: string;
  target?: string;
  path?: string;
  dirPath?: string;
  lineRange?: string;
  additions?: number;
  deletions?: number;
  durationSeconds?: number;
  content?: string;
  command?: string;
  output?: string;
  files?: string[];
  timestamp?: number;
  isStreaming?: boolean;
}

export interface TurnGroup {
  id: string;
  userMessage?: SessionMessage;
  agentRun: {
    totalDurationSeconds: number;
    durationLabel: string;
    activities: ActivityItem[];
    isStreaming: boolean;
    hasActiveWork: boolean;
  };
  finalResponse: string;
  completedAt?: number;
}

/**
 * Formats seconds into human-readable label: "15s", "1m 12s", "10m"
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  if (remaining === 0) return `${m}m`;
  return `${m}m ${remaining}s`;
}

/**
 * Extracts line range string like "#L380-460" or "#L15"
 */
function extractLineRange(input: any): string | undefined {
  if (!input) return undefined;
  const start = input.startLine ?? input.start_line ?? input.start ?? input.lineStart ?? input.offset;
  const end = input.endLine ?? input.end_line ?? input.end ?? input.lineEnd;

  if (typeof start === 'number' && typeof end === 'number') {
    return `#L${start}-${end}`;
  }
  if (typeof start === 'number') {
    return `#L${start}`;
  }
  return undefined;
}

/**
 * Cleans and extracts path info: filename and directory
 */
function extractPathInfo(rawPath: string | undefined): { filename: string; dirPath: string; fullPath: string } | null {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const clean = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = clean.split('/');
  const filename = parts.pop() || clean;
  const dirPath = parts.join('/');
  return { filename, dirPath, fullPath: clean };
}

/**
 * Normalizes messages and streaming state into structured turn groups
 */
export function normalizeConversationTurns(
  messages: SessionMessage[],
  streamingText: string | null = null,
  isStreaming: boolean = false,
  diffs: SnapshotFileDiff[] = []
): TurnGroup[] {
  // Build a lookup map of diffs by normalized relative file path
  const diffMap = new Map<string, SnapshotFileDiff>();
  for (const d of diffs) {
    const norm = d.file.replace(/\\/g, '/').toLowerCase();
    diffMap.set(norm, d);
    const filename = norm.split('/').pop();
    if (filename && !diffMap.has(filename)) {
      diffMap.set(filename, d);
    }
  }

  const turns: TurnGroup[] = [];
  let currentTurn: TurnGroup | null = null;

  const startNewTurn = (userMsg?: SessionMessage) => {
    const turnId = userMsg ? userMsg.id : `turn_${Date.now()}_${turns.length}`;
    currentTurn = {
      id: turnId,
      userMessage: userMsg,
      agentRun: {
        totalDurationSeconds: 0,
        durationLabel: 'Worked for 0s',
        activities: [],
        isStreaming: false,
        hasActiveWork: false,
      },
      finalResponse: '',
      completedAt: undefined,
    };
    turns.push(currentTurn);
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'user') {
      startNewTurn(msg);
      continue;
    }

    // Assistant / System message
    if (!currentTurn) {
      startNewTurn();
    }

    const turn = currentTurn!;
    const parts = msg.parts || [];

    // Track timestamps for duration calculation
    let firstPartTime: number | undefined = msg.createdAt;
    let lastPartTime: number | undefined = msg.createdAt;

    // Process all parts in exact chronological order
    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const part = parts[pIdx];
      const partAny = part as any;
      const partId = part.id || `${msg.id}_part_${pIdx}`;

      // 1. REASONING / THOUGHT
      if (part.type === 'reasoning') {
        const text = (part.text || '').trim();
        const durationSec =
          typeof part.duration === 'number'
            ? part.duration / 1000
            : (partAny.time?.end && partAny.time?.start)
            ? (partAny.time.end - partAny.time.start) / 1000
            : Math.max(1, Math.round((text.length / 80) * 2));

        if (partAny.time?.start) {
          firstPartTime = Math.min(firstPartTime, partAny.time.start);
          if (partAny.time.end) lastPartTime = Math.max(lastPartTime, partAny.time.end);
        }

        turn.agentRun.activities.push({
          id: partId,
          type: 'thought',
          verb: 'Thought for',
          label: `Thought for ${formatDuration(durationSec)}`,
          durationSeconds: durationSec,
          content: text,
          timestamp: partAny.time?.start || msg.createdAt,
        });
        continue;
      }

      // 2. TOOL EXECUTION
      if (part.type === 'tool') {
        const toolName = (part.tool || '').toLowerCase();
        const state = (part.state || {}) as any;
        const input = (state.input as any) || {};
        const meta = (state.metadata as any) || {};
        const rawPath = input.filePath || input.path || input.file || meta.filepath || part.path;
        const pathInfo = extractPathInfo(rawPath);
        const lineRange = extractLineRange(input);

        // A. Analyze / Read
        if (['read', 'view', 'cat', 'open_file', 'view_file', 'analyze'].includes(toolName)) {
          turn.agentRun.activities.push({
            id: partId,
            type: 'analyze',
            verb: 'Analyzed',
            label: 'Analyzed',
            target: pathInfo ? pathInfo.filename : (rawPath || 'file'),
            path: rawPath,
            dirPath: pathInfo?.dirPath,
            lineRange,
            content: typeof state.output === 'string' ? state.output : undefined,
            timestamp: msg.createdAt,
          });
          continue;
        }

        // B. Edit / Write / Create / Delete
        if (['write', 'edit', 'patch', 'create', 'new_file', 'apply_patch', 'replace_file_content', 'write_to_file', 'delete', 'remove'].includes(toolName)) {
          const isDelete = toolName === 'delete' || toolName === 'remove';
          const isCreate =
            !isDelete &&
            (toolName === 'create' ||
              toolName === 'new_file' ||
              meta.exists === false ||
              input.overwrite === false);

          // Find diff metrics from diffMap
          let additions = 0;
          let deletions = 0;
          let patch: string | undefined = undefined;

          if (pathInfo) {
            const matched =
              diffMap.get(pathInfo.fullPath.toLowerCase()) ||
              diffMap.get(pathInfo.filename.toLowerCase());
            if (matched) {
              additions = matched.additions;
              deletions = matched.deletions;
              patch = matched.patch;
            } else if (typeof input.content === 'string') {
              const linesCount = input.content.split('\n').length;
              additions = isDelete ? 0 : linesCount;
              deletions = isDelete ? linesCount : 0;
            }
          }

          const actType: ActivityType = isDelete ? 'delete' : isCreate ? 'create' : 'edit';
          const verb = isDelete ? 'Deleted' : isCreate ? 'Created' : 'Edited';

          turn.agentRun.activities.push({
            id: partId,
            type: actType,
            verb,
            label: verb,
            target: pathInfo ? pathInfo.filename : (rawPath || 'file'),
            path: rawPath,
            dirPath: pathInfo?.dirPath,
            additions,
            deletions,
            content: patch || (typeof state.output === 'string' ? state.output : undefined),
            timestamp: msg.createdAt,
          });
          continue;
        }

        // C. Command / Bash
        if (['bash', 'terminal', 'sh', 'exec', 'command', 'run_command'].includes(toolName)) {
          const cmd = input.command || input.cmd || input.CommandLine || String(state.input || '');
          const output = meta.output || state.output;
          turn.agentRun.activities.push({
            id: partId,
            type: 'command',
            verb: 'Ran',
            label: 'Ran',
            target: cmd ? (cmd.length > 50 ? `${cmd.slice(0, 48)}...` : cmd) : 'command',
            command: cmd,
            output: typeof output === 'string' ? output : JSON.stringify(output || ''),
            timestamp: msg.createdAt,
          });
          continue;
        }

        // D. Search / Grep
        if (['grep', 'search', 'grep_search', 'ripgrep', 'find_in_files'].includes(toolName)) {
          const query = input.query || input.pattern || input.search || '';
          turn.agentRun.activities.push({
            id: partId,
            type: 'search',
            verb: 'Searched',
            label: 'Searched',
            target: query ? `"${query}"` : 'workspace',
            path: rawPath,
            timestamp: msg.createdAt,
          });
          continue;
        }

        // E. Explore / Glob / Filesystem
        if (['glob', 'list', 'list_files', 'find', 'find_by_name', 'list_dir'].includes(toolName)) {
          const pattern = input.pattern || input.path || '';
          turn.agentRun.activities.push({
            id: partId,
            type: 'explore',
            verb: 'Explored',
            label: 'Explored',
            target: pattern ? pattern : 'files',
            timestamp: msg.createdAt,
          });
          continue;
        }

        // F. Generic fallback tool
        turn.agentRun.activities.push({
          id: partId,
          type: 'analyze',
          verb: 'Executed',
          label: 'Executed',
          target: part.tool || 'tool',
          timestamp: msg.createdAt,
        });
        continue;
      }

      // 3. TEXT PART
      if (part.type === 'text') {
        const clean = (part.text || '')
          .replace(/<supermemory-recall>[\s\S]*?<\/supermemory-recall>/gi, '')
          .trim();
        if (clean) {
          turn.finalResponse = turn.finalResponse ? `${turn.finalResponse}\n\n${clean}` : clean;
        }
      }
    }

    // If message had top-level content and no finalResponse yet
    if (msg.content && !turn.finalResponse) {
      const clean = msg.content
        .replace(/<supermemory-recall>[\s\S]*?<\/supermemory-recall>/gi, '')
        .trim();
      if (clean) {
        turn.finalResponse = clean;
      }
    }

    // Calculate total turn run duration
    let durSec = 0;
    if (turn.agentRun.activities.length > 0) {
      durSec = turn.agentRun.activities.reduce((acc, a) => acc + (a.durationSeconds || 1.5), 0);
      if (lastPartTime && firstPartTime && lastPartTime > firstPartTime) {
        durSec = Math.max(durSec, (lastPartTime - firstPartTime) / 1000);
      }
    }
    turn.agentRun.totalDurationSeconds = Math.max(1, Math.round(durSec));
    turn.agentRun.durationLabel = `Worked for ${formatDuration(turn.agentRun.totalDurationSeconds)}`;
    turn.agentRun.hasActiveWork = turn.agentRun.activities.length > 0;
  }

  // Handle active streaming turn
  if (isStreaming) {
    if (!currentTurn) {
      startNewTurn();
    }
    const activeTurn = currentTurn!;
    activeTurn.agentRun.isStreaming = true;
    if (activeTurn.agentRun.activities.length === 0 && !activeTurn.agentRun.durationLabel) {
      activeTurn.agentRun.durationLabel = 'Working...';
      activeTurn.agentRun.hasActiveWork = true;
    }
    // Append or update streaming text to finalResponse
    if (streamingText) {
      const cleanStreaming = streamingText
        .replace(/<supermemory-recall>[\s\S]*?<\/supermemory-recall>/gi, '')
        .trim();
      activeTurn.finalResponse = cleanStreaming;
    }
  }

  return turns;
}
