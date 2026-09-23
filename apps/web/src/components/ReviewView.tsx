import React, { useState, useMemo, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  CheckCircle2,
  WrapText,
  ChevronsUpDown,
  MessageSquarePlus,
} from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';
import { FileTypeIcon } from './FileTypeIcon';

interface ReviewViewProps {
  diffs: SnapshotFileDiff[];
  activeFile: string | null;
  onSelectFile: (file: string) => void;
  onRefresh: () => void;
  onCommentLine?: (file: string, lineNum: number, snippet: string) => void;
}

interface ParsedDiffLine {
  type: 'hunk' | 'add' | 'del' | 'context';
  oldNum: number | null;
  newNum: number | null;
  text: string;
}

function parsePatch(patch?: string): ParsedDiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  let oldLineNum = 1;
  let newLineNum = 1;

  return lines.map((line) => {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      return {
        type: 'hunk' as const,
        oldNum: null,
        newNum: null,
        text: line,
      };
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const cur = newLineNum++;
      return {
        type: 'add' as const,
        oldNum: null,
        newNum: cur,
        text: line.slice(1),
      };
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      const cur = oldLineNum++;
      return {
        type: 'del' as const,
        oldNum: cur,
        newNum: null,
        text: line.slice(1),
      };
    }
    const curOld = oldLineNum++;
    const curNew = newLineNum++;
    return {
      type: 'context' as const,
      oldNum: curOld,
      newNum: curNew,
      text: line.startsWith(' ') ? line.slice(1) : line,
    };
  });
}

