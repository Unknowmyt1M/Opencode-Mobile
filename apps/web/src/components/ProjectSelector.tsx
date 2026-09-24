import { useState, useMemo } from 'react';
import {
  FolderGit2,
  Globe,
  ChevronDown,
  Check,
  Search,
  HardDrive,
  GitBranch,
} from 'lucide-react';
import type { OpenCodeProject } from '@opencode-remote/protocol';

interface ProjectSelectorProps {
  projects: OpenCodeProject[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  className?: string;
}

export function ProjectSelector({
  projects,
  selectedProjectId,
  onSelectProject,
  className = '',
}: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const activeProject = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'all') return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.worktree && p.worktree.toLowerCase().includes(q))
    );
  }, [projects, searchQuery]);

  return (
    <div className={`relative ${className}`}>
      {/* Active Selection Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex items-center justify-between text-left group cursor-pointer shadow-xs"
        title="Switch PC Project / Workspace"
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0 group-hover:scale-105 transition-transform">
            {activeProject ? (
              <FolderGit2 className="w-4 h-4" />
            ) : (
              <Globe className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white truncate">
                {activeProject ? activeProject.name || 'Project' : 'All PC Projects'}
              </span>
              {activeProject?.vcs && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-indigo-300 font-mono">
                  {activeProject.vcs}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
              {activeProject
                ? activeProject.worktree || 'Custom Worktree'
                : `${projects.length} Workspaces on PC`}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform shrink-0 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl bg-[#0d121f] border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col max-h-[380px] animate-in fade-in zoom-in-95 duration-100">
            {/* Header & Search */}
            <div className="p-2.5 border-b border-slate-800/80 bg-slate-950/60 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  OpenCode Workspaces
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {projects.length} detected
                </span>
              </div>

              {projects.length > 4 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search projects by name or path..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans"
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* List */}
            <div className="overflow-y-auto p-1.5 space-y-1 divide-y divide-slate-800/40">
              {/* Option 1: All Projects (Global) */}
              <button
                type="button"
                onClick={() => {
                  onSelectProject(null);
                  setIsOpen(false);
                }}
                className={`w-full p-2 rounded-xl text-left flex items-center justify-between group transition-colors cursor-pointer ${
                  !activeProject
                    ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-slate-800/80 flex items-center justify-center text-indigo-400 shrink-0">
                    <Globe className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                      <span>All Projects (PC-Wide)</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                        Global
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">
                      Mirror sessions across all drives & repositories
                    </p>
                  </div>
                </div>
                {!activeProject && <Check className="w-4 h-4 text-indigo-400 shrink-0 ml-2" />}
              </button>

              {/* Individual Projects */}
              <div className="pt-1 space-y-1">
                {filteredProjects.length === 0 ? (
                  <div className="p-3 text-center text-slate-500 text-xs">
                    No matching workspace found
                  </div>
                ) : (
                  filteredProjects.map((proj) => {
                    const isSelected = activeProject?.id === proj.id;
                    const drive = proj.worktree ? proj.worktree.slice(0, 2).toUpperCase() : null;

                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => {
                          onSelectProject(proj.id);
                          setIsOpen(false);
                        }}
                        className={`w-full p-2 rounded-xl text-left flex items-center justify-between group transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 shrink-0">
                            {drive ? (
                              <span className="text-[10px] font-mono font-bold text-slate-400">
                                {drive}
                              </span>
                            ) : (
                              <HardDrive className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-white truncate">
                                {proj.name || 'Project'}
                              </span>
                              {proj.vcs && (
                                <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-mono flex items-center gap-0.5">
                                  <GitBranch className="w-2.5 h-2.5" />
                                  {proj.vcs}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5" title={proj.worktree}>
                              {proj.worktree || 'No path specified'}
                            </p>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
