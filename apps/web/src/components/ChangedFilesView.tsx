import { FileCode, Plus, Minus, ArrowRight, FileCheck } from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface ChangedFilesViewProps {
  diffs: SnapshotFileDiff[];
  onSelectFile: (file: string) => void;
}

export function ChangedFilesView({ diffs, onSelectFile }: ChangedFilesViewProps) {
  const totalAdditions = diffs.reduce((sum, d) => sum + (d.additions || 0), 0);
  const totalDeletions = diffs.reduce((sum, d) => sum + (d.deletions || 0), 0);

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'added':
        return (
          <span className="w-5 h-5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-bold flex items-center justify-center">
            A
          </span>
        );
      case 'deleted':
        return (
          <span className="w-5 h-5 rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/20 text-[10px] font-mono font-bold flex items-center justify-center">
            D
          </span>
        );
      case 'renamed':
        return (
          <span className="w-5 h-5 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/20 text-[10px] font-mono font-bold flex items-center justify-center">
            R
          </span>
        );
      case 'modified':
      default:
        return (
          <span className="w-5 h-5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20 text-[10px] font-mono font-bold flex items-center justify-center">
            M
          </span>
        );
    }
  };

  if (diffs.length === 0) {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
          <FileCheck className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-zinc-300">Clean Session Working Tree</h4>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
            No files modified by OpenCode in this session yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Header */}
      <div className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-zinc-200">
            {diffs.length} {diffs.length === 1 ? 'file changed' : 'files changed'}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-emerald-400 flex items-center">
            <Plus className="w-3 h-3 inline" />
            {totalAdditions}
          </span>
          <span className="text-rose-400 flex items-center">
            <Minus className="w-3 h-3 inline" />
            {totalDeletions}
          </span>
        </div>
      </div>

      {/* File List */}
      <div className="space-y-1.5">
        {diffs.map((diff) => {
          const parts = diff.file.split('/');
          const filename = parts.pop() || diff.file;
          const dir = parts.join('/');

          return (
            <div
              key={diff.file}
              onClick={() => onSelectFile(diff.file)}
              className="p-3 rounded-xl bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700/80 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {getStatusBadge(diff.status)}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                    {filename}
                  </p>
                  {dir && (
                    <p className="text-[10px] text-zinc-500 font-mono truncate">{dir}/</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  {diff.additions > 0 && (
                    <span className="text-emerald-400">+{diff.additions}</span>
                  )}
                  {diff.deletions > 0 && (
                    <span className="text-rose-400">-{diff.deletions}</span>
                  )}
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
