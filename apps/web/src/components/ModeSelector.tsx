import React from 'react';
import { Zap, Brain } from 'lucide-react';
import type { SessionInteractionMode } from '@opencode-remote/protocol';

interface ModeSelectorProps {
  mode: SessionInteractionMode;
  onChange: (mode: SessionInteractionMode) => void;
  compact?: boolean;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  mode,
  onChange,
  compact = false,
}) => {
  return (
    <div
      className="flex items-center p-0.5 rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-inner select-none"
      title={
        mode === 'build'
          ? 'Build Mode: OpenCode implements code, runs tests, and applies diffs'
          : 'Plan Mode: OpenCode explores architecture and creates plans without modifying source code'
      }
    >
      <button
        type="button"
        onClick={() => onChange('build')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
          mode === 'build'
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        {!compact && <span>Build</span>}
      </button>

      <button
        type="button"
        onClick={() => onChange('plan')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
          mode === 'plan'
            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Brain className="w-3.5 h-3.5 text-purple-400" />
        {!compact && <span>Plan</span>}
      </button>
    </div>
  );
};
