import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  FileCode,
  GitCommit,
  Terminal,
  Activity,
  Send,
  Sparkles,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import type {
  OpenCodeSession,
  SessionMessage,
  SnapshotFileDiff,
  ProjectContext,
} from '@opencode-remote/protocol';
import { type WorkspaceTab } from '../useRelay';
import { ChangedFilesView } from './ChangedFilesView';
import { DiffViewer } from './DiffViewer';
import { TerminalView } from './TerminalView';
import { AgentActivityView } from './AgentActivityView';
import { ReasoningView } from './ReasoningView';
import { ToolExecutionCard } from './ToolExecutionCard';

interface ConversationViewProps {
  session: OpenCodeSession;
  messages: SessionMessage[];
  streamingText: string;
  isStreaming: boolean;
  projectContext?: ProjectContext | null;
  diffs: SnapshotFileDiff[];
  activeDiffFile?: string | null;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onSelectDiffFile: (file: string) => void;
  onSendMessage: (content: string) => void;
  onClose: () => void;
  onRefreshDiff: () => void;
}

export function ConversationView({
  session,
  messages,
  streamingText,
  isStreaming,
  projectContext,
  diffs,
  activeDiffFile,
  activeTab,
  onSelectTab,
  onSelectDiffFile,
  onSendMessage,
  onClose,
  onRefreshDiff,
}: ConversationViewProps) {
  const [inputText, setInputText] = useState('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when messages or stream changes
  useEffect(() => {
    if (activeTab === 'chat' && !showScrollBottom) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, activeTab, showScrollBottom]);

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
    setShowScrollBottom(distanceToBottom > 120);
  };

  const scrollToBottom = () => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBottom(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleFileSelect = (file: string) => {
    onSelectDiffFile(file);
    onSelectTab('diff');
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-zinc-950 text-zinc-100 shadow-2xl border-x border-zinc-900/60 font-sans">
      {/* Session Top Bar */}
      <header className="shrink-0 backdrop-blur-md bg-zinc-950/90 border-b border-zinc-900 px-4 py-2.5 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="font-semibold text-xs text-zinc-100 truncate">
                {session.title || 'Untitled Session'}
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono mt-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isStreaming ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                  }`}
                />
                <span className="truncate">
                  {isStreaming ? 'OpenCode working...' : 'Ready'}
                </span>
                {projectContext?.name && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-500 truncate">{projectContext.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {activeTab === 'files' || activeTab === 'diff' ? (
              <button
                onClick={onRefreshDiff}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Refresh Diffs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Workspace Navigation Tabs */}
        <div className="flex items-center justify-between gap-1 pt-2.5 border-t border-zinc-900/80 mt-2">
          <button
            onClick={() => onSelectTab('chat')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'chat'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          <button
            onClick={() => onSelectTab('files')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all relative ${
              activeTab === 'files'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Files</span>
            {diffs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-[9px] font-mono">
                {diffs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab('diff')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all relative ${
              activeTab === 'diff'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Diff</span>
            {diffs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono">
                {diffs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab('terminal')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'terminal'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => onSelectTab('activity')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'activity'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Activity</span>
          </button>
        </div>
      </header>

      {/* Main Tab Content */}
      <main
        ref={chatScrollRef}
        onScroll={handleScroll}
        className="flex-1 p-4 overflow-y-auto relative"
      >
        {activeTab === 'chat' && (
          <div className="space-y-3.5 pb-2">
            {messages.length === 0 && !streamingText && (
              <div className="text-center py-16 space-y-2">
                <Sparkles className="w-8 h-8 text-indigo-400 mx-auto opacity-70" />
                <p className="text-xs text-zinc-400">Session ready. Send your prompt below!</p>
              </div>
            )}

            {messages.map((msg) => {
              // Extract reasoning parts
              const reasoningParts = msg.parts?.filter((p) => p.type === 'reasoning') || [];
              // Extract tool calls
              const toolParts = msg.parts?.filter((p) => p.type === 'tool') || [];

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <span className="text-[10px] text-zinc-500 font-mono mb-0.5 px-1 capitalize">
                    {msg.role === 'user' ? 'You' : 'OpenCode'}
                  </span>

                  <div
                    className={`max-w-[90%] rounded-2xl p-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-sm'
                    }`}
                  >
                    {/* Collapsible reasoning if present */}
                    {reasoningParts.map((rp, rIdx) => (
                      <ReasoningView
                        key={rp.id || rIdx}
                        reasoning={rp.text || ''}
                        duration={rp.duration}
                      />
                    ))}

                    {/* Tool execution cards if present */}
                    {toolParts.length > 0 && (
                      <div className="my-2 space-y-1.5">
                        {toolParts.map((tp, tIdx) => (
                          <ToolExecutionCard
                            key={tp.callID || tp.id || tIdx}
                            part={tp}
                            diffs={diffs}
                            onViewFile={handleFileSelect}
                          />
                        ))}
                      </div>
                    )}

                    {/* Main text content */}
                    {(() => {
                      const cleanContent = msg.content
                        .replace(/<supermemory-recall>[\s\S]*?<\/supermemory-recall>/gi, '')
                        .trim();
                      return cleanContent ? (
                        <div className="whitespace-pre-wrap">{cleanContent}</div>
                      ) : null;
                    })()}
                  </div>
                </div>
              );
            })}

            {/* Live Streaming Assistant Output */}
            {streamingText && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1 text-[10px] text-amber-400 font-mono mb-0.5 px-1">
                  <Sparkles className="w-3 h-3 animate-spin" />
                  <span>OpenCode streaming...</span>
                </div>
                <div className="max-w-[90%] rounded-2xl p-3 text-xs leading-relaxed whitespace-pre-wrap bg-zinc-900 border border-indigo-500/40 text-zinc-100 shadow-md">
                  {streamingText}
                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
                </div>
              </div>
            )}

            <div ref={bottomAnchorRef} />
          </div>
        )}

        {activeTab === 'files' && (
          <ChangedFilesView diffs={diffs} onSelectFile={handleFileSelect} />
        )}

        {activeTab === 'diff' && (
          <DiffViewer
            diffs={diffs}
            activeFile={activeDiffFile}
            onSelectFile={onSelectDiffFile}
          />
        )}

        {activeTab === 'terminal' && <TerminalView messages={messages} />}

        {activeTab === 'activity' && (
          <AgentActivityView messages={messages} isStreaming={isStreaming} />
        )}

        {/* Jump to bottom button */}
        {activeTab === 'chat' && showScrollBottom && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-medium shadow-xl flex items-center gap-1 hover:bg-indigo-500 transition-all z-10"
          >
            <span>Jump to latest</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </main>

      {/* Composer Input Bar (only shown in chat tab) */}
      {activeTab === 'chat' && (
        <footer className="shrink-0 p-3 bg-zinc-950/90 border-t border-zinc-900 backdrop-blur-md">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isStreaming ? 'OpenCode working...' : 'Message OpenCode...'}
              disabled={isStreaming}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isStreaming}
              className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors shadow-sm"
              title="Send Prompt"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </footer>
      )}
    </div>
  );
}
