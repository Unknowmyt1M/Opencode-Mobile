import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

export const SessionLoadingSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans select-none animate-in fade-in duration-200">
      {/* Skeleton Top Bar */}
      <header className="shrink-0 backdrop-blur-md bg-slate-900/90 border-b border-slate-800 px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-slate-800/80 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-36 rounded-md bg-slate-800/80 animate-pulse" />
              <div className="h-2.5 w-20 rounded-md bg-slate-800/50 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-mono text-indigo-300">
              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
              <span>Loading session</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Skeleton Conversation Area */}
      <main className="flex-1 min-h-0 overflow-hidden p-4">
        <div className="max-w-3xl mx-auto w-full space-y-5">
          {/* User Prompt Skeleton */}
          <div className="flex flex-col items-end w-full">
            <div className="w-64 max-w-[80%] h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/20 animate-pulse" />
          </div>

          {/* Assistant Response Skeleton */}
          <div className="w-full max-w-xl space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
              </div>
              <div className="h-3 w-32 rounded bg-slate-800 animate-pulse" />
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
              <div className="h-3 w-5/6 rounded bg-slate-800/80 animate-pulse" />
              <div className="h-3 w-4/6 rounded bg-slate-800/70 animate-pulse" />
              <div className="h-3 w-full rounded bg-slate-800/60 animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-slate-800/50 animate-pulse" />
            </div>
          </div>

          {/* Center Loading Status Badge */}
          <div className="flex items-center justify-center pt-8">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-400 font-mono shadow-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>Fetching conversation messages & diffs...</span>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Composer Skeleton Placeholder */}
      <footer className="p-3 border-t border-slate-800/80 bg-slate-950/60">
        <div className="max-w-3xl mx-auto w-full">
          <div className="h-11 rounded-2xl bg-slate-900/60 border border-slate-800/70 animate-pulse" />
        </div>
      </footer>
    </div>
  );
};
