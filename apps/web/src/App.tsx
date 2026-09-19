import React, { useState, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Wifi,
  WifiOff,
  AlertCircle,
  X,
  Plus,
  MessageSquare,
  FolderGit2,
  FileCheck2,
  Activity,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { useRelay } from './useRelay';
import { MachineSelector } from './components/MachineSelector';
import { Dashboard } from './components/Dashboard';
import { ConversationView } from './components/ConversationView';
import { ReviewView } from './components/ReviewView';
import { XtermTerminal } from './components/XtermTerminal';
import { AgentActivityView } from './components/AgentActivityView';

export default function App() {
  const {
    connectionState,
    devices,
    selectedDevice,
    setSelectedDeviceId,
    sessions,
    activeSession,
    projectContext,
    sessionDiffs,
    activeDiffFile,
    setActiveDiffFile,
    activeTab,
    setActiveTab,
    streamingText,
    isStreaming,
    lastError,
    clearError,
    pairDevice,
    revokeDevice,
    fetchSessions,
    createSession,
    openSession,
    sendMessage,
    fetchSessionDiff,
    closeActiveSession,
    refreshDevices,
    // Phase 3 additions
    ptys,
    activePtyId,
    setActivePtyId,
    fetchPtys,
    createPty,
    sendPtyInput,
    resizePty,
    closePty,
    subscribePtyData,
    abortActiveSession,
    models,
    selectedModel,
    setSelectedModel,
    fetchModels,
    permissions,
    fetchPermissions,
    replyPermission,
  } = useRelay();

  // Right pane tab on desktop (review, terminal, activity)
  const [rightPanelTab, setRightPanelTab] = useState<'review' | 'terminal' | 'activity'>('review');
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Auto-fetch data on device connection
  useEffect(() => {
    if (selectedDevice?.paired && selectedDevice?.opencodeStatus === 'connected') {
      fetchSessions(selectedDevice.deviceId);
      fetchModels();
      fetchPtys();
      fetchPermissions();
    }
  }, [
    selectedDevice?.paired,
    selectedDevice?.opencodeStatus,
    selectedDevice?.deviceId,
    fetchSessions,
    fetchModels,
    fetchPtys,
    fetchPermissions,
  ]);

  const handleCreateSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice) return;
    const title = newSessionTitle.trim() || undefined;
    setIsCreatingSession(true);
    try {
      const sess = await createSession(selectedDevice.deviceId, title);
      setNewSessionTitle('');
      if (sess?.id) {
        openSession(selectedDevice.deviceId, sess.id);
      }
    } finally {
      setIsCreatingSession(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#090d16] text-slate-100 flex flex-col font-sans select-none">
      {/* Global error banner */}
      {lastError && (
        <div className="bg-rose-950/90 border-b border-rose-800 text-rose-200 text-xs px-4 py-2 flex items-center justify-between z-50 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium">{lastError}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="p-1 hover:bg-rose-900/60 rounded text-rose-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          DESKTOP 3-PANE WORKSPACE LAYOUT (>= 1024px)
          ========================================================================= */}
      <div className="hidden lg:flex flex-1 overflow-hidden w-full h-full">
        {/* Pane 1: Left Rail (Machines, Context, Sessions) */}
        <aside className="w-72 xl:w-80 shrink-0 bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between overflow-hidden">
          {/* Top Brand & Machine Selector */}
          <div className="p-3 border-b border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                  <TerminalIcon className="w-4 h-4" />
                </div>
                <div>
                  <h1 className="text-xs font-bold tracking-tight text-white">OpenCode Mobile</h1>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        connectionState === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <span className="capitalize">{connectionState.toLowerCase()}</span>
                  </div>
                </div>
              </div>

              <MachineSelector
                devices={devices}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedDeviceId}
                onPairSubmit={pairDevice}
                onRevokeDevice={revokeDevice}
                onRefresh={refreshDevices}
              />
            </div>

            {/* Workspace / Project Context Badge */}
            {projectContext && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
                <FolderGit2 className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 truncate">
                    {projectContext.name || 'Workspace'}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">
                    {projectContext.worktree || 'Local Repository'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span>Sessions ({sessions.length})</span>
              <button
                type="button"
                onClick={() => {
                  if (selectedDevice) {
                    createSession(selectedDevice.deviceId);
                  }
                }}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Create session"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Session Create Form */}
            <form onSubmit={handleCreateSessionSubmit} className="px-2 py-1 mb-1">
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                disabled={isCreatingSession}
                placeholder="+ New session title..."
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans disabled:opacity-50"
              />
            </form>

            {sessions.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">No active sessions</div>
            ) : (
              sessions.map((sess) => {
                const isActive = activeSession?.session.id === sess.id;
                return (
                  <button
                    key={sess.id}
                    type="button"
                    onClick={() => {
                      if (selectedDevice) {
                        openSession(selectedDevice.deviceId, sess.id);
                      }
                    }}
                    className={`w-full text-left p-2 rounded-xl text-xs transition-all flex items-center justify-between group cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/20'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{sess.title || 'Untitled Session'}</span>
                    </div>
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        isActive ? 'text-white translate-x-0.5' : 'text-slate-600 group-hover:text-slate-400'
                      }`}
                    />
                  </button>
                );
              })
            )}
          </div>

          {/* Bottom Rail Actions */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
            <button
              type="button"
              onClick={() => createPty('PowerShell')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer border border-slate-800"
            >
              <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
              <span>+ PTY</span>
            </button>
            <div className="text-[10px] text-slate-500 font-mono">
              v1.18.30
            </div>
          </div>
        </aside>

        {/* Pane 2: Center Stage (Chat / Playground & Multiline Composer) */}
        <main className="flex-1 flex flex-col bg-[#0b0f19] border-r border-slate-800/80 min-w-0 overflow-hidden relative">
          {activeSession && selectedDevice ? (
            <ConversationView
              session={activeSession.session}
              messages={activeSession.messages}
              streamingText={streamingText}
              isStreaming={isStreaming}
              projectContext={projectContext}
              diffs={sessionDiffs}
              activeDiffFile={activeDiffFile}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              onSelectDiffFile={setActiveDiffFile}
              onSendMessage={(content) =>
                sendMessage(selectedDevice.deviceId, activeSession.session.id, content)
              }
              onClose={closeActiveSession}
              onRefreshDiff={() =>
                fetchSessionDiff(selectedDevice.deviceId, activeSession.session.id)
              }
              onAbort={abortActiveSession}
              models={models}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              permissions={permissions}
              onReplyPermission={replyPermission}
              ptys={ptys}
              activePtyId={activePtyId}
              onSelectPty={setActivePtyId}
              onCreatePty={createPty}
              onClosePty={closePty}
              onSendPtyInput={sendPtyInput}
              onResizePty={resizePty}
              subscribePtyData={subscribePtyData}
              onRefreshPtys={fetchPtys}
              hideTabs={true}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 shadow-xl">
                <Sparkles className="w-8 h-8" />
              </div>
              <div className="max-w-md">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  OpenCode Remote Workspace
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Select a session from the left rail or launch a new conversation to control OpenCode on your PC.
                </p>
              </div>
              {selectedDevice && (
                <button
                  type="button"
                  onClick={() => createSession(selectedDevice.deviceId, 'New Session')}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Create New Session
                </button>
              )}
            </div>
          )}
        </main>

        {/* Pane 3: Right Panel (Review Surface / Interactive PTY / Timeline) */}
        <section className="w-96 xl:w-[480px] shrink-0 bg-[#090d16] flex flex-col overflow-hidden">
          {/* Header Tab Bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRightPanelTab('review')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                  rightPanelTab === 'review'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Review</span>
                {sessionDiffs.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-indigo-300 font-mono">
                    {sessionDiffs.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setRightPanelTab('terminal')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                  rightPanelTab === 'terminal'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                <span>Terminal</span>
                {ptys.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-indigo-300 font-mono">
                    {ptys.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setRightPanelTab('activity')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                  rightPanelTab === 'activity'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Timeline</span>
              </button>
            </div>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'review' && (
              <ReviewView
                diffs={sessionDiffs}
                activeFile={activeDiffFile}
                onSelectFile={setActiveDiffFile}
                onRefresh={() => {
                  if (selectedDevice && activeSession) {
                    fetchSessionDiff(selectedDevice.deviceId, activeSession.session.id);
                  }
                }}
              />
            )}

            {rightPanelTab === 'terminal' && (
              <XtermTerminal
                ptys={ptys}
                activePtyId={activePtyId}
                onSelectPty={setActivePtyId}
                onCreatePty={createPty}
                onClosePty={closePty}
                onSendInput={sendPtyInput}
                onResize={resizePty}
                subscribeData={subscribePtyData}
                onRefresh={fetchPtys}
              />
            )}

            {rightPanelTab === 'activity' && (
              <AgentActivityView
                messages={activeSession ? activeSession.messages : []}
                isStreaming={isStreaming}
              />
            )}
          </div>
        </section>
      </div>

      {/* =========================================================================
          MOBILE TOUCH-OPTIMIZED VIEW (< 1024px)
          ========================================================================= */}
      <div className="flex lg:hidden flex-1 overflow-hidden w-full h-full">
        {activeSession && selectedDevice ? (
          <ConversationView
            session={activeSession.session}
            messages={activeSession.messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            projectContext={projectContext}
            diffs={sessionDiffs}
            activeDiffFile={activeDiffFile}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onSelectDiffFile={setActiveDiffFile}
            onSendMessage={(content) =>
              sendMessage(selectedDevice.deviceId, activeSession.session.id, content)
            }
            onClose={closeActiveSession}
            onRefreshDiff={() =>
              fetchSessionDiff(selectedDevice.deviceId, activeSession.session.id)
            }
            onAbort={abortActiveSession}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            permissions={permissions}
            onReplyPermission={replyPermission}
            ptys={ptys}
            activePtyId={activePtyId}
            onSelectPty={setActivePtyId}
            onCreatePty={createPty}
            onClosePty={closePty}
            onSendPtyInput={sendPtyInput}
            onResizePty={resizePty}
            subscribePtyData={subscribePtyData}
            onRefreshPtys={fetchPtys}
            hideTabs={false}
          />
        ) : (
          <div className="flex-1 flex flex-col justify-between bg-zinc-950 text-zinc-100 overflow-y-auto">
            {/* Mobile Top Header */}
            <header className="sticky top-0 z-20 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                  <TerminalIcon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-xs tracking-tight text-white">OpenCode Mobile</h1>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono">
                    {connectionState === 'CONNECTED' ? (
                      <Wifi className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <WifiOff className="w-3 h-3 text-rose-400" />
                    )}
                    <span className="capitalize">{connectionState.toLowerCase()}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <MachineSelector
                  devices={devices}
                  selectedDevice={selectedDevice}
                  onSelectDevice={setSelectedDeviceId}
                  onPairSubmit={pairDevice}
                  onRevokeDevice={revokeDevice}
                  onRefresh={refreshDevices}
                />
              </div>
            </header>

            {/* Main Mobile Dashboard */}
            <main className="flex-1 p-4 space-y-4 overflow-y-auto">
              <Dashboard
                device={selectedDevice}
                sessions={sessions}
                projectContext={projectContext}
                onOpenSession={(sId) => selectedDevice && openSession(selectedDevice.deviceId, sId)}
                onCreateSession={(t) => selectedDevice && createSession(selectedDevice.deviceId, t)}
                onRefreshSessions={() => selectedDevice && fetchSessions(selectedDevice.deviceId)}
              />
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
