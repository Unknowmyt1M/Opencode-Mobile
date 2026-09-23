import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  FileCheck2,
  Terminal as TerminalIcon,
  Activity,
  Sparkles,
  ChevronDown,
  Folder,
} from 'lucide-react';
import type {
  OpenCodeSession,
  SessionMessage,
  SnapshotFileDiff,
  ProjectContext,
  PtySession,
  ModelInfo,
  PermissionItem,
  TodoItem,
  ContextMention,
  SessionInteractionMode,
  FsEntry,
} from '@opencode-remote/protocol';
import { type WorkspaceTab } from '../useRelay';
import { ReviewView } from './ReviewView';
import { XtermTerminal } from './XtermTerminal';
import { AgentWorkTimeline } from './AgentWorkTimeline';
import { MarkdownView } from './MarkdownView';
import { normalizeConversationTurns, type TurnElement, type ActivityItem, type TurnGroup } from '../utils/activityNormalizer';
import { Composer } from './Composer';
import { TodoWidget } from './TodoWidget';
import { QueuedMessages } from './QueuedMessages';
import { QuestionCard } from './QuestionCard';
import { FileTreeExplorer } from './FileTreeExplorer';
import { ContextMentionModal } from './ContextMentionModal';
import { SafeRevertModal } from './SafeRevertModal';
import type { QueuedMessage } from '../types/queue';
import type { SessionTelemetry } from '../useRelay';
import type { MessagePart } from '@opencode-remote/protocol';

function groupTurnElements(elements: TurnElement[]) {
  const chunks: Array<
    | { type: 'activities'; activities: ActivityItem[]; key: string }
    | { type: 'text'; content: string; key: string }
    | { type: 'question'; part: MessagePart; key: string }
  > = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === 'activity') {
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk && lastChunk.type === 'activities') {
        lastChunk.activities.push(el.activity);
      } else {
        chunks.push({
          type: 'activities',
          activities: [el.activity],
          key: `chunk_act_${el.id}_${i}`,
        });
      }
    } else if (el.type === 'text') {
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk && lastChunk.type === 'text') {
        lastChunk.content = `${lastChunk.content}\n\n${el.content}`;
      } else {
        chunks.push({
          type: 'text',
          content: el.content,
          key: `chunk_text_${el.id}_${i}`,
        });
      }
    } else if (el.type === 'question') {
      chunks.push({
        type: 'question',
        part: el.part,
        key: `chunk_q_${el.id}_${i}`,
      });
    }
  }

  return chunks;
}

interface TurnItemProps {
  turn: TurnGroup;
  isLastTurn: boolean;
  isStreaming: boolean;
  isWaitingForResponse?: boolean;
  onSelectDiffFile: (file: string) => void;
  onSelectTab: (tab: WorkspaceTab) => void;
  onReplyQuestion?: (requestId: string, answers: string[][]) => Promise<boolean | void> | void;
}

