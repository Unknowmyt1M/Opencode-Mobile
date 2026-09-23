import React, { useState, useEffect, useRef } from 'react';
import { Search, FileCode, Folder, Hash, X, Check, Loader2 } from 'lucide-react';
import type { FsEntry, ContextMention } from '@opencode-remote/protocol';

interface ContextMentionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mention: ContextMention) => void;
  onFindFiles: (query: string) => Promise<FsEntry[]>;
}

export const ContextMentionModal: React.FC<ContextMentionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  onFindFiles,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FsEntry | null>(null);
  const [startLine, setStartLine] = useState<string>('');
  const [endLine, setEndLine] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedFile(null);
      setStartLine('');
      setEndLine('');
      setTimeout(() => inputRef.current?.focus(), 50);

      // Initial search of common files
      setLoading(true);
      onFindFiles('').then((entries) => {
        setResults(entries);
        setLoading(false);
      });
    }
  }, [isOpen, onFindFiles]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await onFindFiles(query);
      setResults(res);
      setLoading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, isOpen, onFindFiles]);

  if (!isOpen) return null;

  const handlePickFile = (file: FsEntry) => {
    if (file.type === 'directory') {
      onSelect({
        path: file.path,
        isFolder: true,
      });
      onClose();
      return;
    }
    setSelectedFile(file);
  };

  const handleConfirmMention = () => {
    if (!selectedFile) return;
    const s = parseInt(startLine, 10);
    const e = parseInt(endLine, 10);

    onSelect({
      path: selectedFile.path,
      lineStart: !isNaN(s) && s > 0 ? s : undefined,
      lineEnd: !isNaN(e) && e > 0 ? e : undefined,
      isFolder: false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-indigo-400 font-mono text-xs flex items-center justify-center font-bold">
              @
            </span>
            <h3 className="text-sm font-semibold text-zinc-100">
              {selectedFile ? 'Select Line Range' : 'Mention File or Folder'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!selectedFile ? (
          <>
            {/* Search Input */}
            <div className="p-3 border-b border-zinc-850">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus-within:border-indigo-500/50">
                <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search repository files (@src/App.tsx)..."
                  className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none"
                />
                {loading && <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />}
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-zinc-900/60 max-h-72">
              {results.length === 0 && !loading && (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No matching files found.
                </div>
              )}
              {results.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => handlePickFile(file)}
                  className="w-full px-3 py-2 rounded-lg flex items-center gap-2.5 text-left hover:bg-zinc-900/70 transition-colors group cursor-pointer text-xs"
                >
                  {file.type === 'directory' ? (
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-zinc-200 group-hover:text-white truncate block">
                      {file.path}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 uppercase font-mono">
                    {file.type}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          /* Line Range Selector */
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-mono text-xs text-zinc-200 truncate flex-1">
                {selectedFile.path}
              </span>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Change
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                Line Range (Optional)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-zinc-500 block mb-1">Start Line</label>
                  <input
                    type="number"
                    min="1"
                    value={startLine}
                    onChange={(e) => setStartLine(e.target.value)}
                    placeholder="e.g. 1"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 block mb-1">End Line</label>
                  <input
                    type="number"
                    min="1"
                    value={endLine}
                    onChange={(e) => setEndLine(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">
                Leave blank to reference the entire file.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="px-3 py-1.5 rounded-xl border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmMention}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Add Reference
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
