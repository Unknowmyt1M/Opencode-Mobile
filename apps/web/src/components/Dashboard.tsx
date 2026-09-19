import { useState } from 'react';
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
} from 'lucide-react';
import type { DeviceInfo, OpenCodeSession, ProjectContext } from '@opencode-remote/protocol';

interface DashboardProps {
  device?: DeviceInfo;
  sessions: OpenCodeSession[];
  projectContext?: ProjectContext | null;
  onOpenSession: (sessionId: string) => void;
  onCreateSession: (title?: string) => void;
  onRefreshSessions: () => void;
}

export function Dashboard({
  device,
  sessions,
  projectContext,
  onOpenSession,
  onCreateSession,
  onRefreshSessions,
}: DashboardProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateSession(sessionTitle.trim() || undefined);
    setSessionTitle('');
    setShowNewModal(false);
  };

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

  return (
    <div className="space-y-4">
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
                device.opencodeStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  device.opencodeStatus === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-rose-400'
                }`}
              />
              <span>
                {device.opencodeStatus === 'connected'
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

        {sessions.length === 0 ? (
          <div className="p-8 rounded-3xl bg-zinc-900/30 border border-zinc-800/50 text-center space-y-2">
            <Sparkles className="w-6 h-6 text-zinc-500 mx-auto" />
            <p className="text-xs font-medium text-zinc-300">No active conversations</p>
            <p className="text-[11px] text-zinc-500">Tap New to start your first OpenCode session.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                onClick={() => onOpenSession(sess.id)}
                className="p-3.5 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700/80 transition-all cursor-pointer flex items-center justify-between group shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-400 group-hover:text-indigo-400 group-hover:border-indigo-500/40 transition-colors shrink-0">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-zinc-200 truncate group-hover:text-white transition-colors">
                      {sess.title || 'Untitled Session'}
                    </h4>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                      {sess.createdAt ? new Date(sess.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                    </p>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Session Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
            <h3 className="text-sm font-bold text-zinc-100">Create New Session</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="Session title (optional)..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
