import React, { useState, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import type { ModelInfo, PermissionItem } from '@opencode-remote/protocol';

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
  placeholder = 'Ask OpenCode to code, inspect, or command an action...',
}) => {
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  };

  return (
    <div className="flex flex-col bg-slate-900/95 border-t border-slate-800/90 backdrop-blur-md shrink-0 relative z-30 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* Prominent Human-In-The-Loop Permission Banner */}
      {permissions.length > 0 && onReplyPermission && (
        <div className="px-3.5 py-2.5 bg-amber-950/40 border-b border-amber-800/60 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
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
                  Object.entries(groupedModels).map(([provider, providerModels]) => (
                    <div key={provider} className="space-y-1">
                      <div className="px-2 pt-1 text-[10px] font-semibold text-indigo-400 uppercase tracking-wider font-mono">
                        {provider}
                      </div>
                      {providerModels.map((m) => {
                        const isSelected =
                          selectedModel?.modelID === m.id &&
                          selectedModel?.providerID === m.providerId;
                        return (
                          <button
                            key={`${m.providerId}-${m.id}`}
                            type="button"
                            onClick={() => {
                              onSelectModel({ providerID: m.providerId, modelID: m.id });
                              setShowModelPicker(false);
                            }}
                            className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-950/70 text-white font-medium border border-indigo-500/40 shadow-xs'
                                : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <p className="font-semibold text-xs truncate">{m.name || m.id}</p>
                              <p className="text-[10px] font-mono text-slate-500 truncate">{m.id}</p>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="text-[10px] text-slate-500 font-mono hidden sm:flex items-center gap-1.5">
          <span>Enter</span>
          <span className="text-slate-600">to send</span>
          <span>•</span>
          <span>Shift+Enter</span>
          <span className="text-slate-600">newline</span>
        </div>
      </div>

      {/* Textarea Input Row */}
      <div className="p-3 pt-1 flex items-end gap-2.5">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full min-h-[44px] max-h-44 resize-none rounded-xl bg-slate-950/90 border border-slate-800/90 pl-3.5 pr-8 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all font-sans leading-relaxed"
          />
          {input.length > 0 && !isStreaming && (
            <button
              type="button"
              onClick={() => {
                setInput('');
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

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            title="Stop generation"
            className="w-11 h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all shrink-0 cursor-pointer flex items-center justify-center animate-pulse"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
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
