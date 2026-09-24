import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Monitor,
  FolderGit2,
  Plus,
  MessageSquare,
  Terminal,
  FileCode,
  Sparkles,
  ChevronRight,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { DeviceInfo, OpenCodeSession, ProjectContext, OpenCodeProject } from '@opencode-remote/protocol';
import { ProjectSelector } from './ProjectSelector';

interface DashboardProps {
  device?: DeviceInfo;
  sessions: OpenCodeSession[];
  projects?: OpenCodeProject[];
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  projectContext?: ProjectContext | null;
  loadingSessionId?: string | null;
  onOpenSession: (sessionId: string, directory?: string) => void;
  onCreateSession: (title?: string, directory?: string) => void;
  onRefreshSessions: () => void;
  onPairSubmit?: (code: string) => Promise<{ success: boolean; message?: string }>;
}

export function Dashboard({
  device,
  sessions,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  projectContext,
  loadingSessionId,
  onOpenSession,
  onCreateSession,
  onRefreshSessions,
  onPairSubmit,
}: DashboardProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Inline pairing card state
  const [pairCode, setPairCode] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairFeedback, setPairFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairCode.trim() || !onPairSubmit || isPairing) return;
    setIsPairing(true);
    setPairFeedback(null);
    try {
      const res = await onPairSubmit(pairCode.trim());
      if (res.success) {
        setPairFeedback({ type: 'success', message: 'Successfully paired with this computer!' });
        setPairCode('');
      } else {
        setPairFeedback({ type: 'error', message: res.message || 'Invalid or expired code. Please check terminal.' });
      }
    } catch (err: any) {
      setPairFeedback({ type: 'error', message: err.message || 'Pairing failed. Try again.' });
    } finally {
      setIsPairing(false);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    // Auto-insert hyphen after 3 digits if user just typed
    const raw = val.replace(/-/g, '');
    if (raw.length > 3 && !val.includes('-')) {
      val = `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
    }
    setPairCode(val);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateSession(sessionTitle.trim() || undefined);
    setSessionTitle('');
    setShowNewModal(false);
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  if (!device) {
    return (
      <div className="p-8 rounded-3xl bg-zinc-900/40 border border-zinc-800/60 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-zinc-800/50 text-zinc-400 flex items-center justify-center mx-auto shadow-inner">
          <Monitor className="w-7 h-7 animate-pulse" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Waiting for Windows Agent...</h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
            Run the remote agent on your PC to connect this control surface.
          </p>
        </div>
        <div className="pt-2">
          <code className="text-[11px] px-3.5 py-2 rounded-xl bg-black/60 border border-zinc-800 text-indigo-300 font-mono inline-block">
            pnpm dev:agent
          </code>
        </div>
      </div>
    );
  }

  // Device is detected on network but THIS client browser is not yet paired
  if (!device.paired) {
    return (
      <div className="space-y-4">
        {/* Unpaired Notice Card */}
        <div className="p-5 rounded-3xl bg-gradient-to-b from-indigo-950/40 via-zinc-900/60 to-zinc-950 border border-indigo-500/30 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-sm shrink-0">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-zinc-100 truncate">
                  Pair with {device.deviceName}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-medium text-amber-300">
                  Pairing Required
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                OpenCode {device.opencodeStatus === 'connected' ? `v${device.opencodeVersion || '1.18'}` : 'ready'} • {device.os}
              </p>
            </div>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">
            Enter the 6-character one-time pairing code shown in your PC terminal to authorize this phone.
          </p>

          <form onSubmit={handlePairSubmit} className="space-y-3 pt-1">
            <div className="relative">
              <input
                type="text"
                value={pairCode}
                onChange={handleCodeChange}
                placeholder="123-456"
                maxLength={7}
                autoFocus
                className="w-full text-center text-lg tracking-widest font-mono font-bold bg-zinc-950 border-2 border-indigo-500/50 rounded-2xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400 shadow-inner"
              />
            </div>

            {pairFeedback && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                  pairFeedback.type === 'success'
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                }`}
              >
                {pairFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span className="font-medium">{pairFeedback.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!pairCode.trim() || isPairing}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
            >
              {isPairing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authorizing device...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Pair This Phone</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-zinc-800/60 text-center">
            <p className="text-[11px] text-zinc-500">
              Check your computer terminal where agent is running for the code.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Workspace Context Selector */}
      {projects.length > 0 && onSelectProject && (
        <ProjectSelector
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
        />
      )}

      {/* Workspace Context Card */}
      <div className="p-4 rounded-3xl bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 border border-zinc-800/80 shadow-xl space-y-3 relative overflow-hidden">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-zinc-100 tracking-tight">
                  {projectContext?.name || device.deviceName}
                </h2>
                {projectContext?.vcs && (
                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-400 uppercase">
                    {projectContext.vcs}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 font-mono truncate max-w-[200px] mt-0.5">
                {projectContext?.worktree || device.os}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                !device.online
                  ? 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50'
                  : device.opencodeStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !device.online
                    ? 'bg-zinc-500'
                    : device.opencodeStatus === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-rose-400'
                }`}
              />
              <span>
                {!device.online
                  ? 'Authorized • Offline'
                  : device.opencodeStatus === 'connected'
                  ? `OpenCode v${device.opencodeVersion || '1.18'}`
                  : 'OpenCode Off'}
              </span>
            </span>
          </div>
        </div>

        {/* Quick Surface Indicators */}
        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex items-center gap-2 text-zinc-300">
            <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="truncate">
              <span className="font-medium text-zinc-200">Terminal</span>
              <p className="text-[10px] text-zinc-500 truncate">Audited Tool Ops</p>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 flex items-center gap-2 text-zinc-300">
            <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="font-medium text-zinc-200">Diff Engine</span>
              <p className="text-[10px] text-zinc-500 truncate">Live Snapshot</p>
            </div>
          </div>
        </div>
      </div>

      {/* Conversations Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-400">
              Conversations
            </h3>
            <span className="px-1.5 py-0.5 rounded-full bg-zinc-800 text-[10px] font-mono text-zinc-400">
              {sessions.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onRefreshSessions}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Refresh sessions"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>
        </div>

        {sessions.length > 2 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800/80 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="p-8 rounded-3xl bg-zinc-900/30 border border-zinc-800/50 text-center space-y-2">
            <Sparkles className="w-6 h-6 text-zinc-500 mx-auto" />
            <p className="text-xs font-medium text-zinc-300">No active conversations</p>
            <p className="text-[11px] text-zinc-500">Tap New to start your first OpenCode session.</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 text-center text-xs text-zinc-500">
            No matching conversations found
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((sess) => {
              const isLoading = sess.id === loadingSessionId;
              const projectName = !selectedProjectId && sess.directory
                ? sess.directory.replace(/\\/g, '/').split('/').filter(Boolean).pop()
                : null;

              return (
                <div
                  key={sess.id}
                  onClick={() => !isLoading && onOpenSession(sess.id, sess.directory)}
                  className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between group shadow-sm ${
                    isLoading
                      ? 'bg-zinc-900/80 border-indigo-500/50 cursor-wait'
                      : 'bg-zinc-900/40 hover:bg-zinc-900 border-zinc-800/60 hover:border-zinc-700/80 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-400 group-hover:text-indigo-400 group-hover:border-indigo-500/40 transition-colors shrink-0">
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      ) : (
                        <MessageSquare className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold text-zinc-200 truncate group-hover:text-white transition-colors">
                          {sess.title || 'Untitled Session'}
                        </h4>
                        {projectName && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-indigo-300 font-mono">
                            {projectName}
                          </span>
                        )}
                        {isLoading && (
                          <span className="text-[10px] font-mono text-indigo-400 animate-pulse">
                            Opening...
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                        {sess.createdAt ? new Date(sess.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                      </p>
                    </div>
                  </div>

                  {isLoading ? (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Session Modal - Rendered via Portal to document.body to avoid CSS clipping */}
      {showNewModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 min-h-[100dvh]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowNewModal(false);
            }}
          >
            <div className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 my-auto">
              <h3 className="text-sm font-bold text-zinc-100">Create New Session</h3>
              <form onSubmit={handleCreate} className="space-y-3">
                <input
                  type="text"
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  placeholder="Session title (optional)..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 font-sans"
                  autoFocus
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowNewModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
