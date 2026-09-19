import { useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import type { MessagePart, SnapshotFileDiff } from '@opencode-remote/protocol';

interface ToolExecutionCardProps {
  part: MessagePart;
  diffs?: SnapshotFileDiff[];
  onViewFile?: (file: string) => void;
}

function getExtensionInfo(filePath: string) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { label: 'TS', bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'js':
    case 'jsx':
    case 'mjs':
      return { label: 'JS', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    case 'md':
    case 'markdown':
      return { label: 'MD', bg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
    case 'py':
      return { label: 'PY', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    case 'json':
      return { label: 'JSON', bg: 'bg-orange-500/15 text-orange-400 border-orange-500/30' };
    case 'css':
    case 'scss':
      return { label: 'CSS', bg: 'bg-pink-500/15 text-pink-400 border-pink-500/30' };
    case 'html':
      return { label: 'HTML', bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
    case 'rs':
      return { label: 'RS', bg: 'bg-red-500/15 text-red-400 border-red-500/30' };
    case 'go':
      return { label: 'GO', bg: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
    case 'yaml':
    case 'yml':
      return { label: 'YML', bg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
    case 'sh':
    case 'bash':
    case 'ps1':
      return { label: 'SH', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    default:
      return { label: ext ? ext.toUpperCase().slice(0, 4) : 'FILE', bg: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  }
}

export function ToolExecutionCard({ part, diffs, onViewFile }: ToolExecutionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllLines, setShowAllLines] = useState(false);

  const state = (part.state as any) || {};
  const tool = (part.tool || 'tool').toLowerCase();
  const status = state.status || 'completed';

  const rawPath =
    state.title ||
    state.input?.filePath ||
    state.input?.path ||
    state.metadata?.filepath ||
    part.path ||
    '';

  const cleanTarget =
    typeof rawPath === 'string' && rawPath.length > 0
      ? rawPath.split(/[/\\]/).pop() || rawPath
      : '';

  const rawCommand =
    typeof state.input?.command === 'string'
      ? state.input.command
      : typeof state.input?.cmd === 'string'
      ? state.input.cmd
      : '';

  const isWrite = tool === 'write' || tool === 'create_file' || tool === 'new_file';
  const isEdit = tool === 'edit' || tool === 'patch' || tool === 'apply_patch';
  const isRead = tool === 'read' || tool === 'view_file' || tool === 'read_file' || tool === 'explore';
  const isCommand = ['bash', 'terminal', 'sh', 'exec', 'command', 'powershell'].includes(tool);
  const isFileTool = isWrite || isEdit || isRead;

  // Matching diff from session diff engine
  const matchingDiff = diffs?.find((d) => {
    if (!cleanTarget) return false;
    const f = d.file.replace(/\\/g, '/');
    const targetNorm = cleanTarget.replace(/\\/g, '/');
    return f.endsWith(targetNorm) || targetNorm.endsWith(f);
  });

  // Calculate additions / deletions
  let additions = matchingDiff?.additions || 0;
  let deletions = matchingDiff?.deletions || 0;

  const inputContent: string =
    typeof state.input?.content === 'string' ? state.input.content : '';

  if (isWrite && additions === 0 && inputContent) {
    additions = inputContent.split('\n').length;
  }

  const extInfo = getExtensionInfo(cleanTarget);

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Determine verb and subject
  let actionVerb = 'Ran';
  if (isWrite) {
    actionVerb = state.metadata?.exists === false || !matchingDiff || matchingDiff.status === 'added' ? 'Created' : 'Edited';
  } else if (isEdit) {
    actionVerb = 'Edited';
  } else if (isRead) {
    actionVerb = 'Explored';
  } else if (isCommand) {
    actionVerb = 'Ran';
  } else {
    actionVerb = tool.charAt(0).toUpperCase() + tool.slice(1);
  }

  // Parse lines for preview
  let previewLines: { num: number; type: 'add' | 'del' | 'context'; text: string }[] = [];
  if (matchingDiff?.patch) {
    const rawLines = matchingDiff.patch.split('\n');
    let lineCounter = 1;
    for (const l of rawLines) {
      if (l.startsWith('@@') || l.startsWith('---') || l.startsWith('+++')) continue;
      if (l.startsWith('+')) {
        previewLines.push({ num: lineCounter++, type: 'add', text: l.slice(1) });
      } else if (l.startsWith('-')) {
        previewLines.push({ num: lineCounter, type: 'del', text: l.slice(1) });
      } else {
        previewLines.push({ num: lineCounter++, type: 'context', text: l });
      }
    }
  } else if (inputContent) {
    const rawLines = inputContent.split('\n');
    previewLines = rawLines.map((l, idx) => ({
      num: idx + 1,
      type: 'add',
      text: l,
    }));
  }

  const MAX_PREVIEW = 12;
  const displayedLines = showAllLines ? previewLines : previewLines.slice(0, MAX_PREVIEW);

  return (
    <div className="my-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 overflow-hidden text-xs transition-all hover:border-zinc-700/80 shadow-sm">
      {/* Feed Row - Styled like Antigravity Activity Item */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3 py-2 flex items-center justify-between gap-2.5 cursor-pointer hover:bg-zinc-900/40 select-none group"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Action Verb */}
          <span className="font-semibold text-zinc-200 text-xs shrink-0">
            {actionVerb}
          </span>

          {/* Extension Badge (if file) */}
          {isFileTool && cleanTarget && (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border shrink-0 ${extInfo.bg}`}
            >
              {extInfo.label}
            </span>
          )}

          {/* Target / File / Command */}
          {cleanTarget ? (
            <span className="font-mono text-zinc-300 truncate text-[11px] group-hover:text-white transition-colors">
              {cleanTarget}
            </span>
          ) : rawCommand ? (
            <span className="font-mono text-zinc-400 truncate text-[11px] max-w-[180px] group-hover:text-zinc-300 transition-colors">
              {rawCommand}
            </span>
          ) : null}

          {/* Diff counts +N -M */}
          {(additions > 0 || deletions > 0) && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] shrink-0 font-medium ml-0.5">
              {additions > 0 && <span className="text-emerald-400">+{additions}</span>}
              {deletions > 0 && <span className="text-rose-400">-{deletions}</span>}
            </div>
          )}
        </div>

        {/* Right side: status + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          {status === 'running' && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          )}
          {status === 'error' && (
            <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
          )}
          <ChevronRight
            className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        </div>
      </div>

      {/* Expanded Inline Preview */}
      {isExpanded && (
        <div className="border-t border-zinc-900 bg-black/50 text-[11px] font-mono">
          {/* Top Bar inside expanded drawer */}
          <div className="px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-900 flex items-center justify-between text-[10px] text-zinc-400">
            <span className="truncate max-w-[200px]" title={rawPath || rawCommand}>
              {rawPath || rawCommand || tool}
            </span>

            <div className="flex items-center gap-2 shrink-0">
              {inputContent && (
                <button
                  onClick={(e) => handleCopy(inputContent, e)}
                  className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Copy content"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              )}

              {isFileTool && cleanTarget && onViewFile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewFile(cleanTarget);
                  }}
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  title="Open full diff view"
                >
                  <span>Diff View</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* File Diff / Content Preview */}
          {isFileTool && previewLines.length > 0 && (
            <div className="p-2 space-y-0.5 overflow-x-auto">
              <div className="rounded-lg bg-zinc-950/90 border border-zinc-900 overflow-hidden font-mono text-[10.5px] leading-5">
                {displayedLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start ${
                      line.type === 'add'
                        ? 'bg-emerald-950/30 text-emerald-200 border-l-2 border-emerald-500'
                        : line.type === 'del'
                        ? 'bg-rose-950/30 text-rose-200 border-l-2 border-rose-500'
                        : 'text-zinc-300 hover:bg-zinc-900/30'
                    }`}
                  >
                    <span className="w-8 shrink-0 select-none text-right pr-2 text-zinc-600 font-mono text-[10px]">
                      {line.num}
                    </span>
                    <span className="w-4 shrink-0 select-none text-center text-[10px] font-bold">
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all pr-2 font-mono">
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>

              {previewLines.length > MAX_PREVIEW && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllLines(!showAllLines);
                  }}
                  className="w-full py-1 text-center text-[10px] text-zinc-500 hover:text-zinc-300 font-mono transition-colors"
                >
                  {showAllLines
                    ? 'Show fewer lines'
                    : `+${previewLines.length - MAX_PREVIEW} more lines (tap to view all)`}
                </button>
              )}
            </div>
          )}

          {/* Terminal / Command Output Preview */}
          {isCommand && (
            <div className="p-2 space-y-2">
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-900 font-mono text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
                  <span>$</span>
                  <span className="text-zinc-200">{rawCommand}</span>
                </div>
                {state.output && (
                  <pre className="text-zinc-300 text-[10px] whitespace-pre-wrap overflow-x-auto max-h-40 leading-normal pt-1 border-t border-zinc-900/60">
                    {typeof state.output === 'string'
                      ? state.output
                      : JSON.stringify(state.output, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Generic tool inputs and outputs */}
          {!isFileTool && !isCommand && (
            <div className="p-2.5 space-y-1.5">
              {state.input && (
                <div>
                  <span className="text-zinc-500 font-semibold text-[10px]">Input:</span>
                  <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-zinc-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {typeof state.input === 'string' ? state.input : JSON.stringify(state.input, null, 2)}
                  </pre>
                </div>
              )}
              {state.output && (
                <div>
                  <span className="text-zinc-500 font-semibold text-[10px]">Output:</span>
                  <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-emerald-400/90 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Status footer inside drawer */}
          <div className="px-3 py-1.5 border-t border-zinc-900/60 flex items-center justify-between text-[10px] text-zinc-500">
            <span>Status: {status}</span>
            {state.output && typeof state.output === 'string' && isFileTool && (
              <span className="text-emerald-400/80">{state.output}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
