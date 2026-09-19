import { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';

interface ReasoningViewProps {
  reasoning: string;
  duration?: number;
  isStreaming?: boolean;
}

export function ReasoningView({ reasoning, duration, isStreaming }: ReasoningViewProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning) return null;

  const durationText = duration
    ? `${(duration / 1000).toFixed(1)}s`
    : isStreaming
    ? 'thinking...'
    : '';

  return (
    <div className="my-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden text-xs">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3 py-2 flex items-center justify-between text-zinc-400 hover:text-zinc-200 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className={`w-3.5 h-3.5 text-indigo-400 shrink-0 ${isStreaming ? 'animate-pulse' : ''}`} />
          <span className="font-mono text-[11px] font-medium text-zinc-300">
            {isStreaming
              ? 'Thinking...'
              : durationText
              ? `Worked for ${durationText}`
              : 'Thought Process'}
          </span>
        </div>
        <ChevronRight
          className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="px-3.5 pb-3 pt-1 text-[11px] font-mono text-zinc-400 leading-relaxed border-t border-zinc-800/50 whitespace-pre-wrap max-h-60 overflow-y-auto bg-black/20">
          {reasoning}
        </div>
      )}
    </div>
  );
}
