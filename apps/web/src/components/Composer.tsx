import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Send,
  Square,
  ChevronDown,
  Check,
  ShieldAlert,
  CheckCircle,
  XCircle,
  Cpu,
  X,
  Pencil,
  ArrowUp,
  Layers,
  RotateCcw,
  GitFork,
  Sparkles,
  FileDiff,
  Terminal,
  AtSign,
} from 'lucide-react';
import type { ModelInfo, PermissionItem, ContextMention, SessionInteractionMode } from '@opencode-remote/protocol';
import type { SessionTelemetry } from '../useRelay';
import { ModeSelector } from './ModeSelector';

interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => Promise<void> | void;
}

interface ComposerProps {
  onSendMessage: (text: string) => void;
  isStreaming: boolean;
  onAbort: () => void;
  models: ModelInfo[];
  selectedModel: { providerID: string; modelID: string } | null;
  onSelectModel: (m: { providerID: string; modelID: string }) => void;
  permissions?: PermissionItem[];
  onReplyPermission?: (id: string, reply: 'allow' | 'deny') => void;
  placeholder?: string;
  editingItem?: { id: string; content: string } | null;
  onSaveEdit?: (id: string, newContent: string) => void;
  onCancelEdit?: () => void;
  // Phase 1 Modernization
  telemetry?: SessionTelemetry | null;
  onOpenTelemetry?: () => void;
  onUndo?: () => Promise<{ success: boolean; revertedPrompt?: string }>;
  onCompact?: () => Promise<boolean> | void;
  onFork?: () => Promise<any> | void;
  onSelectTab?: (tab: any) => void;
  onClearSession?: () => void;
  // Phase 2, 3, 4 Modernization
  mode?: SessionInteractionMode;
  onModeChange?: (mode: SessionInteractionMode) => void;
  mentions?: ContextMention[];
  onRemoveMention?: (index: number) => void;
  onOpenMentionModal?: () => void;
  onQueueMessage?: (text: string) => void;
}

