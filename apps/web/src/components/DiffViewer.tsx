import { GitCommit, FileText } from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface DiffViewerProps {
  diffs: SnapshotFileDiff[];
  activeFile?: string | null;
  onSelectFile: (file: string) => void;
}

export function DiffViewer({ diffs, activeFile, onSelectFile }: DiffViewerProps) {
  const currentDiff = diffs.find((d) => d.file === activeFile) || diffs[0];

  if (diffs.length === 0 || !currentDiff) {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
          <GitCommit className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-zinc-300">No Diffs Available</h4>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
            OpenCode hasn't created any code changes in this session yet.
          </p>
        </div>
      </div>
    );
  }

  const patchLines = currentDiff.patch ? currentDiff.patch.split('\n') : [];

  return (
    <div className="space-y-3">
      {/* File Selector Chips if multiple files */}
      {diffs.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {diffs.map((d) => {
            const name = d.file.split('/').pop() || d.file;
            const isSelected = d.file === currentDiff.file;
            return (
              <button
                key={d.file}
                onClick={() => onSelectFile(d.file)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono shrink-0 transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Diff Card */}
      <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800/80 overflow-hidden shadow-lg">
        {/* Diff Card Header */}
        <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs font-mono text-zinc-200 truncate">{currentDiff.file}</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
            <span className="text-emerald-400">+{currentDiff.additions}</span>
            <span className="text-rose-400">-{currentDiff.deletions}</span>
          </div>
        </div>

        {/* Diff Content */}
        <div className="p-3 bg-zinc-950 overflow-x-auto text-[11px] font-mono leading-5">
          {patchLines.length === 0 ? (
            <div className="py-6 text-center text-zinc-500 text-xs">
              Empty patch or binary content
            </div>
          ) : (
            patchLines.map((line, idx) => {
              if (line.startsWith('@@')) {
                return (
                  <div
                    key={idx}
                    className="text-indigo-400/90 bg-indigo-950/30 px-2 py-0.5 rounded my-1 border-l-2 border-indigo-500 font-semibold text-[10px]"
                  >
                    {line}
                  </div>
                );
              }
              if (line.startsWith('+') && !line.startsWith('+++')) {
                return (
                  <div
                    key={idx}
                    className="bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 px-2 -mx-1"
                  >
                    {line}
                  </div>
                );
              }
              if (line.startsWith('-') && !line.startsWith('---')) {
                return (
                  <div
                    key={idx}
                    className="bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 px-2 -mx-1"
                  >
                    {line}
                  </div>
                );
              }
              return (
                <div key={idx} className="text-zinc-400 px-2">
                  {line || ' '}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
