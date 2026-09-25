import { useState, useMemo } from 'react';
import {
  Users,
  FileCode,
  UploadCloud,
  CheckSquare,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowUpRight,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import type {
  SessionMessage,
  SnapshotFileDiff,
  OpenCodeSession,
  PtySession,
} from '@opencode-remote/protocol';
import {
  selectSubagents,
  selectChangedFiles,
  selectUploads,
  selectBackgroundTasks,
  selectActiveTerminals,
  type TimelineUpload,
  type TimelineBackgroundTask,
} from '../utils/timelineSelectors';
import { FileTypeIcon } from './FileTypeIcon';
import { BackgroundTaskDetailModal } from './BackgroundTaskDetailModal';
import { UploadPreviewModal } from './UploadPreviewModal';

const COLLAPSED_LIMIT = 5;

interface AgentActivityTimelineProps {
  sessionId?: string;
  messages: SessionMessage[];
  allSessions?: OpenCodeSession[];
  diffs?: SnapshotFileDiff[];
  ptys?: PtySession[];
  sessionStatuses?: Record<string, string>;
  onSelectSubagent?: (subagentId: string, directory?: string) => void;
  onSelectDiffFile?: (file: string) => void;
  onSelectPty?: (ptyId: string) => void;
  className?: string;
}

export function AgentActivityTimeline({
  sessionId = '',
  messages = [],
  allSessions = [],
  diffs = [],
  ptys = [],
  sessionStatuses = {},
  onSelectSubagent,
  onSelectDiffFile,
  onSelectPty,
  className = '',
}: AgentActivityTimelineProps) {
  // Track "See all" expanded state for each of the 5 sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    subagents: false,
    files: false,
    uploads: false,
    tasks: false,
    terminals: false,
  });

  // Track accordion open/collapsed visibility for each section header
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({
    subagents: true,
    files: true,
    uploads: true,
    tasks: true,
    terminals: true,
  });

  // Modals state
  const [inspectTask, setInspectTask] = useState<TimelineBackgroundTask | null>(null);
  const [previewUpload, setPreviewUpload] = useState<TimelineUpload | null>(null);

  // 1. Authoritative Subagents
  const subagents = useMemo(
    () => selectSubagents(sessionId, messages, allSessions, sessionStatuses),
    [sessionId, messages, allSessions, sessionStatuses]
  );

  // 2. Authoritative Files Changed
  const changedFiles = useMemo(
    () => selectChangedFiles(sessionId, diffs),
    [sessionId, diffs]
  );

  // 3. Authoritative Uploads
  const uploads = useMemo(
    () => selectUploads(sessionId, messages),
    [sessionId, messages]
  );

  // 4. Authoritative Background Tasks
  const backgroundTasks = useMemo(
    () => selectBackgroundTasks(sessionId, messages),
    [sessionId, messages]
  );

  // 5. Authoritative Active Terminals
  const terminals = useMemo(
    () => selectActiveTerminals(sessionId, ptys),
    [sessionId, ptys]
  );

  const toggleSectionSeeAll = (sectionKey: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const toggleSectionOpen = (sectionKey: string) => {
    setSectionOpen((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  return (
    <div
      className={`h-full overflow-y-auto p-4 space-y-6 text-xs text-slate-200 select-none font-sans no-scrollbar ${className}`}
      data-testid="agent-activity-timeline"
    >
      {/* =========================================================================
          1. SUBAGENTS SECTION
          ========================================================================= */}
      <section className="space-y-2">
        <div
          onClick={() => toggleSectionOpen('subagents')}
          className="flex items-center justify-between py-1 px-1 cursor-pointer group text-slate-300 hover:text-white transition-colors"
          data-testid="timeline-section-subagents-header"
        >
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {sectionOpen.subagents ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-200 group-hover:text-white font-semibold">Subagents</span>
            <span className="text-[11px] font-mono text-slate-400">({subagents.length})</span>
          </div>
        </div>

        {sectionOpen.subagents && (
          <div className="space-y-1">
            {subagents.length === 0 ? (
              <div className="p-3 bg-slate-900/30 rounded-xl border border-slate-800/40 text-center text-slate-400 text-[11px] italic">
                No subagents in this session
              </div>
            ) : (
              <>
                {(expandedSections.subagents
                  ? subagents
                  : subagents.slice(0, COLLAPSED_LIMIT)
                ).map((sub) => {
                  const isBusy = sub.status === 'running';
                  const isError = sub.status === 'error';

                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => onSelectSubagent?.(sub.id, sub.directory)}
                      className="w-full text-left p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-700/80 transition-all flex items-center justify-between group cursor-pointer shadow-xs active:scale-[0.99]"
                      title="Click to view subagent conversation (read-only)"
                      data-testid={`subagent-row-${sub.id}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="w-6 h-6 rounded-lg bg-indigo-950/60 border border-indigo-500/20 flex items-center justify-center shrink-0">
                          <Users className="w-3.5 h-3.5 text-indigo-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-slate-200 truncate group-hover:text-white">
                              {sub.name}
                            </span>
                            {sub.subagentType && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                                @{sub.subagentType}
                              </span>
                            )}
                          </div>
                          {sub.duration && (
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                              {sub.duration}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" aria-label="Running" />
                        ) : isError ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" aria-label="Error" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400 transition-colors" aria-label="Completed" />
                        )}
                        <ArrowUpRight className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  );
                })}

                {subagents.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleSectionSeeAll('subagents')}
                    className="pt-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 flex items-center gap-1"
                    data-testid="see-all-subagents"
                  >
                    {expandedSections.subagents
                      ? 'See less'
                      : `See all (${subagents.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* =========================================================================
          2. FILES CHANGED SECTION
          ========================================================================= */}
      <section className="space-y-2">
        <div
          onClick={() => toggleSectionOpen('files')}
          className="flex items-center justify-between py-1 px-1 cursor-pointer group text-slate-300 hover:text-white transition-colors"
          data-testid="timeline-section-files-header"
        >
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {sectionOpen.files ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <FileCode className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-200 group-hover:text-white font-semibold">Files Changed</span>
            <span className="text-[11px] font-mono text-slate-400">({changedFiles.length})</span>
          </div>
        </div>

        {sectionOpen.files && (
          <div className="space-y-1">
            {changedFiles.length === 0 ? (
              <div className="p-3 bg-slate-900/30 rounded-xl border border-slate-800/40 text-center text-slate-400 text-[11px] italic">
                No files changed yet
              </div>
            ) : (
              <>
                {(expandedSections.files
                  ? changedFiles
                  : changedFiles.slice(0, COLLAPSED_LIMIT)
                ).map((file) => (
                  <button
                    key={file.file}
                    type="button"
                    onClick={() => onSelectDiffFile?.(file.file)}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-700/80 transition-all flex items-center justify-between group cursor-pointer shadow-xs active:scale-[0.99]"
                    title={`Review diff for ${file.file}`}
                    data-testid={`file-row-${file.file}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileTypeIcon path={file.file} className="w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-200 group-hover:text-white truncate">
                          {file.filename}
                        </div>
                        {file.dirPath && (
                          <div className="text-[10px] text-slate-400 truncate">
                            {file.dirPath}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono text-[11px] shrink-0">
                      {file.additions > 0 && (
                        <span className="text-emerald-400">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-rose-400">-{file.deletions}</span>
                      )}
                      {file.additions === 0 && file.deletions === 0 && (
                        <span className="text-slate-400 uppercase text-[10px]">{file.status[0]}</span>
                      )}
                      <ArrowUpRight className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
                    </div>
                  </button>
                ))}

                {changedFiles.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleSectionSeeAll('files')}
                    className="pt-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 flex items-center gap-1"
                    data-testid="see-all-files"
                  >
                    {expandedSections.files
                      ? 'See less'
                      : `See all (${changedFiles.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* =========================================================================
          3. UPLOADS SECTION
          ========================================================================= */}
      <section className="space-y-2">
        <div
          onClick={() => toggleSectionOpen('uploads')}
          className="flex items-center justify-between py-1 px-1 cursor-pointer group text-slate-300 hover:text-white transition-colors"
          data-testid="timeline-section-uploads-header"
        >
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {sectionOpen.uploads ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <UploadCloud className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-200 group-hover:text-white font-semibold">Uploads</span>
            <span className="text-[11px] font-mono text-slate-400">({uploads.length})</span>
          </div>
        </div>

        {sectionOpen.uploads && (
          <div className="space-y-1">
            {uploads.length === 0 ? (
              <div className="p-3 bg-slate-900/30 rounded-xl border border-slate-800/40 text-center text-slate-400 text-[11px] italic">
                No files uploaded
              </div>
            ) : (
              <>
                {(expandedSections.uploads
                  ? uploads
                  : uploads.slice(0, COLLAPSED_LIMIT)
                ).map((upload) => {
                  const isImg =
                    upload.mime?.startsWith('image/') ||
                    /\.(png|jpe?g|gif|webp|svg)$/i.test(upload.filename);

                  return (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() => setPreviewUpload(upload)}
                      className="w-full text-left p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-700/80 transition-all flex items-center justify-between group cursor-pointer shadow-xs active:scale-[0.99]"
                      title="Click to preview file"
                      data-testid={`upload-row-${upload.id}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="w-6 h-6 rounded-lg bg-cyan-950/60 border border-cyan-500/20 flex items-center justify-center shrink-0">
                          {isImg ? (
                            <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-cyan-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-slate-200 group-hover:text-white truncate">
                            {upload.filename}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                            <span>
                              {new Date(upload.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {upload.size && (
                              <>
                                <span>•</span>
                                <span>{upload.size}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })}

                {uploads.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleSectionSeeAll('uploads')}
                    className="pt-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 flex items-center gap-1"
                    data-testid="see-all-uploads"
                  >
                    {expandedSections.uploads
                      ? 'See less'
                      : `See all (${uploads.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* =========================================================================
          4. BACKGROUND TASKS SECTION
          ========================================================================= */}
      <section className="space-y-2">
        <div
          onClick={() => toggleSectionOpen('tasks')}
          className="flex items-center justify-between py-1 px-1 cursor-pointer group text-slate-300 hover:text-white transition-colors"
          data-testid="timeline-section-tasks-header"
        >
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {sectionOpen.tasks ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-200 group-hover:text-white font-semibold">Background Tasks</span>
            <span className="text-[11px] font-mono text-slate-400">({backgroundTasks.length})</span>
          </div>
        </div>

        {sectionOpen.tasks && (
          <div className="space-y-1">
            {backgroundTasks.length === 0 ? (
              <div className="p-3 bg-slate-900/30 rounded-xl border border-slate-800/40 text-center text-slate-400 text-[11px] italic">
                No background tasks
              </div>
            ) : (
              <>
                {(expandedSections.tasks
                  ? backgroundTasks
                  : backgroundTasks.slice(0, COLLAPSED_LIMIT)
                ).map((task) => {
                  const isBusy = task.status === 'running';
                  const isError = task.status === 'error';

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setInspectTask(task)}
                      className="w-full text-left p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-700/80 transition-all flex items-center justify-between group cursor-pointer shadow-xs active:scale-[0.99]"
                      title="Click to view command output and details"
                      data-testid={`task-row-${task.id}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="shrink-0">
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" aria-label="Running" />
                          ) : isError ? (
                            <XCircle className="w-4 h-4 text-rose-400" aria-label="Error" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" aria-label="Completed" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="font-mono text-xs text-slate-200 group-hover:text-white truncate">
                            {task.title}
                          </div>
                          {task.duration && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {task.duration}
                            </div>
                          )}
                        </div>
                      </div>

                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })}

                {backgroundTasks.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleSectionSeeAll('tasks')}
                    className="pt-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 flex items-center gap-1"
                    data-testid="see-all-tasks"
                  >
                    {expandedSections.tasks
                      ? 'See less'
                      : `See all (${backgroundTasks.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* =========================================================================
          5. TERMINALS SECTION
          ========================================================================= */}
      <section className="space-y-2">
        <div
          onClick={() => toggleSectionOpen('terminals')}
          className="flex items-center justify-between py-1 px-1 cursor-pointer group text-slate-300 hover:text-white transition-colors"
          data-testid="timeline-section-terminals-header"
        >
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {sectionOpen.terminals ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-200 group-hover:text-white font-semibold">Terminals</span>
            <span className="text-[11px] font-mono text-slate-400">({terminals.length})</span>
          </div>
        </div>

        {sectionOpen.terminals && (
          <div className="space-y-1">
            {terminals.length === 0 ? (
              <div className="p-3 bg-slate-900/30 rounded-xl border border-slate-800/40 text-center text-slate-400 text-[11px] italic">
                No active terminals
              </div>
            ) : (
              <>
                {(expandedSections.terminals
                  ? terminals
                  : terminals.slice(0, COLLAPSED_LIMIT)
                ).map((pty) => (
                  <button
                    key={pty.id}
                    type="button"
                    onClick={() => onSelectPty?.(pty.id)}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-700/80 transition-all flex items-center justify-between group cursor-pointer shadow-xs active:scale-[0.99]"
                    title="Click to focus this running terminal"
                    data-testid={`terminal-row-${pty.id}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div className="w-6 h-6 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-center shrink-0">
                        <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-200 group-hover:text-white truncate">
                          {pty.name}
                        </div>
                        {pty.directory && (
                          <div className="text-[10px] text-slate-400 truncate font-mono">
                            {pty.directory}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Active</span>
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}

                {terminals.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleSectionSeeAll('terminals')}
                    className="pt-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 flex items-center gap-1"
                    data-testid="see-all-terminals"
                  >
                    {expandedSections.terminals
                      ? 'See less'
                      : `See all (${terminals.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Modals */}
      <BackgroundTaskDetailModal
        task={inspectTask}
        onClose={() => setInspectTask(null)}
      />

      <UploadPreviewModal
        upload={previewUpload}
        onClose={() => setPreviewUpload(null)}
      />
    </div>
  );
}
