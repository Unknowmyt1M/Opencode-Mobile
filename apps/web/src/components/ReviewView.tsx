import React, { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Copy,
  Check,
  FileCode,
  CheckCircle2,
  WrapText,
} from 'lucide-react';
import type { SnapshotFileDiff } from '@opencode-remote/protocol';

interface ReviewViewProps {
  diffs: SnapshotFileDiff[];
  activeFile: string | null;
  onSelectFile: (file: string) => void;
  onRefresh: () => void;
}

interface FileNode {
  type: 'file';
  name: string;
  path: string;
  diff: SnapshotFileDiff;
}

interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: (FolderNode | FileNode)[];
  additions: number;
  deletions: number;
  filesCount: number;
}

function getExtBadge(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { label: 'TS', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'js':
    case 'jsx':
    case 'mjs':
      return { label: 'JS', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    case 'json':
      return { label: 'JSON', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    case 'css':
    case 'scss':
      return { label: 'CSS', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
    case 'md':
      return { label: 'MD', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
    case 'py':
      return { label: 'PY', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    default:
      return { label: ext.slice(0, 3).toUpperCase() || 'FILE', color: 'bg-slate-800 text-slate-400 border-slate-700' };
  }
}

function getFileStatus(diff: SnapshotFileDiff): { label: string; bg: string; text: string } {
  const s = (diff.status || '').toLowerCase();
  if (s === 'added' || (diff.deletions === 0 && diff.additions > 0)) {
    return { label: 'A', bg: 'bg-emerald-950/70 border-emerald-700/60', text: 'text-emerald-400' };
  }
  if (s === 'deleted' || (diff.additions === 0 && diff.deletions > 0)) {
    return { label: 'D', bg: 'bg-rose-950/70 border-rose-700/60', text: 'text-rose-400' };
  }
  if (s === 'renamed') {
    return { label: 'R', bg: 'bg-purple-950/70 border-purple-700/60', text: 'text-purple-400' };
  }
  return { label: 'M', bg: 'bg-amber-950/70 border-amber-700/60', text: 'text-amber-400' };
}

function buildFileTree(diffs: SnapshotFileDiff[]): FolderNode {
  const root: FolderNode = {
    type: 'folder',
    name: 'root',
    path: '',
    children: [],
    additions: 0,
    deletions: 0,
    filesCount: 0,
  };

  for (const diff of diffs) {
    const parts = diff.file.replace(/\\/g, '/').split('/');
    let currentFolder = root;
    currentFolder.additions += diff.additions;
    currentFolder.deletions += diff.deletions;
    currentFolder.filesCount += 1;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join('/');
      let childFolder = currentFolder.children.find(
        (c): c is FolderNode => c.type === 'folder' && c.name === folderName
      );
      if (!childFolder) {
        childFolder = {
          type: 'folder',
          name: folderName,
          path: folderPath,
          children: [],
          additions: 0,
          deletions: 0,
          filesCount: 0,
        };
        currentFolder.children.push(childFolder);
      }
      childFolder.additions += diff.additions;
      childFolder.deletions += diff.deletions;
      childFolder.filesCount += 1;
      currentFolder = childFolder;
    }

    const fileName = parts[parts.length - 1];
    currentFolder.children.push({
      type: 'file',
      name: fileName,
      path: diff.file,
      diff,
    });
  }

  const sortTree = (folder: FolderNode) => {
    folder.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of folder.children) {
      if (child.type === 'folder') sortTree(child);
    }
  };
  sortTree(root);
  return root;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  diffs,
  activeFile,
  onSelectFile,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [copiedPatch, setCopiedPatch] = useState(false);
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // Expand top folders by default
    const set = new Set<string>();
    for (const d of diffs) {
      const parts = d.file.replace(/\\/g, '/').split('/');
      if (parts.length > 1) {
        set.add(parts[0]);
        if (parts.length > 2) {
          set.add(`${parts[0]}/${parts[1]}`);
        }
      }
    }
    return set;
  });

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const filteredDiffs = useMemo(() => {
    if (!searchQuery.trim()) return diffs;
    const q = searchQuery.toLowerCase();
    return diffs.filter((d) => d.file.toLowerCase().includes(q));
  }, [diffs, searchQuery]);

  const tree = useMemo(() => buildFileTree(filteredDiffs), [filteredDiffs]);

  const selectedDiff = useMemo(() => {
    if (activeFile) {
      const found = diffs.find((d) => d.file === activeFile);
      if (found) return found;
    }
    return filteredDiffs[0] || null;
  }, [diffs, activeFile, filteredDiffs]);

  const totalAdditions = useMemo(() => diffs.reduce((acc, d) => acc + d.additions, 0), [diffs]);
  const totalDeletions = useMemo(() => diffs.reduce((acc, d) => acc + d.deletions, 0), [diffs]);

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    setCopiedFile(filePath);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleCopyPatch = (patchText: string) => {
    navigator.clipboard.writeText(patchText);
    setCopiedPatch(true);
    setTimeout(() => setCopiedPatch(false), 2000);
  };

  // Parse patch with line numbers
  const parsedDiffLines = useMemo(() => {
    if (!selectedDiff?.patch) return [];
    const lines = selectedDiff.patch.split('\n');
    let oldLineNum = 1;
    let newLineNum = 1;

    return lines.map((line) => {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNum = parseInt(match[1], 10);
          newLineNum = parseInt(match[2], 10);
        }
        return {
          type: 'hunk' as const,
          oldNum: null,
          newNum: null,
          text: line,
        };
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const cur = newLineNum++;
        return {
          type: 'add' as const,
          oldNum: null,
          newNum: cur,
          text: line.slice(1),
        };
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        const cur = oldLineNum++;
        return {
          type: 'del' as const,
          oldNum: cur,
          newNum: null,
          text: line.slice(1),
        };
      }
      const curOld = oldLineNum++;
      const curNew = newLineNum++;
      return {
        type: 'context' as const,
        oldNum: curOld,
        newNum: curNew,
        text: line.startsWith(' ') ? line.slice(1) : line,
      };
    });
  }, [selectedDiff]);

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: FolderNode | FileNode, depth = 0) => {
    if (node.type === 'folder') {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path || node.name} className="select-none">
          <div
            onClick={() => toggleFolder(node.path)}
            style={{ paddingLeft: `${depth * 12 + 10}px` }}
            className="flex items-center justify-between py-1.5 pr-2.5 rounded-lg hover:bg-slate-900/70 text-slate-300 hover:text-white cursor-pointer transition-colors text-xs font-mono group"
          >
            <div className="flex items-center gap-1.5 min-w-0 pr-1">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-indigo-400/80 shrink-0" />
              )}
              <span className="truncate font-semibold text-slate-200">{node.name}/</span>
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
              {node.additions > 0 && <span className="text-emerald-400 font-mono">+{node.additions}</span>}
              {node.deletions > 0 && <span className="text-rose-400 font-mono">-{node.deletions}</span>}
            </div>
          </div>

          {isExpanded && (
            <div>
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // File Node
    const isSelected = selectedDiff?.file === node.path;
    const ext = getExtBadge(node.name);
    const status = getFileStatus(node.diff);

    return (
      <div
        key={node.path}
        onClick={() => onSelectFile(node.path)}
        style={{ paddingLeft: `${depth * 12 + 18}px` }}
        className={`flex items-center justify-between py-1.5 pr-2.5 rounded-lg cursor-pointer transition-all text-xs font-mono group my-0.5 ${
          isSelected
            ? 'bg-indigo-950/60 border-l-2 border-indigo-500 text-white font-medium shadow-xs'
            : 'text-slate-300 hover:bg-slate-900/60 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className={`px-1 py-0.2 rounded text-[9px] font-bold border uppercase shrink-0 ${ext.color}`}>
            {ext.label}
          </span>
          <span className="truncate text-slate-200 group-hover:text-white">{node.name}</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] shrink-0">
          <span className={`px-1 rounded text-[9px] font-bold border ${status.bg} ${status.text}`}>
            {status.label}
          </span>
          {node.diff.additions > 0 && <span className="text-emerald-400">+{node.diff.additions}</span>}
          {node.diff.deletions > 0 && <span className="text-rose-400">-{node.diff.deletions}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans">
      {/* Search and Summary Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-white tracking-tight">Git Changes</span>
            <div className="flex items-center gap-1 text-[11px] font-mono">
              <span className="text-emerald-400 font-semibold">+{totalAdditions}</span>
              <span className="text-slate-600">/</span>
              <span className="text-rose-400 font-semibold">-{totalDeletions}</span>
              <span className="text-slate-500 text-[10px] ml-1">({diffs.length} files)</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            title="Refresh changes"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filter files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>
      </div>

      {/* Main Area: Split Tree & Diff */}
      {diffs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 shadow-inner">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-300">Clean working tree</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
              No uncommitted edits or file modifications detected in current OpenCode workspace.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Review Tree Sidebar */}
          <div className="w-full md:w-64 lg:w-72 border-b md:border-b-0 md:border-r border-slate-800 overflow-y-auto max-h-56 md:max-h-full shrink-0 bg-slate-950/40 p-2 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-800">
            {tree.children.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs font-mono">No matching files</div>
            ) : (
              tree.children.map((child) => renderTreeNode(child))
            )}
          </div>

          {/* Diff Viewer Area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[#090d16]">
            {selectedDiff ? (
              <>
                {/* Diff Header */}
                <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 text-xs shrink-0 select-none">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="font-mono text-slate-200 font-medium truncate text-xs">
                      {selectedDiff.file}
                    </span>
                    <div className="flex items-center gap-1 font-mono text-[11px] shrink-0 ml-1">
                      {selectedDiff.additions > 0 && (
                        <span className="text-emerald-400 font-bold">+{selectedDiff.additions}</span>
                      )}
                      {selectedDiff.deletions > 0 && (
                        <span className="text-rose-400 font-bold">-{selectedDiff.deletions}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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

                    <button
                      type="button"
                      onClick={() => handleCopyPath(selectedDiff.file)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-[10px] font-mono cursor-pointer"
                      title="Copy file path"
                    >
                      {copiedFile === selectedDiff.file ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Path Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Path</span>
                        </>
                      )}
                    </button>

                    {selectedDiff.patch && (
                      <button
                        type="button"
                        onClick={() => handleCopyPatch(selectedDiff.patch!)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-[10px] font-mono cursor-pointer"
                        title="Copy unified diff patch"
                      >
                        {copiedPatch ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Patch Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Patch</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Diff Body Lines with Gutter Line Numbers */}
                <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-5 select-text scrollbar-thin scrollbar-thumb-slate-800">
                  {parsedDiffLines.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      Binary file or empty patch payload
                    </div>
                  ) : (
                    <div className={wrapText ? 'w-full' : 'min-w-fit'}>
                      {parsedDiffLines.map((line, idx) => {
                        if (line.type === 'hunk') {
                          return (
                            <div
                              key={idx}
                              className="py-1 px-3 my-1 rounded bg-indigo-950/30 text-indigo-400 border border-indigo-900/50 text-[10px] font-bold"
                            >
                              {line.text}
                            </div>
                          );
                        }

                        const isAdd = line.type === 'add';
                        const isDel = line.type === 'del';

                        let rowBg = 'hover:bg-slate-900/30 text-slate-300';
                        if (isAdd) rowBg = 'bg-emerald-950/35 text-emerald-200 border-l-2 border-emerald-500';
                        if (isDel) rowBg = 'bg-rose-950/35 text-rose-200 border-l-2 border-rose-500';

                        return (
                          <div key={idx} className={`flex items-start ${rowBg}`}>
                            {/* Gutter: Old Line */}
                            <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px] font-mono">
                              {line.oldNum ?? ''}
                            </span>
                            {/* Gutter: New Line */}
                            <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 text-[10px] font-mono">
                              {line.newNum ?? ''}
                            </span>
                            {/* Marker */}
                            <span className="w-4 shrink-0 select-none text-center font-bold text-[10px]">
                              {isAdd ? '+' : isDel ? '-' : ' '}
                            </span>
                            {/* Content */}
                            <span className={`flex-1 font-mono pr-4 ${wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                              {line.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs font-mono">
                Select a file from the review tree to view changes
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
