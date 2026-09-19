import { Brain, Terminal, FileCode, CheckCircle2, Clock, Activity } from 'lucide-react';
import type { SessionMessage } from '@opencode-remote/protocol';

interface AgentActivityViewProps {
  messages: SessionMessage[];
  isStreaming: boolean;
}

interface ActivityItem {
  id: string;
  type: 'thinking' | 'tool' | 'patch' | 'message';
  title: string;
  detail?: string;
  status?: string;
  duration?: number;
  timestamp: number;
}

export function AgentActivityView({ messages, isStreaming }: AgentActivityViewProps) {
  const activities: ActivityItem[] = [];

  for (const msg of messages) {
    if (msg.parts && msg.parts.length > 0) {
      for (const part of msg.parts) {
        if (part.type === 'reasoning') {
          activities.push({
            id: part.id || `reasoning_${activities.length}`,
            type: 'thinking',
            title: 'Model Reasoning',
            detail: part.text?.slice(0, 140) ? `${part.text.slice(0, 140)}...` : undefined,
            duration: part.duration,
            timestamp: msg.createdAt,
          });
        } else if (part.type === 'tool') {
          const status = part.state?.status || 'completed';
          let detail = '';
          if (part.state?.input) {
            detail = typeof part.state.input === 'string'
              ? part.state.input
              : (part.state.input as any).command || JSON.stringify(part.state.input);
          }
          activities.push({
            id: part.callID || part.id || `tool_${activities.length}`,
            type: 'tool',
            title: `Tool: ${part.tool || 'command'}`,
            detail: detail.slice(0, 140),
            status,
            timestamp: msg.createdAt,
          });
        } else if (part.type === 'patch') {
          activities.push({
            id: part.hash || `patch_${activities.length}`,
            type: 'patch',
            title: 'Workspace Patch Applied',
            detail: part.files ? part.files.join(', ') : undefined,
            timestamp: msg.createdAt,
          });
        }
      }
    } else if (msg.role === 'assistant') {
      activities.push({
        id: msg.id,
        type: 'message',
        title: 'Assistant Response',
        detail: msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : ''),
        timestamp: msg.createdAt,
      });
    }
  }

  if (activities.length === 0 && !isStreaming) {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
          <Activity className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-zinc-300">No Activity Logged</h4>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
            Agent reasoning steps, tool calls, and workspace edits will appear in this timeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isStreaming && (
        <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center gap-2.5 animate-pulse">
          <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs text-indigo-300 font-medium">Agent actively reasoning & executing...</span>
        </div>
      )}

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
        {activities.map((item) => {
          let Icon = Activity;
          let iconColor = 'text-zinc-400';
          let dotBg = 'bg-zinc-800 border-zinc-700';

          if (item.type === 'thinking') {
            Icon = Brain;
            iconColor = 'text-indigo-400';
            dotBg = 'bg-indigo-950 border-indigo-800';
          } else if (item.type === 'tool') {
            Icon = Terminal;
            iconColor = 'text-amber-400';
            dotBg = 'bg-amber-950 border-amber-800';
          } else if (item.type === 'patch') {
            Icon = FileCode;
            iconColor = 'text-emerald-400';
            dotBg = 'bg-emerald-950 border-emerald-800';
          } else if (item.type === 'message') {
            Icon = CheckCircle2;
            iconColor = 'text-sky-400';
            dotBg = 'bg-sky-950 border-sky-800';
          }

          return (
            <div key={item.id} className="relative group">
              {/* Timeline marker */}
              <div
                className={`absolute -left-6 top-1 w-5 h-5 rounded-full border flex items-center justify-center ${dotBg} shadow-sm`}
              >
                <Icon className={`w-3 h-3 ${iconColor}`} />
              </div>

              {/* Card */}
              <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/70 hover:border-zinc-700 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-200">{item.title}</span>
                  {item.duration && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {(item.duration / 1000).toFixed(1)}s
                    </span>
                  )}
                  {item.status && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded capitalize ${
                        item.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : item.status === 'error'
                          ? 'bg-rose-500/10 text-rose-400'
                          : 'bg-amber-500/10 text-amber-400 animate-pulse'
                      }`}
                    >
                      {item.status}
                    </span>
                  )}
                </div>

                {item.detail && (
                  <p className="mt-1 text-[11px] font-mono text-zinc-400 line-clamp-2 leading-relaxed">
                    {item.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
