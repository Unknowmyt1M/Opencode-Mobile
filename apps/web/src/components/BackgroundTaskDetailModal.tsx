import { useState } from 'react';
import {
  X,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Clock,
  Hash,
} from 'lucide-react';
import type { TimelineBackgroundTask } from '../utils/timelineSelectors';

interface BackgroundTaskDetailModalProps {
  task: TimelineBackgroundTask | null;
  onClose: () => void;
}

export function BackgroundTaskDetailModal({
  task,
  onClose,
}: BackgroundTaskDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!task) return null;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(task.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const formattedDate = new Date(task.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Background Task Details"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            {task.status === 'running' ? (
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" aria-label="Running" />
            ) : task.status === 'error' ? (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" aria-label="Error" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-label="Completed" />
            )}
            <h3 className="font-semibold text-sm text-slate-200 truncate">
              Background Task Details
            </h3>
            <span
              className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-medium ${
                task.status === 'running'
                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30'
                  : task.status === 'error'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {task.status}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Metadata Grid */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 font-mono text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>Started:</span>
              <span className="text-slate-200">{formattedDate}</span>
            </div>
            {task.duration && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>Duration:</span>
                <span className="text-slate-200">{task.duration}</span>
              </div>
            )}
            {task.exitCode !== undefined && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Hash className="w-3 h-3 text-slate-500" />
                <span>Exit Code:</span>
                <span
                  className={
                    task.exitCode === 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                  }
                >
                  {task.exitCode}
                </span>
              </div>
            )}
          </div>

          {/* Command Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Command</span>
              </div>
              <button
                type="button"
                onClick={handleCopyCommand}
                className="flex items-center gap-1 py-0.5 px-2 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-200 overflow-x-auto whitespace-pre-wrap select-text">
              {task.command || 'No command specified'}
            </div>
          </div>

          {/* Output Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
              <span>Output</span>
              {task.output && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {task.output.length} characters
                </span>
              )}
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-300 max-h-72 overflow-y-auto whitespace-pre-wrap select-text no-scrollbar">
              {task.output ? (
                task.output
              ) : task.status === 'running' ? (
                <div className="flex items-center gap-2 text-slate-500 italic">
                  <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                  <span>Task is currently running... output will stream in.</span>
                </div>
              ) : (
                <span className="text-slate-600 italic">No output recorded</span>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
