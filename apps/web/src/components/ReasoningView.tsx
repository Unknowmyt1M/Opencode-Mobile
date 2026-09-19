import React, { useState } from 'react';
import { ChevronRight, Sparkles, Brain } from 'lucide-react';

interface ReasoningViewProps {
  reasoning: string;
  duration?: number;
  isStreaming?: boolean;
}

export const ReasoningView: React.FC<ReasoningViewProps> = ({
  reasoning,
  duration,
  isStreaming,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning) return null;

  const durationText = duration
    ? `${(duration / 1000).toFixed(1)}s`
    : isStreaming
    ? 'thinking...'
    : '';

  return (
    <div className="my-2 rounded-xl border border-indigo-950/80 bg-slate-950/70 overflow-hidden text-xs transition-all shadow-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3 py-2 flex items-center justify-between text-slate-300 hover:text-white hover:bg-slate-900/60 transition-colors text-left select-none cursor-pointer"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-400 shrink-0">
            {isStreaming ? (
              <Sparkles className="w-3 h-3 animate-spin text-amber-400" />
            ) : (
              <Brain className="w-3 h-3 text-indigo-400" />
            )}
          </span>
          <span className="font-mono text-xs font-semibold text-slate-200 shrink-0">
            Thought Process
          </span>
          {durationText && (
            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
              {isStreaming ? 'In progress' : durationText}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 shrink-0 ml-auto">
          <span>{isOpen ? 'Hide' : 'Show'}</span>
          <ChevronRight
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="px-3.5 py-2.5 text-[11px] font-mono text-slate-300 leading-relaxed border-t border-indigo-950/80 bg-black/40 whitespace-pre-wrap max-h-72 overflow-y-auto select-text scrollbar-thin scrollbar-thumb-slate-800">
          {reasoning}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 ml-1 bg-indigo-400 animate-pulse align-middle" />
          )}
        </div>
      )}
    </div>
  );
};

