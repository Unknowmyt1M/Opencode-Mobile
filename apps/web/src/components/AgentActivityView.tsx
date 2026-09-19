import React, { useState } from 'react';
import {
  Brain,
  Terminal,
  FileCode,
  CheckCircle2,
  Clock,
  Activity,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import type { SessionMessage } from '@opencode-remote/protocol';

interface AgentActivityViewProps {
  messages: SessionMessage[];
  isStreaming: boolean;
}

interface ActivityItem {
  id: string;
  type: 'thinking' | 'tool' | 'patch' | 'message' | 'error';
  title: string;
  detail?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  duration?: number;
  timestamp: number;
}

export const AgentActivityView: React.FC<AgentActivityViewProps> = ({
  messages,
  isStreaming,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const activities: ActivityItem[] = [];

  for (const msg of messages) {
    if (msg.parts && msg.parts.length > 0) {
      for (const part of msg.parts) {
        if (part.type === 'reasoning') {
          activities.push({
            id: part.id || `reasoning_${activities.length}`,
            type: 'thinking',
            title: 'Thought Process',
            detail: part.text,
            duration: part.duration,
            timestamp: msg.createdAt,
          });
        } else if (part.type === 'tool') {
          const status = part.state?.status || 'completed';
          let detail = '';
          if (part.state?.input) {
            detail =
              typeof part.state.input === 'string'
                ? part.state.input
                : (part.state.input as any).command ||
                  (part.state.input as any).filePath ||
                  JSON.stringify(part.state.input);
          }
          activities.push({
            id: part.callID || part.id || `tool_${activities.length}`,
            type: 'tool',
            title: `Tool: ${part.tool || 'command'}`,
            detail,
            input: part.state?.input,
            output: part.state?.output,
            status,
            timestamp: msg.createdAt,
          });
        } else if (part.type === 'patch') {
          activities.push({
            id: part.hash || `patch_${activities.length}`,
            type: 'patch',
            title: 'Workspace Patch Applied',
            detail: part.files ? part.files.join(', ') : undefined,
            output: part.files,
            timestamp: msg.createdAt,
          });
        }
      }
    } else if (msg.role === 'assistant') {
      activities.push({
        id: msg.id,
        type: 'message',
        title: 'Assistant Checkpoint',
        detail: msg.content.slice(0, 160) + (msg.content.length > 160 ? '...' : ''),
        output: msg.content,
        timestamp: msg.createdAt,
      });
    }
  }

  const formatTime = (ts: number) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  if (activities.length === 0 && !isStreaming) {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
          <Activity className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-300">No Activity Logged</h4>
          <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
            Agent reasoning steps, tool calls, and file modifications will appear in this timeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#090d16] text-slate-200">
      {/* Activity Header */}
      <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-white tracking-tight">Agent Execution Timeline</span>
          <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
            {activities.length} events
          </span>
        </div>

        {isStreaming && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-full animate-pulse">
            <Clock className="w-3 h-3" />
            <span>Active</span>
          </span>
        )}
      </div>

      {/* Timeline Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
        {isStreaming && (
          <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/30 flex items-center gap-2.5 animate-pulse text-xs text-indigo-300 font-medium">
            <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Agent actively reasoning & dispatching actions...</span>
          </div>
        )}

        <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
          {activities.map((item) => {
            let Icon = Activity;
            let iconColor = 'text-slate-400';
            let dotBg = 'bg-slate-900 border-slate-700';

            if (item.type === 'thinking') {
              Icon = Brain;
              iconColor = 'text-indigo-400';
              dotBg = 'bg-indigo-950 border-indigo-700';
            } else if (item.type === 'tool') {
              Icon = Terminal;
              iconColor = 'text-amber-400';
              dotBg = 'bg-amber-950 border-amber-700';
            } else if (item.type === 'patch') {
              Icon = FileCode;
              iconColor = 'text-emerald-400';
              dotBg = 'bg-emerald-950 border-emerald-700';
            } else if (item.type === 'message') {
              Icon = CheckCircle2;
              iconColor = 'text-sky-400';
              dotBg = 'bg-sky-950 border-sky-700';
            }

            const isExpanded = expandedId === item.id;
            const hasExtra = Boolean(item.input || item.output || (item.detail && item.detail.length > 80));

            return (
              <div key={item.id} className="relative group">
                {/* Timeline Node Marker */}
                <div
                  className={`absolute -left-6 top-1 w-5 h-5 rounded-full border flex items-center justify-center ${dotBg} shadow-xs z-10`}
                >
                  <Icon className={`w-3 h-3 ${iconColor}`} />
                </div>

                {/* Card Container */}
                <div
                  onClick={() => hasExtra && setExpandedId(isExpanded ? null : item.id)}
                  className={`p-3 rounded-xl bg-slate-900/70 border border-slate-800/90 hover:border-slate-700 transition-all ${
                    hasExtra ? 'cursor-pointer' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 pr-1">
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {item.title}
                      </span>
                      {item.status && (
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded border uppercase font-bold ${
                            item.status === 'completed'
                              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                              : item.status === 'running'
                              ? 'bg-amber-950/60 text-amber-400 border-amber-800 animate-pulse'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono shrink-0">
                      {item.duration && <span>{(item.duration / 1000).toFixed(1)}s</span>}
                      {item.timestamp && <span>{formatTime(item.timestamp)}</span>}
                      {hasExtra && (
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                      )}
                    </div>
                  </div>

                  {/* Summary preview */}
                  {item.detail && !isExpanded && (
                    <p className="text-[11px] font-mono text-slate-400 mt-1 truncate">
                      {item.detail}
                    </p>
                  )}

                  {/* Expanded detail box */}
                  {isExpanded && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-2 text-[11px] font-mono select-text">
                      {item.input !== undefined && (
                        <div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                            <span className="font-semibold uppercase tracking-wider">Input Parameter</span>
                            <button
                              type="button"
                              onClick={(e) =>
                                handleCopy(
                                  typeof item.input === 'string'
                                    ? item.input
                                    : JSON.stringify(item.input, null, 2),
                                  `${item.id}_in`,
                                  e
                                )
                              }
                              className="hover:text-slate-200 transition-colors flex items-center gap-1"
                            >
                              {copiedId === `${item.id}_in` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <pre className="p-2 rounded-lg bg-black/50 border border-slate-800 text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                            {typeof item.input === 'string'
                              ? item.input
                              : JSON.stringify(item.input, null, 2)}
                          </pre>
                        </div>
                      )}

                      {item.output !== undefined && (
                        <div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                            <span className="font-semibold uppercase tracking-wider">Execution Output</span>
                            <button
                              type="button"
                              onClick={(e) =>
                                handleCopy(
                                  typeof item.output === 'string'
                                    ? item.output
                                    : JSON.stringify(item.output, null, 2),
                                  `${item.id}_out`,
                                  e
                                )
                              }
                              className="hover:text-slate-200 transition-colors flex items-center gap-1"
                            >
                              {copiedId === `${item.id}_out` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <pre className="p-2 rounded-lg bg-black/50 border border-slate-800 text-emerald-300/90 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                            {typeof item.output === 'string'
                              ? item.output
                              : JSON.stringify(item.output, null, 2)}
                          </pre>
                        </div>
                      )}

                      {!item.input && !item.output && item.detail && (
                        <div className="p-2 rounded-lg bg-black/50 border border-slate-800 text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                          {item.detail}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
