import React from 'react';
import { RotateCcw, AlertTriangle, X, Check, FileDiff } from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface SafeRevertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  diffs?: SnapshotFileDiff[];
  isReverting?: boolean;
}

export const SafeRevertModal: React.FC<SafeRevertModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  diffs = [],
  isReverting = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-850 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-400 flex items-center justify-center">
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">Safe Revert (Time Travel)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5 text-xs text-zinc-300">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-200/90 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">3-Phase Disk Rollback</span>
              Reverting will roll back code modifications made in the previous turn and restore your prompt back into the composer for easy editing.
            </div>
          </div>

          {diffs.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                <FileDiff className="w-3.5 h-3.5 text-indigo-400" />
                Affected Files ({diffs.length})
              </span>
              <div className="max-h-36 overflow-y-auto rounded-xl bg-zinc-900/80 border border-zinc-850 p-2 space-y-1 font-mono text-[11px]">
                {diffs.map((d) => (
                  <div key={d.file} className="flex items-center justify-between text-zinc-300 px-1.5 py-0.5">
                    <span className="truncate flex-1">{d.file}</span>
                    <span className="text-rose-400 text-[10px] shrink-0 ml-2">-{d.deletions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-zinc-850 flex items-center justify-end gap-2 bg-zinc-900/30">
          <button
            type="button"
            onClick={onClose}
            disabled={isReverting}
            className="px-3 py-1.5 rounded-xl border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isReverting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-amber-600/25 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isReverting ? 'Reverting...' : 'Confirm Rollback'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