const TurnItem: React.FC<TurnItemProps> = React.memo(
  ({
    turn,
    isLastTurn,
    isStreaming,
    isWaitingForResponse,
    onSelectDiffFile,
    onSelectTab,
    onReplyQuestion,
  }) => {
    const [showCompactedSummary, setShowCompactedSummary] = useState(false);

    if (turn.isCompaction) {
      return (
        <div className="w-full my-4 flex flex-col items-center select-none">
          <div className="w-full flex items-center gap-3">
            <div className="flex-1 border-t border-dashed border-zinc-700/60" />
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-400 shadow-sm">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Session Compacted</span>
            </div>
            <div className="flex-1 border-t border-dashed border-zinc-700/60" />
          </div>

          {turn.compactionSummary && (
            <div className="mt-2 w-full max-w-2xl px-2">
              <button
                type="button"
                onClick={() => setShowCompactedSummary((prev) => !prev)}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5 mx-auto bg-zinc-900/60 hover:bg-zinc-800/80 px-2.5 py-1 rounded-md border border-zinc-800/80 cursor-pointer"
              >
                <span>{showCompactedSummary ? 'Hide compacted summary' : 'Show compacted summary'}</span>
                <ChevronDown
                  className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${
                    showCompactedSummary ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {showCompactedSummary && (
                <div className="mt-2.5 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300 shadow-inner select-text">
                  <MarkdownView content={turn.compactionSummary} />
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    const cleanUserPrompt = turn.userMessage
      ? turn.userMessage.content
          .replace(/<supermemory-recall>[\s\S]*?<\/supermemory-recall>/gi, '')
          .trim()
      : null;

    const isThinking =
      isLastTurn &&
      ((isWaitingForResponse && !turn.finalResponse && !turn.agentRun.hasActiveWork) ||
        (isStreaming && !turn.agentRun.hasActiveWork && !turn.finalResponse));

    return (
      <div className="w-full space-y-2 py-0.5">
        {/* User message inside bubble */}
        {turn.userMessage && cleanUserPrompt && (
          <div className="flex flex-col items-end w-full pb-1">
            <div className="max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-md shadow-indigo-600/20 bg-indigo-600 text-white whitespace-pre-wrap select-text">
              {cleanUserPrompt}
            </div>
          </div>
        )}

        {/* Interleaved Chronological Elements (Thought ➔ Tool ➔ Text ➔ Thought ➔ Tool ➔ Text) */}
        {turn.elements && turn.elements.length > 0 ? (
          groupTurnElements(turn.elements).map((chunk) => {
            if (chunk.type === 'activities') {
              return (
                <div key={chunk.key} className="w-full max-w-3xl">
                  <AgentWorkTimeline
                    activities={chunk.activities}
                    isStreaming={isLastTurn && turn.agentRun.isStreaming}
                    defaultExpanded={isLastTurn || turn.agentRun.isStreaming}
                    onSelectDiffFile={(file) => {
                      onSelectDiffFile(file);
                      onSelectTab('review');
                    }}
                  />
                </div>
              );
            }
            if (chunk.type === 'text') {
              return (
                <div key={chunk.key} className="px-1 py-1 w-full max-w-3xl">
                  <MarkdownView content={chunk.content} />
                </div>
              );
            }
            if (chunk.type === 'question') {
              return (
                <div key={chunk.key} className="w-full max-w-3xl my-2">
                  <QuestionCard
                    input={chunk.part.state?.input}
                    output={chunk.part.state?.output}
                    status={chunk.part.state?.status}
                    requestId={chunk.part.callID}
                    onReply={async (answers) => {
                      await onReplyQuestion?.(chunk.part.callID || '', answers);
                    }}
                  />
                </div>
              );
            }
            return null;
          })
        ) : (
          <>
            {/* Fallback for legacy turns without elements */}
            {turn.agentRun.hasActiveWork && (
              <div className="w-full max-w-3xl">
                <AgentWorkTimeline
                  turn={turn}
                  defaultExpanded={isLastTurn || turn.agentRun.isStreaming}
                  onSelectDiffFile={(file) => {
                    onSelectDiffFile(file);
                    onSelectTab('review');
                  }}
                />
              </div>
            )}
            {turn.finalResponse && (
              <div className="px-1 py-1 w-full max-w-3xl">
                <MarkdownView content={turn.finalResponse} />
              </div>
            )}
          </>
        )}

        {isStreaming && isLastTurn && turn.finalResponse && (
          <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
        )}

        {/* Thinking / Drafting Status Card */}
        {isThinking && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 text-xs font-mono shadow-sm animate-pulse max-w-xs mt-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
            <span className="font-medium text-slate-200">OpenCode is thinking...</span>
            <span className="flex gap-1 ml-auto shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </div>
        )}
      </div>
    );
  }
);

interface ConversationViewProps {
  session: OpenCodeSession;
  messages: SessionMessage[];
  streamingText: string;
  isStreaming: boolean;
  isWaitingForResponse?: boolean;
  projectContext?: ProjectContext | null;
  diffs: SnapshotFileDiff[];
  activeDiffFile?: string | null;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onSelectDiffFile: (file: string) => void;
  onSendMessage: (content: string) => void;
  onClose: () => void;
  onRefreshDiff: () => void;
  // Todos
  todos?: TodoItem[];
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
  // Queue
  queuedMessages?: QueuedMessage[];
  editingQueueItem?: { id: string; content: string } | null;
  onEditQueuedMessage?: (item: QueuedMessage) => void;
  onSaveQueuedMessageEdit?: (id: string, newContent: string) => void;
  onCancelQueuedMessageEdit?: () => void;
  onDeleteQueuedMessage?: (id: string) => void;
  onSendQueuedMessageNow?: (id: string) => void;
  onRetryQueuedMessage?: (id: string) => void;
  // Phase 1 Modernization
  telemetry?: SessionTelemetry | null;
  onOpenTelemetry?: () => void;
  onUndo?: () => Promise<{ success: boolean; revertedPrompt?: string }>;
  onCompact?: () => Promise<boolean> | void;
  onFork?: () => Promise<any> | void;
  onClearSession?: () => void;
  onReplyQuestion?: (requestId: string, answers: string[][]) => Promise<boolean | void> | void;
  // Phase 2, 3, 4 Modernization
  mode?: SessionInteractionMode;
  onModeChange?: (mode: SessionInteractionMode) => void;
  onListFs?: (path?: string) => Promise<FsEntry[]>;
  onFindFs?: (query: string) => Promise<FsEntry[]>;
  onReadFs?: (path: string) => Promise<{ content: string; mime?: string } | null>;
  onQueueMessage?: (text: string) => void;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  session,
  messages,
  streamingText,
  isStreaming,
  isWaitingForResponse = false,
  projectContext,
  diffs,
  activeDiffFile,
  activeTab,
  onSelectTab,
  onSelectDiffFile,
  onSendMessage,
  onClose,
  onRefreshDiff,
  todos = [],
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
  queuedMessages = [],
  editingQueueItem = null,
  onEditQueuedMessage,
  onSaveQueuedMessageEdit,
  onCancelQueuedMessageEdit,
  onDeleteQueuedMessage,
  onSendQueuedMessageNow,
  onRetryQueuedMessage,
  telemetry,
  onOpenTelemetry,
  onUndo,
  onCompact,
  onFork,
  onClearSession,
  onReplyQuestion,
  mode,
  onModeChange,
  onListFs,
  onFindFs,
  onReadFs,
  onQueueMessage,
}) => {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [composerMentions, setComposerMentions] = useState<ContextMention[]>([]);
  const [showMentionModal, setShowMentionModal] = useState(false);
  const [showSafeRevertModal, setShowSafeRevertModal] = useState(false);
  const [isRevertingTurn, setIsRevertingTurn] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  const handleCommentLine = (file: string, lineNum: number, _snippet: string) => {
    setComposerMentions((prev) => [
      ...prev,
      { path: file, lineStart: lineNum, lineEnd: lineNum },
    ]);
    onSelectTab('chat');
  };

  const handleConfirmRevert = async () => {
    if (!onUndo) return;
    setIsRevertingTurn(true);
    try {
      await onUndo();
    } finally {
      setIsRevertingTurn(false);
      setShowSafeRevertModal(false);
    }
  };

  const conversationTurns = React.useMemo(
    () => normalizeConversationTurns(messages, streamingText, isStreaming, diffs),
    [messages, streamingText, isStreaming, diffs]
  );

  useEffect(() => {
    if (activeTab === 'chat' && !showScrollBottom) {
      if (isStreaming && chatScrollRef.current) {
        // Fast instant scroll during streaming - eliminates 60fps layout thrashing & animation backlog
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      } else {
        bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, streamingText, activeTab, showScrollBottom, isStreaming, isWaitingForResponse]);

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
      id: 'files',
      label: 'Files',
      icon: <Folder className="w-3.5 h-3.5" />,
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
    <div className="flex flex-col h-full w-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans min-h-0">
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
      <main className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
        {(activeTab === 'chat' || hideTabs) && (
          <div
            ref={chatScrollRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3"
          >
            {conversationTurns.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center text-center text-slate-500 p-2 sm:p-6 space-y-3 max-w-md mx-auto my-auto py-2">
                <div className="w-12 h-12 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-950/50">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Ready to code</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Ask OpenCode to build features, inspect repo diffs, run commands, or explore architecture.
                  </p>
                </div>

                {/* Quick Starter Action Chips */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pt-1">
                  {[
                    { label: 'Explain project architecture', icon: '🔍', prompt: 'Explain the project architecture, directory structure, and main workflows.' },
                    { label: 'Run test suite', icon: '🧪', prompt: 'Run the test suite and report any failing tests or errors.' },
                    { label: 'Review git diff & status', icon: '📝', prompt: 'Inspect current git status and summarize modified or unstaged files.' },
                    { label: 'Find potential optimizations', icon: '⚡', prompt: 'Audit the codebase for potential performance bottlenecks or optimizations.' },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => onSendMessage(chip.prompt)}
                      className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/40 text-left transition-all group cursor-pointer shadow-sm active:scale-98"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-300 group-hover:text-white">
                        <span className="text-sm">{chip.icon}</span>
                        <span className="truncate">{chip.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {conversationTurns.map((turn, turnIdx) => (
              <TurnItem
                key={turn.id}
                turn={turn}
                isLastTurn={turnIdx === conversationTurns.length - 1}
                isStreaming={isStreaming}
                isWaitingForResponse={isWaitingForResponse}
                onSelectDiffFile={onSelectDiffFile}
                onSelectTab={onSelectTab}
                onReplyQuestion={onReplyQuestion}
              />
            ))}

            {/* Immediate Thinking Feedback if user prompt has been sent and waiting for agent */}
            {isWaitingForResponse &&
              (!conversationTurns.length ||
                Boolean(conversationTurns[conversationTurns.length - 1].finalResponse)) && (
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 text-xs font-mono shadow-sm animate-pulse max-w-xs mt-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                  <span className="font-medium text-slate-200">OpenCode is thinking...</span>
                  <span className="flex gap-1 ml-auto shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              )}

            <div ref={bottomAnchorRef} />
          </div>
        )}

        {/* Review Tab (Files & Diffs unified) */}
        {!hideTabs && (activeTab === 'review' || activeTab === 'diff') && (
          <ReviewView
            diffs={diffs}
            activeFile={activeDiffFile || null}
            onSelectFile={onSelectDiffFile}
            onRefresh={onRefreshDiff}
            onCommentLine={handleCommentLine}
          />
        )}

        {/* Project File Tree Explorer Tab */}
        {!hideTabs && activeTab === 'files' && onListFs && onFindFs && onReadFs && (
          <FileTreeExplorer
            onListFs={onListFs}
            onFindFs={onFindFs}
            onReadFs={onReadFs}
            onAddMention={(mention) => {
              setComposerMentions((prev) => [...prev, mention]);
              onSelectTab('chat');
            }}
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
          <div className="p-4 max-w-3xl mx-auto space-y-4">
            {conversationTurns.filter((t) => t.agentRun.hasActiveWork).map((t) => (
              <div key={t.id} className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/80">
                <AgentWorkTimeline turn={t} defaultExpanded={true} onSelectDiffFile={onSelectDiffFile} />
              </div>
            ))}
          </div>
        )}

        {/* Jump to bottom button - Floating pill properly positioned */}
        {(activeTab === 'chat' || hideTabs) && showScrollBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-2xl flex items-center gap-1.5 transition-all z-30 cursor-pointer pointer-events-auto border border-indigo-400/30 whitespace-nowrap"
          >
            <span>Jump to latest</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </main>

      {/* Composer Input Bar, Todo Widget & Queued Messages */}
      {(activeTab === 'chat' || hideTabs) && (
        <div className="w-full shrink-0 flex flex-col">
          {/* Todo Widget */}
          {todos && todos.length > 0 && (
            <div className="px-3 sm:px-4 max-w-3xl mx-auto w-full mb-2">
              <TodoWidget todos={todos} />
            </div>
          )}

          {/* Queued Messages Card */}
          {queuedMessages && queuedMessages.length > 0 && (
            <div className="px-3 sm:px-4 max-w-3xl mx-auto w-full mb-2">
              <QueuedMessages
                queue={queuedMessages}
                isStreaming={isStreaming}
                onSendNow={(id) => onSendQueuedMessageNow?.(id)}
                onEdit={(item) => onEditQueuedMessage?.(item)}
                onDelete={(id) => onDeleteQueuedMessage?.(id)}
                onRetry={(id) => onRetryQueuedMessage?.(id)}
              />
            </div>
          )}

          <Composer
            onSendMessage={onSendMessage}
            isStreaming={isStreaming}
            onAbort={() => onAbort?.()}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={(m) => onSelectModel?.(m)}
            permissions={permissions}
            onReplyPermission={onReplyPermission}
            editingItem={editingQueueItem}
            onSaveEdit={onSaveQueuedMessageEdit}
            onCancelEdit={onCancelQueuedMessageEdit}
            telemetry={telemetry}
            onOpenTelemetry={onOpenTelemetry}
            onUndo={async () => {
              setShowSafeRevertModal(true);
              return { success: true };
            }}
            onCompact={onCompact}
            onFork={onFork}
            onSelectTab={onSelectTab}
            onClearSession={onClearSession}
            mode={mode}
            onModeChange={onModeChange}
            mentions={composerMentions}
            onRemoveMention={(idx) => setComposerMentions((prev) => prev.filter((_, i) => i !== idx))}
            onOpenMentionModal={() => setShowMentionModal(true)}
            onQueueMessage={onQueueMessage}
          />
        </div>
      )}

      {/* Context Mention Modal */}
      {showMentionModal && onFindFs && (
        <ContextMentionModal
          isOpen={showMentionModal}
          onClose={() => setShowMentionModal(false)}
          onSelect={(mention) => setComposerMentions((prev) => [...prev, mention])}
          onFindFiles={onFindFs}
        />
      )}

      {/* 3-Phase Safe Revert Modal */}
      {showSafeRevertModal && (
        <SafeRevertModal
          isOpen={showSafeRevertModal}
          onClose={() => setShowSafeRevertModal(false)}
          onConfirm={handleConfirmRevert}
          diffs={diffs}
          isReverting={isRevertingTurn}
        />
      )}
    </div>
  );
};
