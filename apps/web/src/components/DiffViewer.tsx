import React, { useMemo, useState } from 'react';
import { GitCommit, FileText, Copy, Check, WrapText } from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface DiffViewerProps {
  diffs: SnapshotFileDiff[];
  activeFile?: string | null;
  onSelectFile: (file: string) => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffs,
  activeFile,
  onSelectFile,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [wrapText, setWrapText] = useState<boolean>(() => {
    try {
      return localStorage.getItem('opencode_diff_wrap') === 'true';
    } catch {
      return false;
    }
  });

  const toggleWrapText = () => {
    setWrapText((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('opencode_diff_wrap', String(next));
      } catch {}
      return next;
    });
  };

  const currentDiff = diffs.find((d) => d.file === activeFile) || diffs[0];

  const handleCopyPatch = (patchText: string) => {
    navigator.clipboard.writeText(patchText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parsedLines = useMemo(() => {
    if (!currentDiff?.patch) return [];
    const lines = currentDiff.patch.split('\n');
    let oldLineNum = 1;
    let newLineNum = 1;

    return lines.map((line) => {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNum = parseInt(match[1], 10);
          newLineNum = parseInt(match[2], 10);
        }
        return { type: 'hunk' as const, oldNum: null, newNum: null, text: line };
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return { type: 'add' as const, oldNum: null, newNum: newLineNum++, text: line.slice(1) };
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return { type: 'del' as const, oldNum: oldLineNum++, newNum: null, text: line.slice(1) };
      }
      return {
        type: 'context' as const,
        oldNum: oldLineNum++,
        newNum: newLineNum++,
        text: line.startsWith(' ') ? line.slice(1) : line,
      };
    });
  }, [currentDiff]);

  if (diffs.length === 0 || !currentDiff) {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
          <GitCommit className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-300">No Diffs Available</h4>
          <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
            OpenCode hasn't created any code changes in this session yet.
          </p>
        </div>
      </div>
    );
  }

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
                type="button"
                onClick={() => onSelectFile(d.file)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Diff Card */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-lg">
        {/* Diff Card Header */}
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-mono text-slate-200 truncate">{currentDiff.file}</span>
          </div>
            <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
              <button
                type="button"
                onClick={toggleWrapText}
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 text-[10px] font-mono cursor-pointer border ${
                  wrapText
                    ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50 font-semibold'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-transparent'
                }`}
                title={wrapText ? 'Line wrapping enabled (tap to disable)' : 'Line wrapping disabled (tap to enable)'}
              >
                <WrapText className="w-3 h-3" />
                <span>{wrapText ? 'Wrap: On' : 'Wrap'}</span>
              </button>

              <div className="flex items-center gap-1.5 ml-1">
                <span className="text-emerald-400 font-bold">+{currentDiff.additions}</span>
                <span className="text-rose-400 font-bold">-{currentDiff.deletions}</span>
              </div>
              {currentDiff.patch && (
                <button
                  type="button"
                  onClick={() => handleCopyPatch(currentDiff.patch!)}
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Copy patch"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>

          {/* Diff Content with Line Numbers */}
          <div className="p-2 bg-[#090d16] overflow-x-auto text-[11px] font-mono leading-5 select-text">
            {parsedLines.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                Empty patch or binary content
              </div>
            ) : (
              <div className={wrapText ? 'w-full' : 'min-w-fit'}>
                {parsedLines.map((line, idx) => {
                  if (line.type === 'hunk') {
                    return (
                      <div
                        key={idx}
                        className="text-indigo-400 bg-indigo-950/30 px-2 py-0.5 rounded my-1 border-l-2 border-indigo-500 font-semibold text-[10px]"
                      >
                        {line.text}
                      </div>
                    );
                  }
                  const isAdd = line.type === 'add';
                  const isDel = line.type === 'del';
                  let rowBg = 'text-slate-400 hover:bg-slate-900/30';
                  if (isAdd) rowBg = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500';
                  if (isDel) rowBg = 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500';

                  return (
                    <div key={idx} className={`flex items-start ${rowBg}`}>
                      <span className="w-9 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px]">
                        {line.oldNum ?? ''}
                      </span>
                      <span className="w-9 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px]">
                        {line.newNum ?? ''}
                      </span>
                      <span className="w-4 shrink-0 select-none text-center font-bold text-[10px]">
                        {isAdd ? '+' : isDel ? '-' : ' '}
                      </span>
                      <span className={`flex-1 font-mono pr-2 ${wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                        {line.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>
    </div>
  );
};