function getFileIcon(filename: string) {
  return <FileTypeIcon path={filename} size={15} />;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  diffs,
  activeFile,
  onSelectFile,
  onRefresh,
  onCommentLine,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.resolve(onRefresh());
    } finally {
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };
  const [wrapText, setWrapText] = useState<boolean>(() => {
    try {
      return localStorage.getItem('opencode_diff_wrap') === 'true';
    } catch {
      return false;
    }
  });

  const toggleWrapText = () => {
    setWrapText((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('opencode_diff_wrap', String(next));
      } catch {}
      return next;
    });
  };

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activeFile) {
      initial.add(activeFile);
    } else if (diffs.length > 0) {
      initial.add(diffs[0].file);
    }
    return initial;
  });

  useEffect(() => {
    if (activeFile) {
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        next.add(activeFile);
        return next;
      });
    }
  }, [activeFile]);

  useEffect(() => {
    if (diffs.length > 0) {
      setExpandedFiles((prev) => {
        if (prev.size === 0) {
          const next = new Set<string>();
          next.add(diffs[0].file);
          return next;
        }
        return prev;
      });
    }
  }, [diffs]);

  const toggleFileExpanded = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
    onSelectFile(file);
  };

  const toggleAll = () => {
    if (expandedFiles.size > 0) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(diffs.map((d) => d.file)));
    }
  };

  const filteredDiffs = useMemo(() => {
    if (!searchQuery.trim()) return diffs;
    const q = searchQuery.toLowerCase();
    return diffs.filter((d) => d.file.toLowerCase().includes(q));
  }, [diffs, searchQuery]);

  const totalAdditions = useMemo(() => diffs.reduce((acc, d) => acc + d.additions, 0), [diffs]);
  const totalDeletions = useMemo(() => diffs.reduce((acc, d) => acc + d.deletions, 0), [diffs]);

  return (
    <div className="flex flex-col h-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans">
      {/* Search and Summary Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-white tracking-tight">Git Changes</span>
            <div className="flex items-center gap-1 text-[11px] font-mono">
              <span className="text-emerald-400 font-semibold">+{totalAdditions}</span>
              <span className="text-slate-600">/</span>
              <span className="text-rose-400 font-semibold">-{totalDeletions}</span>
              <span className="text-slate-500 text-[10px] ml-1">({diffs.length} files)</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleAll}
              title={expandedFiles.size > 0 ? 'Collapse all diffs' : 'Expand all diffs'}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh changes"
              className={`p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer ${
                isRefreshing ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filter files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>
      </div>

      {/* Main Area: Antigravity-style Accordion File List with Inline Diff */}
      {diffs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 shadow-inner">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-300">Clean working tree</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
              No uncommitted edits or file modifications detected in current OpenCode workspace.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 scrollbar-thin scrollbar-thumb-slate-800">
          {filteredDiffs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              No matching files found
            </div>
          ) : (
            filteredDiffs.map((diff) => {
              const parts = diff.file.replace(/\\/g, '/').split('/');
              const fileName = parts.pop() || diff.file;
              const dirPath = parts.join('/');
              const isExpanded = expandedFiles.has(diff.file);
              const parsedLines = parsePatch(diff.patch);

              return (
                <div key={diff.file} className="transition-colors">
                  {/* Accordion File Row */}
                  <div
                    onClick={() => toggleFileExpanded(diff.file)}
                    className={`flex items-center justify-between py-2 px-3 hover:bg-slate-900/60 cursor-pointer transition-colors select-none group ${
                      isExpanded ? 'bg-slate-900/40' : ''
                    }`}
                  >
                    {/* Left: Icon, Filename, Path */}
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        {getFileIcon(fileName)}
                      </div>
                      <span className="font-mono text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                        {fileName}
                      </span>
                      {dirPath && (
                        <span className="font-mono text-[11px] text-slate-500 truncate group-hover:text-slate-400">
                          {dirPath}
                        </span>
                      )}
                    </div>

                    {/* Right: +X -Y > */}
                    <div className="flex items-center gap-2 text-xs font-mono shrink-0 ml-2">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {diff.additions > 0 && (
                          <span className="text-emerald-400 font-semibold font-mono">
                            +{diff.additions}
                          </span>
                        )}
                        {diff.deletions > 0 && (
                          <span className="text-rose-400 font-semibold font-mono">
                            -{diff.deletions}
                          </span>
                        )}
                        {diff.additions === 0 && diff.deletions === 0 && (
                          <span className="text-slate-500 font-mono">+0 -0</span>
                        )}
                      </div>

                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-transform shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-transform shrink-0" />
                      )}
                    </div>
                  </div>

                  {/* Inline Diff Body (unfolds directly below the row) */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/80 bg-[#080b12] overflow-hidden">
                      {/* Diff Line Wrap Control Bar */}
                      <div className="flex items-center justify-between px-3 py-1 bg-slate-900/70 border-b border-slate-800/60 text-[10px] text-slate-400 font-mono">
                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <FileTypeIcon path={diff.file} size={13} className="shrink-0" />
                          <span className="truncate text-slate-400">{diff.file}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWrapText();
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer flex items-center gap-1 ${
                            wrapText
                              ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50 font-semibold'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-transparent'
                          }`}
                          title="Toggle line wrap"
                        >
                          <WrapText className="w-2.5 h-2.5" />
                          <span>Wrap: {wrapText ? 'On' : 'Off'}</span>
                        </button>
                      </div>

                      {/* Diff Lines Content */}
                      {parsedLines.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 text-xs font-mono">
                          No line diff available for this file
                        </div>
                      ) : (
                        <div className="p-2 font-mono text-[11px] leading-5 select-text overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800">
                          <div className="min-w-fit">
                            {parsedLines.map((line, idx) => {
                              if (line.type === 'hunk') {
                                return (
                                  <div
                                    key={idx}
                                    className="py-1 px-3 my-1 rounded bg-indigo-950/30 text-indigo-400 border border-indigo-900/50 text-[10px] font-bold"
                                  >
                                    {line.text}
                                  </div>
                                );
                              }

                              const isAdd = line.type === 'add';
                              const isDel = line.type === 'del';

                              const lineNum = line.newNum || line.oldNum || 1;
                              return (
                                <div
                                  key={idx}
                                  className={`group flex items-start relative ${
                                    isAdd
                                      ? 'bg-emerald-950/35 text-emerald-200 border-l-2 border-emerald-500'
                                      : isDel
                                      ? 'bg-rose-950/35 text-rose-200 border-l-2 border-rose-500'
                                      : 'hover:bg-slate-900/30 text-slate-300'
                                  }`}
                                >
                                  <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px] font-mono">
                                    {line.oldNum ?? ''}
                                  </span>
                                  <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px] font-mono">
                                    {line.newNum ?? ''}
                                  </span>
                                  {onCommentLine && (
                                    <button
                                      type="button"
                                      onClick={() => onCommentLine(diff.file, lineNum, line.text)}
                                      title={`Comment on line ${lineNum}`}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-indigo-400 hover:text-white hover:bg-indigo-600 transition-opacity cursor-pointer shrink-0 ml-0.5"
                                    >
                                      <MessageSquarePlus className="w-3 h-3" />
                                    </button>
                                  )}
                                  <span className="w-4 shrink-0 select-none text-center font-bold text-[10px]">
                                    {isAdd ? '+' : isDel ? '-' : ' '}
                                  </span>
                                  <span
                                    className={`flex-1 font-mono pr-4 ${
                                      wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                                    }`}
                                  >
                                    {line.text}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
