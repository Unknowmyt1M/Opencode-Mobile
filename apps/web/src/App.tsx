import React, { useState, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Wifi,
  WifiOff,
  AlertCircle,
  X,
  Plus,
  FileCheck2,
  Activity,
  Sparkles,
  Loader2,
  Folder,
} from 'lucide-react';
import { useRelay } from './useRelay';
import { MachineSelector } from './components/MachineSelector';
import { Dashboard } from './components/Dashboard';
import { ConversationView } from './components/ConversationView';
import { ReviewView } from './components/ReviewView';
import { XtermTerminal } from './components/XtermTerminal';
import { AgentActivityTimeline } from './components/AgentActivityTimeline';
import { SessionLoadingSkeleton } from './components/SessionLoadingSkeleton';
import { SessionTelemetryModal } from './components/SessionTelemetryModal';
import { FileTreeExplorer } from './components/FileTreeExplorer';
import { ProjectSessionTree } from './components/ProjectSessionTree';

export default function App() {
  const {
    connectionState,
    devices,
    selectedDevice,
    setSelectedDeviceId,
    projects,
    selectedProjectId,
    selectProject,
    fetchProjects,
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
    isWaitingForResponse,
    isLoadingSession,
    loadingSessionId,
    lastError,
    clearError,
    pairDevice,
    revokeDevice,
    fetchSessions,
    sessionStatuses,
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
    todos,
    queuedMessages,
    editingQueueItem,
    setEditingQueueItem,
    editQueuedMessage,
    deleteQueuedMessage,
    sendQueuedMessageNow,
    retryQueuedMessage,
    // Phase 1 Modernization
    sessionTelemetry,
    forkSession,
    revertTurn,
    compactSession,
    replyQuestion,
    // Phase 2, 3, 4 Modernization
    enqueueMessage,
    interactionMode,
    setInteractionMode,
    listFs,
    findFs,
    readFs,
  } = useRelay();

  // Right pane tab on desktop (review, terminal, activity, files)
  const [rightPanelTab, setRightPanelTab] = useState<'review' | 'terminal' | 'activity' | 'files'>('review');
  const [showRightPanel, setShowRightPanel] = useState<boolean>(true);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  const handleCompact = async (): Promise<boolean> => {
    setIsCompacting(true);
    try {
      return await compactSession();
    } finally {
      setIsCompacting(false);
    }
  };

  const activeSessionRef = React.useRef(activeSession);
  activeSessionRef.current = activeSession;

  // Auto-fetch data on device connection & auto-mirror active/latest session
  useEffect(() => {
    if (selectedDevice?.paired && selectedDevice?.opencodeStatus === 'connected') {
      fetchProjects(selectedDevice.deviceId);
      fetchSessions(selectedDevice.deviceId).then((loadedSessions) => {
        if (!activeSessionRef.current && loadedSessions && loadedSessions.length > 0) {
          let savedLastSessionId: string | null = null;
          try {
            savedLastSessionId = localStorage.getItem(`opencode_last_session_${selectedDevice.deviceId}`);
          } catch {}
          const busySession = loadedSessions.find((s) => sessionStatuses[s.id] === 'busy');
          const targetSession =
            (savedLastSessionId ? loadedSessions.find((s) => s.id === savedLastSessionId) : null) ||
            busySession;
          if (targetSession) {
            openSession(selectedDevice.deviceId, targetSession.id, targetSession.directory);
          }
        }
      });
      fetchModels();
      fetchPtys();
      fetchPermissions();
    }
  }, [
    selectedDevice?.paired,
    selectedDevice?.opencodeStatus,
    selectedDevice?.deviceId,
    fetchProjects,
    fetchSessions,
    fetchModels,
    fetchPtys,
    fetchPermissions,
    openSession,
    sessionStatuses,
  ]);

  return (
    <div className="h-full h-dvh w-full overflow-hidden bg-[#090d16] text-slate-100 flex flex-col font-sans select-none">
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
              <div
                className="flex items-center gap-2 cursor-pointer group"
                onClick={() => closeActiveSession()}
                title="Return to Dashboard / New Chat"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30 group-hover:bg-indigo-500 transition-colors">
                  <TerminalIcon className="w-4 h-4" />
                </div>
                <div>
                  <h1 className="text-xs font-bold tracking-tight text-white group-hover:text-indigo-200 transition-colors">OpenCode Mobile</h1>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                    {connectionState === 'CONNECTED' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    ) : connectionState === 'CONNECTING' || connectionState === 'RECONNECTING' ? (
                      <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    )}
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

          </div>

          {/* Collapsible Project & Session Tree */}
          <div className="flex-1 overflow-hidden">
            <ProjectSessionTree
              projects={projects}
              sessions={sessions}
              activeSessionId={activeSession?.session.id}
              loadingSessionId={loadingSessionId}
              sessionStatuses={sessionStatuses}
              onSelectSession={(sess) => {
                if (selectedDevice) {
                  openSession(selectedDevice.deviceId, sess.id, sess.directory);
                }
              }}
              onCreateSession={(title, directory) => {
                if (selectedDevice) {
                  createSession(selectedDevice.deviceId, title, directory);
                }
              }}
            />
          </div>

          {/* Bottom Rail Actions */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
            <button
              type="button"
              onClick={() => {
                createPty('PowerShell');
                setRightPanelTab('terminal');
                setShowRightPanel(true);
              }}
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
          {isLoadingSession ? (
            <SessionLoadingSkeleton />
          ) : activeSession && selectedDevice ? (
            <ConversationView
              session={activeSession.session}
              messages={activeSession.messages}
              streamingText={streamingText}
              isStreaming={isStreaming}
              isWaitingForResponse={isWaitingForResponse}
              projectContext={projectContext}
              diffs={sessionDiffs}
              activeDiffFile={activeDiffFile}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              onSelectDiffFile={(file) => {
                setActiveDiffFile(file);
                setRightPanelTab('review');
                setShowRightPanel(true);
              }}
              showRightPanel={showRightPanel}
              onToggleRightPanel={() => setShowRightPanel((prev) => !prev)}
              onSendMessage={(content) =>
                sendMessage(
                  selectedDevice.deviceId,
                  activeSession.session.id,
                  content,
                  selectedModel || undefined
                )
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
              todos={todos}
              queuedMessages={queuedMessages}
              editingQueueItem={editingQueueItem}
              onEditQueuedMessage={setEditingQueueItem}
              onSaveQueuedMessageEdit={(id, content) => {
                if (activeSession) {
                  editQueuedMessage(activeSession.session.id, id, content);
                }
              }}
              onCancelQueuedMessageEdit={() => setEditingQueueItem(null)}
              onDeleteQueuedMessage={(id) => {
                if (activeSession) {
                  deleteQueuedMessage(activeSession.session.id, id);
                }
              }}
              onSendQueuedMessageNow={(id) => {
                if (activeSession) {
                  sendQueuedMessageNow(activeSession.session.id, id);
                }
              }}
              onRetryQueuedMessage={(id) => {
                if (activeSession) {
                  retryQueuedMessage(activeSession.session.id, id);
                }
              }}
              telemetry={sessionTelemetry}
              onOpenTelemetry={() => setShowTelemetryModal(true)}
              onUndo={revertTurn}
              onCompact={handleCompact}
              onFork={forkSession}
              onClearSession={closeActiveSession}
              onReplyQuestion={replyQuestion}
              mode={interactionMode}
              onModeChange={setInteractionMode}
              onListFs={listFs}
              onFindFs={findFs}
              onReadFs={readFs}
              onQueueMessage={(text) => {
                if (activeSession) {
                  enqueueMessage(activeSession.session.id, text);
                }
              }}
              allSessions={sessions}
              sessionStatuses={sessionStatuses}
              onSelectSubagent={(subId, subDir) => {
                if (selectedDevice) {
                  openSession(selectedDevice.deviceId, subId, subDir);
                }
              }}
              onBackToParent={() => {
                if (selectedDevice && activeSession?.session.parentID) {
                  openSession(selectedDevice.deviceId, activeSession.session.parentID);
                }
              }}
              hideTabs={true}
            />
          ) : selectedDevice && !selectedDevice.paired ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-md mx-auto w-full">
              <Dashboard
                device={selectedDevice}
                sessions={sessions}
                projects={projects}
                selectedProjectId={selectedProjectId}
                onSelectProject={selectProject}
                projectContext={projectContext}
                onOpenSession={(sId, dir) => openSession(selectedDevice.deviceId, sId, dir)}
                onCreateSession={(t, dir) => createSession(selectedDevice.deviceId, t, dir)}
                onRefreshSessions={() => fetchSessions(selectedDevice.deviceId)}
                onPairSubmit={pairDevice}
              />
            </div>
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
        {showRightPanel && (
          <section className="w-80 xl:w-96 shrink-0 bg-[#090d16] flex flex-col overflow-hidden border-l border-slate-800/80">
            {/* Header Tab Bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setRightPanelTab('review')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
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
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
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
                  onClick={() => setRightPanelTab('files')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
                    rightPanelTab === 'files'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>Files</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightPanelTab('activity')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
                    rightPanelTab === 'activity'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Timeline</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowRightPanel(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors ml-1 cursor-pointer"
                title="Collapse panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-hidden">
              {rightPanelTab === 'files' && (
                <FileTreeExplorer
                  onListFs={listFs}
                  onFindFs={findFs}
                  onReadFs={readFs}
                />
              )}

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
                <div className="h-full overflow-hidden">
                  <AgentActivityTimeline
                    sessionId={activeSession?.session.id}
                    messages={activeSession?.messages || []}
                    allSessions={sessions}
                    diffs={sessionDiffs}
                    ptys={ptys}
                    sessionStatuses={sessionStatuses}
                    onSelectSubagent={(subId, subDir) => {
                      if (selectedDevice) {
                        openSession(selectedDevice.deviceId, subId, subDir);
                      }
                    }}
                    onSelectDiffFile={(file) => {
                      setActiveDiffFile(file);
                      setRightPanelTab('review');
                    }}
                    onSelectPty={(ptyId) => {
                      setActivePtyId(ptyId);
                      setRightPanelTab('terminal');
                    }}
                  />
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* =========================================================================
          MOBILE TOUCH-OPTIMIZED VIEW (< 1024px)
          ========================================================================= */}
      <div className="flex lg:hidden flex-1 min-h-0 overflow-hidden w-full h-full">
        {isLoadingSession ? (
          <SessionLoadingSkeleton />
        ) : activeSession && selectedDevice ? (
          <ConversationView
            session={activeSession.session}
            messages={activeSession.messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            isWaitingForResponse={isWaitingForResponse}
            projectContext={projectContext}
            diffs={sessionDiffs}
            activeDiffFile={activeDiffFile}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onSelectDiffFile={(file) => {
              setActiveDiffFile(file);
              setActiveTab('review');
            }}
            onSendMessage={(content) =>
              sendMessage(
                selectedDevice.deviceId,
                activeSession.session.id,
                content,
                selectedModel || undefined
              )
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
            todos={todos}
            queuedMessages={queuedMessages}
            editingQueueItem={editingQueueItem}
            onEditQueuedMessage={setEditingQueueItem}
            onSaveQueuedMessageEdit={(id, content) => {
              if (activeSession) {
                editQueuedMessage(activeSession.session.id, id, content);
              }
            }}
            onCancelQueuedMessageEdit={() => setEditingQueueItem(null)}
            onDeleteQueuedMessage={(id) => {
              if (activeSession) {
                deleteQueuedMessage(activeSession.session.id, id);
              }
            }}
            onSendQueuedMessageNow={(id) => {
              if (activeSession) {
                sendQueuedMessageNow(activeSession.session.id, id);
              }
            }}
            onRetryQueuedMessage={(id) => {
              if (activeSession) {
                retryQueuedMessage(activeSession.session.id, id);
              }
            }}
            telemetry={sessionTelemetry}
            onOpenTelemetry={() => setShowTelemetryModal(true)}
            onUndo={revertTurn}
            onCompact={handleCompact}
            onFork={forkSession}
            onClearSession={closeActiveSession}
            onReplyQuestion={replyQuestion}
            mode={interactionMode}
            onModeChange={setInteractionMode}
            onListFs={listFs}
            onFindFs={findFs}
            onReadFs={readFs}
            onQueueMessage={(text) => {
              if (activeSession) {
                enqueueMessage(activeSession.session.id, text);
              }
            }}
            allSessions={sessions}
            sessionStatuses={sessionStatuses}
            onSelectSubagent={(subId, subDir) => {
              if (selectedDevice) {
                openSession(selectedDevice.deviceId, subId, subDir);
              }
            }}
            onBackToParent={() => {
              if (selectedDevice && activeSession?.session.parentID) {
                openSession(selectedDevice.deviceId, activeSession.session.parentID);
              }
            }}
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
                    ) : connectionState === 'CONNECTING' || connectionState === 'RECONNECTING' ? (
                      <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
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
                projects={projects}
                selectedProjectId={selectedProjectId}
                onSelectProject={selectProject}
                projectContext={projectContext}
                loadingSessionId={loadingSessionId}
                onOpenSession={(sId, dir) => selectedDevice && openSession(selectedDevice.deviceId, sId, dir)}
                onCreateSession={(t, dir) => selectedDevice && createSession(selectedDevice.deviceId, t, dir)}
                onRefreshSessions={() => selectedDevice && fetchSessions(selectedDevice.deviceId)}
                onPairSubmit={pairDevice}
              />
            </main>
          </div>
        )}
      </div>

      {/* Session Context & Token Telemetry Modal */}
      <SessionTelemetryModal
        isOpen={showTelemetryModal}
        onClose={() => setShowTelemetryModal(false)}
        telemetry={sessionTelemetry}
        onCompact={handleCompact}
        isCompacting={isCompacting}
      />
    </div>
  );
}