export const Composer: React.FC<ComposerProps> = ({
  onSendMessage,
  isStreaming,
  onAbort,
  models,
  selectedModel,
  onSelectModel,
  permissions = [],
  onReplyPermission,
  placeholder = 'Ask OpenCode to code, inspect, or command an action... (Type / for commands)',
  editingItem,
  onSaveEdit,
  onCancelEdit,
  telemetry,
  onOpenTelemetry,
  onUndo,
  onCompact,
  onFork,
  onSelectTab,
  onClearSession,
  mode,
  onModeChange,
  mentions = [],
  onRemoveMention,
  onOpenMentionModal,
  onQueueMessage,
}) => {
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});
  const [slashIndex, setSlashIndex] = useState(0);
  const [showSlashDismissed, setShowSlashDismissed] = useState(false);
  const [steerMode, setSteerMode] = useState<'steer' | 'queue'>('steer');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isShellMode = input.startsWith('!');

  const toggleProvider = (provider: string) => {
    setCollapsedProviders((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const m of models) {
      const provider = m.providerName || m.providerId || 'Default';
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(m);
    }
    return groups;
  }, [models]);

  // Slash commands registry
  const slashCommands = useMemo<SlashCommand[]>(() => [
    {
      name: '/compact',
      aliases: ['/summarize'],
      description: 'Summarize conversation history to free context window tokens',
      icon: Layers,
      action: async () => {
        await onCompact?.();
      },
    },
    {
      name: '/undo',
      aliases: ['/revert'],
      description: 'Revert last turn and restore prompt in composer to re-edit',
      icon: RotateCcw,
      action: async () => {
        if (onUndo) {
          const res = await onUndo();
          if (res?.revertedPrompt) {
            setInput(res.revertedPrompt);
            if (textareaRef.current) {
              textareaRef.current.focus();
            }
          }
        }
      },
    },
    {
      name: '/fork',
      aliases: ['/branch'],
      description: 'Fork conversation from this turn into a new branch',
      icon: GitFork,
      action: async () => {
        await onFork?.();
      },
    },
    {
      name: '/diff',
      aliases: ['/review'],
      description: 'Switch to Review tab to inspect code changes & diffs',
      icon: FileDiff,
      action: () => {
        onSelectTab?.('review');
      },
    },
    {
      name: '/terminal',
      aliases: ['/sh', '/pty'],
      description: 'Open interactive terminal shell drawer',
      icon: Terminal,
      action: () => {
        onSelectTab?.('terminal');
      },
    },
    {
      name: '/model',
      aliases: ['/models'],
      description: 'Switch OpenCode model and provider',
      icon: Cpu,
      action: () => {
        setShowModelPicker(true);
      },
    },
    {
      name: '/clear',
      aliases: ['/new'],
      description: 'Start a fresh new coding session',
      icon: Sparkles,
      action: () => {
        onClearSession?.();
      },
    },
  ], [onCompact, onUndo, onFork, onClearSession, onSelectTab]);

  const matchingSlashCommands = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const query = input.toLowerCase();
    if (query === '/') return slashCommands;
    return slashCommands.filter(
      (c) => c.name.startsWith(query) || c.aliases?.some((a) => a.startsWith(query))
    );
  }, [input, slashCommands]);

  const showSlashMenu =
    input.startsWith('/') &&
    !input.includes(' ') &&
    !showSlashDismissed &&
    matchingSlashCommands.length > 0;

  const executeSlashCommand = async (cmd: SlashCommand) => {
    setInput('');
    setShowSlashDismissed(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await cmd.action();
  };

  // Synchronize input when entering or exiting edit mode
  useEffect(() => {
    if (editingItem) {
      setInput(editingItem.content);
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
      }
    }
  }, [editingItem]);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && matchingSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((prev) => (prev < matchingSlashCommands.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((prev) => (prev > 0 ? prev - 1 : matchingSlashCommands.length - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = matchingSlashCommands[slashIndex] || matchingSlashCommands[0];
        if (cmd) {
          executeSlashCommand(cmd);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Escape' && editingItem) {
      e.preventDefault();
      onCancelEdit?.();
      setInput('');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const clean = input.trim();
    if (!clean) return;

    // Check if input matches any slash command directly
    const directCmd = slashCommands.find(
      (c) => c.name === clean.toLowerCase() || c.aliases?.includes(clean.toLowerCase())
    );
    if (directCmd) {
      await executeSlashCommand(directCmd);
      return;
    }

    if (editingItem) {
      onSaveEdit?.(editingItem.id, clean);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      return;
    }

    let fullPrompt = clean;
    if (mentions && mentions.length > 0) {
      const refs = mentions
        .map((m) => `@${m.path}${m.lineStart ? `#L${m.lineStart}${m.lineEnd ? `-${m.lineEnd}` : ''}` : ''}`)
        .join(' ');
      fullPrompt = `${refs}\n\n${fullPrompt}`;
    }

    if (isStreaming && steerMode === 'queue' && onQueueMessage) {
      onQueueMessage(fullPrompt);
    } else {
      onSendMessage(fullPrompt);
    }

    setInput('');
    setShowSlashDismissed(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setShowSlashDismissed(false);
    setSlashIndex(0);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;

    if (val.endsWith('@') && onOpenMentionModal) {
      onOpenMentionModal();
    }
  };

  return (
    <div className="flex flex-col w-full shrink-0 relative z-30">
      {/* Editing Queued Message Banner */}
      {editingItem && (
        <div className="px-3.5 py-1.5 bg-indigo-950/70 border-b border-indigo-800/50 flex items-center justify-between text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2 text-indigo-300 font-medium">
            <Pencil className="w-3.5 h-3.5 text-indigo-400" />
            <span>Editing Queued Message</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setInput('');
              onCancelEdit?.();
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {/* Permission Prompts Dock */}
      {permissions.length > 0 && onReplyPermission && (
        <div className="px-3.5 py-2 space-y-2 border-b border-slate-800 bg-amber-950/20">
          {permissions.map((perm) => (
            <div
              key={perm.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 rounded-xl bg-slate-950/80 border border-amber-600/30 text-xs shadow-md"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-amber-950 border border-amber-600/50 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-amber-200">Permission Required</p>
                  <p className="text-[11px] text-slate-300 font-mono truncate">
                    OpenCode wants to run:{' '}
                    <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded border border-amber-900/60 font-bold">
                      {perm.command || perm.title || 'Action'}
                    </code>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => onReplyPermission(perm.id, 'allow')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-xs cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Allow</span>
                </button>
                <button
                  type="button"
                  onClick={() => onReplyPermission(perm.id, 'deny')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white font-medium text-xs transition-all cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Deny</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Controls & Model Selector Bar */}
      <div className="px-3.5 pt-2 pb-1 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          {/* Model Selector Pill */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/70 transition-all shadow-xs cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-mono text-[11px] font-medium max-w-[140px] truncate">
                {selectedModel?.modelID || 'Model'}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
            </button>

            {/* Model Selector Dropdown */}
            {showModelPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowModelPicker(false)}
                />
                <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 p-2 flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-slate-800">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/80">
                    Select OpenCode Model
                  </div>

                  {models.length === 0 ? (
                    <div className="p-3 text-center text-slate-500 text-xs font-mono">
                      No models reported by host
                    </div>
                  ) : (
                    Object.entries(groupedModels).map(([provider, providerModels]) => {
                      const isCollapsed = Boolean(collapsedProviders[provider]);
                      return (
                        <div key={provider} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => toggleProvider(provider)}
                            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-slate-800/80 transition-colors text-left group cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <ChevronDown
                                className={`w-3 h-3 text-slate-400 group-hover:text-indigo-400 transition-transform duration-200 shrink-0 ${
                                  isCollapsed ? '-rotate-90' : ''
                                }`}
                              />
                              <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider font-mono truncate">
                                {provider}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-full shrink-0">
                              {providerModels.length}
                            </span>
                          </button>

                          {!isCollapsed && (
                            <div className="space-y-0.5 pl-1">
                              {providerModels.map((m) => {
                                const isSelected =
                                  selectedModel?.providerID === m.providerId &&
                                  selectedModel?.modelID === m.id;
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => {
                                      onSelectModel({ providerID: m.providerId, modelID: m.id });
                                      setShowModelPicker(false);
                                    }}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono flex items-center justify-between transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white font-medium'
                                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                                    }`}
                                  >
                                    <span className="truncate">{m.name || m.id}</span>
                                    {isSelected && <Check className="w-3.5 h-3.5 ml-2 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {/* Telemetry Circular Gauge Pill */}
          {telemetry && (
            <button
              type="button"
              onClick={onOpenTelemetry}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-slate-300 transition-colors cursor-pointer group shadow-xs"
              title="Click to view token breakdown & context telemetry"
            >
              <div className="relative w-3.5 h-3.5 shrink-0">
                <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    className="text-slate-700"
                    strokeWidth="4"
                    stroke="currentColor"
                    fill="transparent"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    className={
                      (telemetry.usagePercent ?? 0) > 85
                        ? 'text-rose-400'
                        : (telemetry.usagePercent ?? 0) > 60
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }
                    strokeWidth="4"
                    strokeDasharray={2 * Math.PI * 14}
                    strokeDashoffset={
                      2 * Math.PI * 14 -
                      (Math.min(telemetry.usagePercent ?? 0, 100) / 100) * (2 * Math.PI * 14)
                    }
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                  />
                </svg>
              </div>
              <span className="font-semibold text-slate-200">
                {telemetry.usagePercent ?? 0}%
              </span>
              {telemetry.totalCost > 0 && (
                <span className="text-slate-400 text-[10px] hidden sm:inline">
                  · ${telemetry.totalCost.toFixed(3)}
                </span>
              )}
            </button>
          )}

          {/* Context Mention Button (@) */}
          {onOpenMentionModal && (
            <button
              type="button"
              onClick={onOpenMentionModal}
              title="Mention file or line range (@)"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-indigo-300 cursor-pointer transition-colors"
            >
              <AtSign className="w-3.5 h-3.5 text-indigo-400" />
            </button>
          )}

          {/* Mode Selector: ⚡ Build vs 🧠 Plan */}
          {mode && onModeChange && (
            <ModeSelector mode={mode} onChange={onModeChange} compact={true} />
          )}

          {/* Steer vs Queue Toggle (visible during active streaming) */}
          {isStreaming && (
            <div className="flex items-center p-0.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setSteerMode('steer')}
                className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                  steerMode === 'steer'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Steer: inject instruction immediately"
              >
                🎯 Steer
              </button>
              <button
                type="button"
                onClick={() => setSteerMode('queue')}
                className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                  steerMode === 'queue'
                    ? 'bg-amber-600/80 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Queue: enqueue instruction for next turn"
              >
                ⏳ Queue
              </button>
            </div>
          )}
        </div>

        <div className="text-[10px] text-slate-500 font-mono hidden sm:flex items-center gap-1.5">
          <span>Enter</span>
          <span className="text-slate-600">to send</span>
          <span>•</span>
          <span>/ for commands</span>
          <span>•</span>
          <span>! for shell</span>
        </div>
      </div>

      {/* Context Mentions Chips Row */}
      {mentions && mentions.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-1.5 items-center">
          {mentions.map((m, idx) => (
            <div
              key={idx}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-[11px] font-mono text-indigo-300 shadow-xs animate-in fade-in duration-100"
            >
              <AtSign className="w-3 h-3 text-indigo-400" />
              <span>
                {m.path.split(/[/\\]/).pop()}
                {m.lineStart ? `#L${m.lineStart}${m.lineEnd ? `-${m.lineEnd}` : ''}` : ''}
              </span>
              <button
                type="button"
                onClick={() => onRemoveMention?.(idx)}
                className="text-indigo-400 hover:text-white ml-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Direct Shell Mode Badge */}
      {isShellMode && (
        <div className="mx-3 mt-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-500/40 flex items-center gap-1.5 text-xs font-mono text-emerald-300 animate-in fade-in duration-150">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold">Direct Shell Execution:</span>
          <span className="text-emerald-400/80 text-[11px]">Command runs directly in workspace terminal</span>
        </div>
      )}

      {/* Floating Slash Commands Menu */}
      {showSlashMenu && (
        <div className="mx-3 mb-1.5 rounded-xl bg-slate-900 border border-indigo-500/40 shadow-2xl overflow-hidden divide-y divide-slate-800/80 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="px-3 py-1.5 bg-slate-950/60 flex items-center justify-between text-[11px] font-semibold text-indigo-400 font-mono">
            <span>Slash Commands</span>
            <span className="text-[10px] text-slate-500 font-normal">↑↓ to navigate • ↵ to execute</span>
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 p-1 space-y-0.5">
            {matchingSlashCommands.map((cmd, idx) => {
              const isSelected = idx === slashIndex;
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.name}
                  type="button"
                  onClick={() => executeSlashCommand(cmd)}
                  className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/25 border border-indigo-500/40 text-slate-100'
                      : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="p-1 rounded-md bg-slate-800 text-indigo-400 shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-100">{cmd.name}</span>
                      {cmd.aliases && cmd.aliases.length > 0 && (
                        <span className="text-[10px] font-mono text-slate-500 truncate">
                          ({cmd.aliases.join(', ')})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{cmd.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Textarea Input Row */}
      <div className="p-3 pt-1 flex items-end gap-2.5">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              isShellMode
                ? 'Run shell command in workspace (e.g. !git status, !pnpm test)...'
                : placeholder
            }
            rows={1}
            className={`w-full min-h-[44px] max-h-44 resize-none rounded-xl pl-3.5 pr-8 py-2.5 text-sm transition-all leading-relaxed ${
              isShellMode
                ? 'bg-[#060a0f] border border-emerald-500/60 text-emerald-400 font-mono placeholder-emerald-700/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40'
                : 'bg-slate-950/90 border border-slate-800/90 text-slate-100 placeholder-slate-500 font-sans focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30'
            }`}
          />
          {input.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setInput('');
                setShowSlashDismissed(false);
                if (textareaRef.current) {
                  textareaRef.current.style.height = 'auto';
                  textareaRef.current.focus();
                }
              }}
              className="absolute right-2.5 top-3 p-0.5 rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors cursor-pointer"
              title="Clear input"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {editingItem ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim()}
            title="Save changes"
            className="w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg shadow-emerald-600/25 transition-all shrink-0 cursor-pointer flex items-center justify-center active:scale-95"
          >
            <Check className="w-4 h-4" />
          </button>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 shrink-0">
            {input.trim().length > 0 && (
              <button
                type="button"
                onClick={handleSubmit}
                title="Queue message (sends after agent finishes work)"
                className="w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all shrink-0 cursor-pointer flex items-center justify-center active:scale-95 animate-in fade-in duration-150"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onAbort}
              title="Stop generation"
              className="w-11 h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all shrink-0 cursor-pointer flex items-center justify-center animate-pulse"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim()}
            title="Send prompt"
            className="w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg shadow-indigo-600/25 transition-all shrink-0 cursor-pointer flex items-center justify-center active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
