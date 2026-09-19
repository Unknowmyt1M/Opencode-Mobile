import React, { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  GitCommit,
  Bot,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface ReviewViewProps {
  diffs: SnapshotFileDiff[];
  activeFile: string | null;
  onSelectFile: (file: string) => void;
  onRefresh: () => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  diffs,
  activeFile,
  onSelectFile,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'git' | 'agent'>('all');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const filteredDiffs = useMemo(() => {
    return diffs.filter((d) => {
      const matchesSearch = !searchQuery || d.file.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (filterType === 'git') return d.status !== 'untracked';
      if (filterType === 'agent') return d.additions > 0 || d.deletions > 0;
      return true;
    });
  }, [diffs, searchQuery, filterType]);

  const selectedDiff = diffs.find((d) => d.file === activeFile) || filteredDiffs[0];

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    setCopiedFile(filePath);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const getExtBadge = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return { label: 'TS', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
      case 'js':
      case 'jsx':
        return { label: 'JS', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'json':
        return { label: 'JSON', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'css':
        return { label: 'CSS', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' };
      case 'md':
        return { label: 'MD', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      default:
        return { label: ext.slice(0, 3).toUpperCase() || 'FILE', color: 'bg-slate-700/50 text-slate-400 border-slate-600/50' };
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0f19] text-slate-200">
      {/* Search & Filter Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter changed files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh changes"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 text-[11px] ${
              filterType === 'all'
                ? 'bg-indigo-600 text-white font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Files ({diffs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('git')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 text-[11px] ${
              filterType === 'git'
                ? 'bg-indigo-600 text-white font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitCommit className="w-3 h-3" />
            Git Changes
          </button>
          <button
            type="button"
            onClick={() => setFilterType('agent')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 text-[11px] ${
              filterType === 'agent'
                ? 'bg-indigo-600 text-white font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-3 h-3" />
            Agent Edits
          </button>
        </div>
      </div>

      {/* Main Review Area */}
      {diffs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
          <div className="p-3.5 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-slate-400 mb-2">
            <Check className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="font-medium text-slate-300">Clean working tree</p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            No uncommitted edits or file modifications detected in current session.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* File list sidebar (compact on mobile, fixed width on desktop) */}
          <div className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-slate-800 overflow-y-auto max-h-48 md:max-h-full shrink-0 bg-slate-950/40">
            {filteredDiffs.map((d) => {
              const isSelected = selectedDiff?.file === d.file;
              const badge = getExtBadge(d.file);
              const fileName = d.file.split('/').pop() || d.file;
              const dirPath = d.file.includes('/') ? d.file.substring(0, d.file.lastIndexOf('/')) : '';

              return (
                <div
                  key={d.file}
                  onClick={() => onSelectFile(d.file)}
                  className={`flex items-center justify-between p-2.5 px-3 border-b border-slate-900 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-indigo-950/40 border-l-2 border-l-indigo-500 text-slate-100'
                      : 'hover:bg-slate-900/50 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${badge.color}`}>
                      {badge.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate text-slate-200">{fileName}</p>
                      {dirPath && <p className="text-[10px] text-slate-500 truncate">{dirPath}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
                    {d.additions > 0 && <span className="text-emerald-400">+{d.additions}</span>}
                    {d.deletions > 0 && <span className="text-rose-400">-{d.deletions}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Diff Content Viewer */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[#090d16]">
            {selectedDiff ? (
              <>
                {/* Diff File Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 border-b border-slate-800 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="font-mono text-slate-300 font-medium truncate">{selectedDiff.file}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPath(selectedDiff.file)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    {copiedFile === selectedDiff.file ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span className="text-[10px]">Copy Path</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Diff Body Lines */}
                <div className="flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed select-text">
                  {selectedDiff.patch ? (
                    selectedDiff.patch.split('\n').map((line, idx) => {
                      const isAdd = line.startsWith('+') && !line.startsWith('+++');
                      const isDel = line.startsWith('-') && !line.startsWith('---');
                      const isHunkHeader = line.startsWith('@@');

                      let rowClass = 'text-slate-400';
                      if (isAdd) rowClass = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 pl-2';
                      else if (isDel) rowClass = 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 pl-2';
                      else if (isHunkHeader) rowClass = 'text-indigo-400 bg-indigo-950/20 py-0.5 px-1 font-semibold';

                      return (
                        <div key={idx} className={`whitespace-pre py-0.5 ${rowClass}`}>
                          {line}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center text-slate-500 text-xs">
                      Binary or empty diff payload
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                Select a file to inspect diff
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
