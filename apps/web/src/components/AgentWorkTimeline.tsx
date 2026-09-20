import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Atom,
  FileCode,
  Terminal,
  Search,
  Compass,
  FilePlus2,
  FileX2,
  FileEdit,
  ExternalLink,
} from 'lucide-react';
import { formatDuration, type TurnGroup, type ActivityItem } from '../utils/activityNormalizer';
import { MarkdownView } from './MarkdownView';
import { FileTypeIcon } from './FileTypeIcon';

interface AgentWorkTimelineProps {
  turn: TurnGroup;
  defaultExpanded?: boolean;
  onSelectDiffFile?: (file: string) => void;
}

function getActivityIcon(item: ActivityItem) {
  switch (item.type) {
    case 'thought':
      return <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    case 'analyze':
      return <Atom className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    case 'edit':
      return <FileEdit className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'create':
      return <FilePlus2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'delete':
      return <FileX2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    case 'command':
      return <Terminal className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    case 'search':
      return <Search className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    case 'explore':
      return <Compass className="w-3.5 h-3.5 text-teal-400 shrink-0" />;
    default:
      return <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  }
}

export const AgentWorkTimeline: React.FC<AgentWorkTimelineProps> = ({
  turn,
  defaultExpanded = true,
  onSelectDiffFile,
}) => {
  const { agentRun } = turn;
  const [isRunExpanded, setIsRunExpanded] = useState(defaultExpanded || agentRun.isStreaming);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());

  if (!agentRun.hasActiveWork && !agentRun.isStreaming) {
    return null;
  }

  const toggleItem = (id: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="my-2.5 font-sans select-none">
      {/* Level 1: Overall Run Header */}
      <div
        onClick={() => setIsRunExpanded((prev) => !prev)}
        className="inline-flex items-center gap-1.5 py-1 px-1 text-xs font-mono text-slate-300 hover:text-white cursor-pointer transition-colors group"
      >
        {agentRun.isStreaming ? (
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping mr-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
        )}

        <span className="font-semibold text-slate-200 group-hover:text-white tracking-tight">
          {agentRun.durationLabel}
        </span>

        {isRunExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-transform shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-transform shrink-0" />
        )}
      </div>

      {/* Level 2: Chronological Activities List */}
      {isRunExpanded && (
        <div className="mt-1.5 ml-1.5 pl-3 border-l border-slate-800/80 space-y-1">
          {agentRun.activities.map((item) => {
            const isItemExpanded = expandedItemIds.has(item.id);
            const hasDetails = Boolean(item.content || item.output || item.command);

            if (item.type === 'thought') {
              const thoughtLabel = `Thought for ${formatDuration(item.durationSeconds || 1)}`;
              return (
                <div key={item.id} className="transition-colors">
                  <div
                    onClick={() => hasDetails && toggleItem(item.id)}
                    className="flex items-center justify-between py-1 px-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer hover:bg-slate-900/60 group"
                  >
                    <span className="text-slate-400 group-hover:text-slate-200 font-medium">
                      {thoughtLabel}
                    </span>
                    <div className="flex items-center">
                      {isItemExpanded ? (
                        <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-white transition-transform" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-transform" />
                      )}
                    </div>
                  </div>
                  {isItemExpanded && item.content && (
                    <div className="mt-1 ml-3 mb-2 p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] leading-relaxed text-slate-300 max-h-56 overflow-y-auto">
                      <MarkdownView content={item.content} />
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={item.id} className="transition-colors">
                {/* Row */}
                <div
                  onClick={() => hasDetails && toggleItem(item.id)}
                  className={`flex items-center justify-between py-1 px-1.5 rounded-lg text-xs font-mono transition-colors ${
                    hasDetails ? 'cursor-pointer hover:bg-slate-900/60 group' : ''
                  }`}
                >
                  {/* Left part: Verb + Icon + Target + LineRange/Path */}
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    {/* Semantic Verb */}
                    <span
                      className={`font-medium shrink-0 ${
                        item.type === 'create'
                          ? 'text-emerald-400'
                          : item.type === 'delete'
                          ? 'text-rose-400'
                          : item.type === 'edit'
                          ? 'text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {item.verb}
                    </span>

                    {/* File Type Icon if path/target is a file, else action icon */}
                    {item.path || (item.type !== 'command' && item.target && !item.target.includes(' ')) ? (
                      <FileTypeIcon path={item.path || item.target || ''} size={14} className="shrink-0" />
                    ) : (
                      getActivityIcon(item)
                    )}

                    {/* Target (filename or command) */}
                    {item.target && (
                      <span className="truncate text-slate-200 group-hover:text-white max-w-[200px] sm:max-w-[340px]">
                        {item.target}
                      </span>
                    )}

                    {/* Line Range or Path hint */}
                    {item.lineRange && (
                      <span className="text-[11px] text-slate-500 shrink-0 font-mono">
                        {item.lineRange}
                      </span>
                    )}
                  </div>

                  {/* Right part: Diff stats or Duration or Chevron */}
                  <div className="flex items-center gap-2 shrink-0 ml-2 text-[11px] font-mono">
                    {/* Diff additions/deletions */}
                    {(item.type === 'edit' || item.type === 'create' || item.type === 'delete') && (
                      <div className="flex items-center gap-1.5">
                        {typeof item.additions === 'number' && item.additions > 0 && (
                          <span className="text-emerald-400 font-semibold">+{item.additions}</span>
                        )}
                        {typeof item.deletions === 'number' && item.deletions > 0 && (
                          <span className="text-rose-400 font-semibold">-{item.deletions}</span>
                        )}
                      </div>
                    )}

                    {/* Chevron if expandable */}
                    {hasDetails && (
                      <div>
                        {isItemExpanded ? (
                          <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-white transition-transform" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-transform" />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Level 2 Detail Drawer */}
                {isItemExpanded && (
                  <div className="mt-1 ml-5 mb-2 transition-all">

                    {/* Command Output */}
                    {item.type === 'command' && (item.command || item.output) && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] leading-relaxed text-slate-300 select-text overflow-x-auto shadow-inner">
                        {item.command && (
                          <div className="text-indigo-400 font-semibold mb-1 select-all">
                            $ {item.command}
                          </div>
                        )}
                        {item.output && (
                          <pre className="text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {item.output}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Edit / Create Diff */}
                    {(item.type === 'edit' || item.type === 'create') && item.path && (
                      <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-2.5 font-mono text-[11px] space-y-1.5 shadow-inner">
                        <div className="flex items-center justify-between text-slate-400 text-[10px]">
                          <div className="flex items-center gap-1.5 min-w-0 pr-2">
                            <FileTypeIcon path={item.path} size={13} className="shrink-0" />
                            <span className="truncate">{item.path}</span>
                          </div>
                          {onSelectDiffFile && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectDiffFile(item.path!);
                              }}
                              className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                            >
                              <span>View in Review</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {item.content && (
                          <pre className="text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto bg-[#070a11] p-2 rounded-lg text-[10px] leading-4 border border-slate-900 select-text">
                            {item.content}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
