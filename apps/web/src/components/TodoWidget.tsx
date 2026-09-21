import React, { useState } from 'react';
import {
  CheckSquare2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
} from 'lucide-react';
import type { TodoItem } from '@opencode-remote/protocol';

interface TodoWidgetProps {
  todos: TodoItem[];
  defaultExpanded?: boolean;
}

export const TodoWidget: React.FC<TodoWidgetProps> = ({
  todos,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!todos || todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  const totalCount = todos.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="w-full mb-2 select-none">
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/90 backdrop-blur-md overflow-hidden shadow-lg shadow-black/20 transition-all">
        {/* Header Bar */}
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded-md bg-indigo-500/15 text-indigo-400 shrink-0">
              <CheckSquare2 className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2 truncate">
              <span className="text-xs font-semibold text-slate-200">
                Tasks
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {completedCount}/{totalCount} done
              </span>
              {inProgressCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>in progress</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 ml-2">
            {/* Progress bar mini */}
            <div className="w-14 sm:w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[10px] font-mono font-medium text-slate-400 w-7 text-right">
              {progressPercent}%
            </span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
          </div>
        </button>

        {/* Expandable Task List */}
        {isExpanded && (
          <div className="px-3 pb-2.5 pt-1 border-t border-slate-800/80 divide-y divide-slate-800/40 max-h-56 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
            {todos.map((todo, idx) => {
              const isDone = todo.status === 'completed';
              const isInProgress = todo.status === 'in_progress';
              const isCancelled = todo.status === 'cancelled';

              return (
                <div
                  key={idx}
                  className="py-1.5 flex items-start gap-2 text-xs transition-colors"
                >
                  <div className="pt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : isInProgress ? (
                      <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    ) : isCancelled ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pr-1">
                    <p
                      className={`leading-relaxed break-words ${
                        isDone
                          ? 'text-slate-400 line-through'
                          : isInProgress
                          ? 'text-slate-100 font-medium'
                          : 'text-slate-300'
                      }`}
                    >
                      {todo.content}
                    </p>
                  </div>

                  {todo.priority && (
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                        todo.priority === 'high'
                          ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                          : todo.priority === 'medium'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {todo.priority}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TodoWidget;
