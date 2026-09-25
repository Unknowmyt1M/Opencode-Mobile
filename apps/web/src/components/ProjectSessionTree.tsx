import { useState, useMemo, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  ChevronsUpDown,
} from 'lucide-react';
import type { OpenCodeProject, OpenCodeSession } from '@opencode-remote/protocol';

interface ProjectSessionTreeProps {
  projects: OpenCodeProject[];
  sessions: OpenCodeSession[];
  activeSessionId?: string;
  loadingSessionId?: string | null;
  sessionStatuses?: Record<string, string>;
  onSelectSession: (session: OpenCodeSession) => void;
  onCreateSession: (title?: string, directory?: string, projectId?: string) => void;
}

function normalizePath(p?: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isSessionInProject(session: OpenCodeSession, project: OpenCodeProject): boolean {
  if (!session.directory || !project.worktree) {
    return Boolean(session.projectId && project.id && session.projectId === project.id && project.id !== 'global');
  }
  const sDir = normalizePath(session.directory);
  const pDir = normalizePath(project.worktree);
  const isSandbox = (project.sandboxes || []).some((sb) => normalizePath(sb) === sDir);
  return sDir === pDir || isSandbox;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo`;
}

export function ProjectSessionTree({
  projects,
  sessions,
  activeSessionId,
  loadingSessionId,
  sessionStatuses = {},
  onSelectSession,
  onCreateSession,
}: ProjectSessionTreeProps) {
  // Map projects to their sessions
  const { projectGroups, unassignedSessions } = useMemo(() => {
    // Separate specific projects from the synthetic global project
    const specificProjects = projects.filter(
      (p) => p.id !== 'global' && p.worktree !== '/'
    );
    const globalProject = projects.find(
      (p) => p.id === 'global' || p.worktree === '/'
    );

    const map = new Map<string, OpenCodeSession[]>();
    for (const proj of projects) {
      map.set(proj.id, []);
    }
    const unassigned: OpenCodeSession[] = [];

    for (const sess of sessions) {
      // Filter out subagents so they don't pollute the sidebar project/session tree.
      // Subagents are displayed in the rich Timeline tab instead.
      if (sess.parentID || (sess.title && /(@[\w-]+\s+subagent|\bsubagent\b)/i.test(sess.title))) {
        continue;
      }

      const sDir = normalizePath(sess.directory);
      const sProjId = sess.projectId;
      let matched = false;

      // 1. Directory-first exact match against specific projects (matching OpenCode Desktop)
      if (sDir) {
        for (const proj of specificProjects) {
          if (isSessionInProject(sess, proj)) {
            map.get(proj.id)!.push(sess);
            matched = true;
            break;
          }
        }
      }

      // 2. Exact projectId match against specific projects ONLY if directory was not provided
      if (!matched && !sDir && sProjId && sProjId !== 'global') {
        for (const proj of specificProjects) {
          if (proj.id === sProjId) {
            map.get(proj.id)!.push(sess);
            matched = true;
            break;
          }
        }
      }

      // 3. Fallback to synthetic global project (if exists)
      if (!matched && globalProject) {
        map.get(globalProject.id)!.push(sess);
        matched = true;
      }

      if (!matched) {
        unassigned.push(sess);
      }
    }

    // Sort sessions in each project by updatedAt / createdAt descending
    for (const sessList of map.values()) {
      sessList.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    }
    unassigned.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    // Helper to get latest session timestamp in project
    const getLatestTimestamp = (pId: string) => {
      const list = map.get(pId) || [];
      return list.length > 0 ? (list[0].updatedAt || list[0].createdAt || 0) : 0;
    };

    // Sort projects:
    // 1. Specific projects with sessions (sorted by latest activity)
    // 2. Global project (if has sessions)
    // 3. Projects without sessions (alphabetical)
    const sortedProjects = [...projects].sort((a, b) => {
      const aCount = map.get(a.id)?.length || 0;
      const bCount = map.get(b.id)?.length || 0;
      const aIsGlobal = a.id === 'global' || a.worktree === '/';
      const bIsGlobal = b.id === 'global' || b.worktree === '/';

      if (aCount > 0 && bCount === 0) return -1;
      if (aCount === 0 && bCount > 0) return 1;

      if (aCount > 0 && bCount > 0) {
        if (aIsGlobal && !bIsGlobal) return 1;
        if (!aIsGlobal && bIsGlobal) return -1;
        return getLatestTimestamp(b.id) - getLatestTimestamp(a.id);
      }

      const aName = a.name || a.worktree || '';
      const bName = b.name || b.worktree || '';
      return aName.localeCompare(bName);
    });

    return {
      projectGroups: sortedProjects.map((p) => ({
        project: p,
        sessions: map.get(p.id) || [],
      })),
      unassignedSessions: unassigned,
    };
  }, [projects, sessions]);

  // Collapsible state (expanded by default for projects that have sessions)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    // Auto-expand projects that have sessions
    for (const g of projectGroups) {
      if (g.sessions.length > 0) {
        initial.add(g.project.id);
      }
    }
    if (unassignedSessions.length > 0) {
      initial.add('unassigned');
    }
    return initial;
  });

  // Ensure active session's project is always auto-expanded
  useEffect(() => {
    if (!activeSessionId) return;
    for (const g of projectGroups) {
      if (g.sessions.some((s) => s.id === activeSessionId)) {
        setExpandedIds((prev) => {
          if (prev.has(g.project.id)) return prev;
          const next = new Set(prev);
          next.add(g.project.id);
          return next;
        });
        break;
      }
    }
  }, [activeSessionId, projectGroups]);

  const toggleProject = (projectId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedIds.size > 0) {
      setExpandedIds(new Set());
    } else {
      const all = new Set(projectGroups.map((g) => g.project.id));
      if (unassignedSessions.length > 0) all.add('unassigned');
      setExpandedIds(all);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">
      {/* Top Action: + New Conversation */}
      <div className="p-2 pb-1">
        <button
          type="button"
          onClick={() => {
            // Find currently active project or first project with sessions or default
            const activeGroup = projectGroups.find((g) =>
              g.sessions.some((s) => s.id === activeSessionId)
            );
            const targetProj = activeGroup?.project || projectGroups[0]?.project;
            onCreateSession('New Session', targetProj?.worktree, targetProj?.id);
          }}
          className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 hover:text-white font-medium flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-98"
        >
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Projects Section Header */}
      <div className="flex items-center justify-between px-3 py-1.5 text-slate-400 font-semibold tracking-wider text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-300">
          <span>Projects</span>
          <span className="text-[10px] font-mono text-slate-400">
            ({projectGroups.length})
          </span>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title={expandedIds.size > 0 ? 'Collapse All' : 'Expand All'}
        >
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Projects & Sessions Tree */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 select-none no-scrollbar">
        {projectGroups.length === 0 && sessions.length === 0 ? (
          <div className="p-4 text-center text-slate-400 text-xs">
            No projects or sessions found
          </div>
        ) : (
          projectGroups.map(({ project, sessions: pSessions }) => {
            const isExpanded = expandedIds.has(project.id);
            const hasSessions = pSessions.length > 0;
            const hasActiveSession = pSessions.some((s) => s.id === activeSessionId);

            return (
              <div key={project.id} className="space-y-0.5">
                {/* Project Header Row */}
                <div
                  onClick={() => toggleProject(project.id)}
                  className={`flex items-center justify-between p-1.5 rounded-lg group cursor-pointer transition-colors ${
                    hasActiveSession
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                  title={project.worktree}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-1 flex-1">
                    <span className="text-slate-400 group-hover:text-slate-300 shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </span>
                    <span className="shrink-0 text-slate-400 group-hover:text-indigo-400 transition-colors">
                      {isExpanded && hasSessions ? (
                        <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                      ) : (
                        <Folder className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className="truncate font-medium text-xs">
                      {project.id === 'global' || project.worktree === '/'
                        ? project.name || 'Global Sessions'
                        : project.name ||
                          project.worktree?.split(/[\\/]/).filter(Boolean).pop() ||
                          'Project'}
                    </span>
                  </div>

                  {/* Right side: quick + new session button or count */}
                  <div className="flex items-center gap-1 shrink-0">
                    {hasSessions && (
                      <span className="text-[10px] font-mono text-slate-400 px-1">
                        {pSessions.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateSession('New Session', project.worktree, project.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-opacity cursor-pointer"
                      title={`Create session in ${
                        project.id === 'global' || project.worktree === '/'
                          ? 'Global Sessions'
                          : project.name ||
                            project.worktree?.split(/[\\/]/).filter(Boolean).pop() ||
                            'Project'
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Indented Sessions List */}
                {isExpanded && (
                  <div className="ml-3 pl-2.5 border-l border-slate-800/80 space-y-0.5 my-0.5">
                    {pSessions.length === 0 ? (
                      <div
                        onClick={() => onCreateSession('New Session', project.worktree, project.id)}
                        className="py-1 px-2 text-[11px] text-slate-400 hover:text-indigo-300 hover:bg-slate-900/40 rounded-md cursor-pointer transition-colors flex items-center gap-1.5"
                      >
                        <Plus className="w-3 h-3 text-slate-400" />
                        <span>Start new session...</span>
                      </div>
                    ) : (
                      pSessions.map((sess) => {
                        const isActive = sess.id === activeSessionId;
                        const isLoading = sess.id === loadingSessionId;
                        const isBusy = sessionStatuses[sess.id] === 'busy';
                        const timeStr = formatRelativeTime(sess.updatedAt || sess.createdAt);

                        return (
                          <button
                            key={sess.id}
                            type="button"
                            disabled={isLoading}
                            onClick={() => onSelectSession(sess)}
                            className={`w-full text-left py-1.5 px-2 rounded-lg text-xs transition-all flex items-center justify-between group cursor-pointer ${
                              isActive
                                ? 'bg-slate-800 text-white font-medium shadow-xs'
                                : isLoading
                                ? 'bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 cursor-wait'
                                : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 pr-2">
                              {isLoading ? (
                                <Loader2 className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />
                              ) : isBusy ? (
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                              ) : null}
                              <span className="truncate">
                                {sess.title || 'Untitled Session'}
                              </span>
                            </div>

                            {/* Relative Timestamp (e.g. 3m, 5d, 7d) */}
                            {timeStr && !isLoading && (
                              <span
                                className={`text-[10px] font-mono shrink-0 ml-1 ${
                                  isActive ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-400'
                                }`}
                              >
                                {timeStr}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Unassigned / Other Sessions Group */}
        {unassignedSessions.length > 0 && (
          <div className="space-y-0.5 pt-1 border-t border-slate-900">
            <div
              onClick={() => toggleProject('unassigned')}
              className="flex items-center justify-between p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-400">
                  {expandedIds.has('unassigned') ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </span>
                <Folder className="w-3.5 h-3.5 text-slate-400" />
                <span className="truncate font-medium text-xs">Other Sessions</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 px-1">
                {unassignedSessions.length}
              </span>
            </div>

            {expandedIds.has('unassigned') && (
              <div className="ml-3 pl-2.5 border-l border-slate-800/80 space-y-0.5 my-0.5">
                {unassignedSessions.map((sess) => {
                  const isActive = sess.id === activeSessionId;
                  const isLoading = sess.id === loadingSessionId;
                  const isBusy = sessionStatuses[sess.id] === 'busy';
                  const timeStr = formatRelativeTime(sess.updatedAt || sess.createdAt);

                  return (
                    <button
                      key={sess.id}
                      type="button"
                      disabled={isLoading}
                      onClick={() => onSelectSession(sess)}
                      className={`w-full text-left py-1.5 px-2 rounded-lg text-xs transition-all flex items-center justify-between group cursor-pointer ${
                        isActive
                          ? 'bg-slate-800 text-white font-medium shadow-xs'
                          : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 pr-2">
                        {isLoading ? (
                          <Loader2 className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />
                        ) : isBusy ? (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        ) : null}
                        <span className="truncate">{sess.title || 'Untitled Session'}</span>
                      </div>
                      {timeStr && (
                        <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">
                          {timeStr}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
