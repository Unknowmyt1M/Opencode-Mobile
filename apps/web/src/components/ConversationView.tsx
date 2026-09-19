import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  FileCheck2,
  Terminal as TerminalIcon,
  Activity,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import type {
  OpenCodeSession,
  SessionMessage,
  SnapshotFileDiff,
  ProjectContext,
  PtySession,
  ModelInfo,
  PermissionItem,
} from '@opencode-remote/protocol';
import { type WorkspaceTab } from '../useRelay';
import { ReviewView } from './ReviewView';
import { XtermTerminal } from './XtermTerminal';
import { AgentActivityView } from './AgentActivityView';
import { ReasoningView } from './ReasoningView';
import { ToolExecutionCard } from './ToolExecutionCard';
import { Composer } from './Composer';

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
  // Phase 3 extensions
  onAbort?: () => void;
  models?: ModelInfo[];
  selectedModel?: { providerID: string; modelID: string } | null;
  onSelectModel?: (m: { providerID: string; modelID: string }) => void;
  permissions?: PermissionItem[];
  onReplyPermission?: (id: string, reply: 'allow' | 'deny') => void;
  // PTY
  ptys?: PtySession[];
  activePtyId?: string | null;
  onSelectPty?: (id: string) => void;
  onCreatePty?: (title?: string) => Promise<PtySession | null>;
  onClosePty?: (id: string) => void;
  onSendPtyInput?: (ptyId: string, data: string) => void;
  onResizePty?: (ptyId: string, cols: number, rows: number) => void;
  subscribePtyData?: (ptyId: string, cb: (data: string) => void) => () => void;
  onRefreshPtys?: () => void;
  // Flag to hide tabs in desktop 3-pane layout
  hideTabs?: boolean;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
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
  onAbort,
  models = [],
  selectedModel = null,
  onSelectModel,
  permissions = [],
  onReplyPermission,
  ptys = [],
  activePtyId = null,
  onSelectPty,
  onCreatePty,
  onClosePty,
  onSendPtyInput,
  onResizePty,
  subscribePtyData,
  onRefreshPtys,
  hideTabs = false,
}) => {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

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

  const tabs: { id: WorkspaceTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'chat', label: 'Playground', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    {
      id: 'review',
      label: 'Review',
      icon: <FileCheck2 className="w-3.5 h-3.5" />,
      badge: diffs.length,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: <TerminalIcon className="w-3.5 h-3.5" />,
      badge: ptys.length,
    },
    { id: 'activity', label: 'Timeline', icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans">
      {/* Session Top Bar */}
      <header className="shrink-0 backdrop-blur-md bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
              title="Return to sessions"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="font-semibold text-xs text-white truncate max-w-[200px] sm:max-w-md">
                {session.title || 'Untitled Session'}
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                <span>{session.id.slice(0, 10)}...</span>
                {projectContext?.name && (
                  <>
                    <span>•</span>
                    <span className="text-indigo-400 truncate">{projectContext.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-mono text-amber-300 animate-pulse">
                <Sparkles className="w-3 h-3" />
                <span>Working</span>
              </span>
            )}
          </div>
        </div>

        {/* Mobile Tab Navigation Bar (only if not hidden by desktop 3-pane shell) */}
        {!hideTabs && (
          <div className="flex items-center gap-1 mt-2.5 border-t border-slate-800/80 pt-2 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id || (tab.id === 'review' && activeTab === 'diff');
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isActive ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-indigo-400'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {(activeTab === 'chat' || hideTabs) && (
          <div
            ref={chatScrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {messages.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 p-8 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 text-indigo-400 flex items-center justify-center shadow-inner">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-300">Ready to code</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                    Ask OpenCode to edit code, inspect repo changes, run commands, or explore architecture.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const reasoningParts = (msg.parts || []).filter((p) => p.type === 'reasoning');
              const toolParts = (msg.parts || []).filter((p) => p.type === 'tool');

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white shadow-indigo-600/20'
                        : 'bg-slate-900/90 border border-slate-800 text-slate-200'
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
                            onViewFile={(f) => {
                              onSelectDiffFile(f);
                              onSelectTab('review');
                            }}
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
                        <div className="whitespace-pre-wrap select-text">{cleanContent}</div>
                      ) : null;
                    })()}
                  </div>
                </div>
              );
            })}

            {/* Live Streaming Assistant Output */}
            {streamingText && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1 text-[10px] text-amber-400 font-mono mb-1 px-1">
                  <Sparkles className="w-3 h-3 animate-spin" />
                  <span>OpenCode reasoning & drafting...</span>
                </div>
                <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed whitespace-pre-wrap bg-slate-900/90 border border-indigo-500/40 text-slate-100 shadow-lg">
                  {streamingText}
                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
                </div>
              </div>
            )}

            <div ref={bottomAnchorRef} />
          </div>
        )}

        {/* Review Tab (Files & Diffs unified) */}
        {!hideTabs && (activeTab === 'review' || activeTab === 'diff' || activeTab === 'files') && (
          <ReviewView
            diffs={diffs}
            activeFile={activeDiffFile || null}
            onSelectFile={onSelectDiffFile}
            onRefresh={onRefreshDiff}
          />
        )}

        {/* Real Interactive Terminal Tab */}
        {!hideTabs && activeTab === 'terminal' && (
          <XtermTerminal
            ptys={ptys}
            activePtyId={activePtyId}
            onSelectPty={(id) => onSelectPty?.(id)}
            onCreatePty={(t) => (onCreatePty ? onCreatePty(t) : Promise.resolve(null))}
            onClosePty={(id) => onClosePty?.(id)}
            onSendInput={(id, d) => onSendPtyInput?.(id, d)}
            onResize={(id, c, r) => onResizePty?.(id, c, r)}
            subscribeData={(id, cb) => (subscribePtyData ? subscribePtyData(id, cb) : () => {})}
            onRefresh={() => onRefreshPtys?.()}
          />
        )}

        {/* Timeline / Activity Tab */}
        {!hideTabs && activeTab === 'activity' && (
          <AgentActivityView messages={messages} isStreaming={isStreaming} />
        )}

        {/* Jump to bottom button */}
        {(activeTab === 'chat' || hideTabs) && showScrollBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-xl flex items-center gap-1 transition-all z-10 cursor-pointer"
          >
            <span>Jump to latest</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </main>

      {/* Composer Input Bar (only shown in chat tab or in desktop split view) */}
      {(activeTab === 'chat' || hideTabs) && (
        <Composer
          onSendMessage={onSendMessage}
          isStreaming={isStreaming}
          onAbort={() => onAbort?.()}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={(m) => onSelectModel?.(m)}
          permissions={permissions}
          onReplyPermission={onReplyPermission}
        />
      )}
    </div>
  );
};
