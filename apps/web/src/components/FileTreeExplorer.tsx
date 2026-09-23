import React, { useState, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AtSign,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import type { FsEntry, ContextMention } from '@opencode-remote/protocol';
import { FileTypeIcon } from './FileTypeIcon';

interface FileTreeExplorerProps {
  onListFs: (path?: string) => Promise<FsEntry[]>;
  onFindFs: (query: string) => Promise<FsEntry[]>;
  onReadFs: (path: string) => Promise<{ content: string; mime?: string } | null>;
  onAddMention?: (mention: ContextMention) => void;
}

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  onListFs,
  onFindFs,
  onReadFs,
  onAddMention,
}) => {
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderContents, setFolderContents] = useState<Map<string, FsEntry[]>>(new Map());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FsEntry[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load root directory entries
  const loadRoot = async () => {
    setIsRefreshing(true);
    const entries = await onListFs();
    setRootEntries(entries);
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadRoot();
  }, []);

  // Handle folder expansion
  const toggleFolder = async (folderPath: string) => {
    const next = new Set(expandedFolders);
    if (next.has(folderPath)) {
      next.delete(folderPath);
    } else {
      next.add(folderPath);
      if (!folderContents.has(folderPath)) {
        const subEntries = await onListFs(folderPath);
        setFolderContents((prev) => new Map(prev).set(folderPath, subEntries));
      }
    }
    setExpandedFolders(next);
  };

  // Handle file click
  const handleSelectFile = async (path: string) => {
    setSelectedFilePath(path);
    setIsLoadingFile(true);
    setFileContent(null);
    const res = await onReadFs(path);
    setFileContent(res?.content ?? 'Unable to display file content or file is empty.');
    setIsLoadingFile(false);
  };

  // Search files
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await onFindFs(searchQuery);
      setSearchResults(res);
      setIsSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, onFindFs]);

  const copyContent = () => {
    if (!fileContent) return;
    navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full min-h-0 bg-[#090d16] text-zinc-100 overflow-hidden">
      {/* Left/Top: File Tree Browser */}
      <div className="w-full md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-zinc-800/80 flex flex-col min-h-0 h-1/2 md:h-full">
        {/* Search & Actions Bar */}
        <div className="p-3 border-b border-zinc-800/80 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 focus-within:border-indigo-500/50">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none"
            />
            {isSearching && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />}
          </div>
          <button
            type="button"
            onClick={loadRoot}
            title="Refresh directory"
            className="p-1.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tree / Search Results List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5 text-xs font-mono">
          {searchResults ? (
            /* Flat search results view */
            <div>
              <div className="text-[11px] font-sans text-zinc-500 px-2 py-1 uppercase tracking-wider font-semibold">
                Search Results ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <div className="text-zinc-500 p-4 text-center">No files found</div>
              ) : (
                searchResults.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => handleSelectFile(entry.path)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left truncate cursor-pointer transition-colors ${
                      selectedFilePath === entry.path
                        ? 'bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/30'
                        : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-white'
                    }`}
                  >
                    <FileTypeIcon path={entry.path} />
                    <span className="truncate flex-1">{entry.path}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            /* Root hierarchical entries */
            rootEntries.map((entry) => {
              const isDir = entry.type === 'directory';
              const isExpanded = expandedFolders.has(entry.path);
              const subItems = folderContents.get(entry.path) || [];

              return (
                <div key={entry.path} className="flex flex-col">
                  <div
                    onClick={() => (isDir ? toggleFolder(entry.path) : handleSelectFile(entry.path))}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer select-none transition-colors ${
                      selectedFilePath === entry.path
                        ? 'bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/30'
                        : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-white'
                    }`}
                  >
                    {isDir ? (
                      <>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                      </>
                    ) : (
                      <>
                        <span className="w-3.5" />
                        <FileTypeIcon path={entry.path} />
                      </>
                    )}
                    <span className="truncate">{entry.path}</span>
                  </div>

                  {/* Sub entries */}
                  {isDir && isExpanded && (
                    <div className="pl-4 ml-1.5 border-l border-zinc-800 space-y-0.5 mt-0.5">
                      {subItems.length === 0 ? (
                        <div className="text-[11px] text-zinc-600 py-1 pl-2">Empty folder</div>
                      ) : (
                        subItems.map((sub) => {
                          const subIsDir = sub.type === 'directory';
                          const subIsExpanded = expandedFolders.has(sub.path);
                          return (
                            <div
                              key={sub.path}
                              onClick={() => (subIsDir ? toggleFolder(sub.path) : handleSelectFile(sub.path))}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer select-none transition-colors ${
                                selectedFilePath === sub.path
                                  ? 'bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/30'
                                  : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-white'
                              }`}
                            >
                              {subIsDir ? (
                                <>
                                  {subIsExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
                                  )}
                                  <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                </>
                              ) : (
                                <>
                                  <span className="w-3" />
                                  <FileTypeIcon path={sub.path} />
                                </>
                              )}
                              <span className="truncate">{sub.path.split(/[/\\]/).pop()}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right/Bottom: File Preview Pane */}
      <div className="flex-1 flex flex-col min-h-0 bg-zinc-950 overflow-hidden">
        {selectedFilePath ? (
          <>
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-zinc-850 flex items-center justify-between gap-3 bg-zinc-950/90 backdrop-blur-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileTypeIcon path={selectedFilePath} />
                <span className="font-mono text-xs text-zinc-200 truncate font-semibold">
                  {selectedFilePath}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onAddMention && (
                  <button
                    type="button"
                    onClick={() => onAddMention({ path: selectedFilePath })}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900 text-xs font-medium cursor-pointer shadow-sm"
                    title="Add file reference to Composer prompt"
                  >
                    <AtSign className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Mention</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={copyContent}
                  disabled={!fileContent}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 text-xs font-medium cursor-pointer"
                  title="Copy file content"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Content view with line numbers */}
            <div className="flex-1 min-h-0 overflow-auto p-4 font-mono text-xs bg-[#070a12] select-text">
              {isLoadingFile ? (
                <div className="flex items-center justify-center h-full text-zinc-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Loading file content...</span>
                </div>
              ) : fileContent !== null ? (
                <pre className="whitespace-pre overflow-x-auto text-zinc-300 leading-relaxed">
                  {fileContent}
                </pre>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 space-y-2">
            <FileCode className="w-8 h-8 text-zinc-600" />
            <p className="text-xs">Select a file from the repository tree to preview its content.</p>
          </div>
        )}
      </div>
    </div>
  );
};
