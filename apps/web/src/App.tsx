import { useEffect } from 'react';
import {
  Terminal,
  Wifi,
  WifiOff,
  AlertCircle,
  X,
} from 'lucide-react';
import { useRelay } from './useRelay';
import { MachineSelector } from './components/MachineSelector';
import { Dashboard } from './components/Dashboard';
import { ConversationView } from './components/ConversationView';

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
  } = useRelay();

  // Auto-fetch sessions and project context when device is paired & OpenCode connected
  useEffect(() => {
    if (selectedDevice?.paired && selectedDevice?.opencodeStatus === 'connected') {
      fetchSessions(selectedDevice.deviceId);
    }
  }, [selectedDevice?.paired, selectedDevice?.opencodeStatus, selectedDevice?.deviceId, fetchSessions]);

  // If a session is open, render the full workspace control surface
  if (activeSession && selectedDevice) {
    return (
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
      />
    );
  }

  // Otherwise, render the main Remote Dashboard
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between max-w-md mx-auto shadow-2xl border-x border-zinc-900/60 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Terminal className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xs tracking-tight text-white">OpenCode Remote</h1>
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

      {/* Main Dashboard Content */}
      <main className="flex-1 p-4 space-y-4 overflow-y-auto">
        {lastError && (
          <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs flex items-start gap-2.5 shadow-sm">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              <p className="font-semibold text-[11px]">Notice</p>
              <p className="opacity-90 text-[11px]">{lastError}</p>
            </div>
            <button
              onClick={clearError}
              className="p-1 text-rose-400 hover:text-rose-200 hover:bg-rose-900/30 rounded-lg transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <Dashboard
          device={selectedDevice}
          sessions={sessions}
          projectContext={projectContext}
          onOpenSession={(sessionId) => {
            if (selectedDevice) {
              openSession(selectedDevice.deviceId, sessionId);
            }
          }}
          onCreateSession={(title) => {
            if (selectedDevice) {
              createSession(selectedDevice.deviceId, title);
            }
          }}
          onRefreshSessions={() => {
            if (selectedDevice) {
              fetchSessions(selectedDevice.deviceId);
            }
          }}
        />
      </main>

      {/* Footer */}
      <footer className="p-3.5 border-t border-zinc-900 text-center text-[10px] text-zinc-500 font-mono bg-zinc-950/50 backdrop-blur-sm">
        OpenCode Remote Workspace · Phase 3
      </footer>
    </div>
  );
}
