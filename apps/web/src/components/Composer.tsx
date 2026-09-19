import React, { useState, useRef } from 'react';
import { Send, Square, Sparkles, ChevronDown, Check, ShieldAlert, CheckCircle, XCircle } from 'lucide-react';
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
  placeholder = 'Ask OpenCode or command an action... (Shift+Enter for newline)',
}) => {
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    // Auto-adjust height
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <div className="flex flex-col bg-slate-900/95 border-t border-slate-800 backdrop-blur-md">
      {/* Interactive Permissions Banner (Antigravity Human-In-The-Loop) */}
      {permissions.length > 0 && onReplyPermission && (
        <div className="px-3 py-2 bg-amber-950/40 border-b border-amber-800/50 flex flex-col gap-2">
          {permissions.map((perm) => (
            <div key={perm.id} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-amber-200 font-medium truncate">
                  Permission required: <code className="text-amber-300 font-mono bg-amber-900/40 px-1 py-0.5 rounded">{perm.command || perm.title}</code>
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onReplyPermission(perm.id, 'allow')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition-colors"
                >
                  <CheckCircle className="w-3 h-3" />
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => onReplyPermission(perm.id, 'deny')}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-rose-300 font-medium text-[11px] transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Control bar: Model Selector Pill */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between text-xs select-none">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-slate-700/90 text-slate-300 hover:text-white border border-slate-700/60 transition-all shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-medium text-[11px] max-w-[130px] truncate">
              {selectedModel?.modelID || 'Select Model'}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Model dropdown */}
          {showModelPicker && (
            <div className="absolute bottom-full left-0 mb-2 w-64 max-h-60 overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 p-1.5 flex flex-col gap-1">
              <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Available OpenCode Models
              </div>
              {models.length === 0 ? (
                <div className="p-2 text-center text-slate-500 text-xs">No models reported by host</div>
              ) : (
                models.map((m) => {
                  const isSelected =
                    selectedModel?.modelID === m.id && selectedModel?.providerID === m.providerId;
                  return (
                    <button
                      key={`${m.providerId}-${m.id}`}
                      type="button"
                      onClick={() => {
                        onSelectModel({ providerID: m.providerId, modelID: m.id });
                        setShowModelPicker(false);
                      }}
                      className={`flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-medium truncate">{m.name || m.id}</p>
                        <p className="text-[10px] text-slate-500 truncate">{m.providerName || m.providerId}</p>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="text-[10px] text-slate-500 font-mono hidden sm:block">
          Shift + Enter for new line • Enter to send
        </div>
      </div>

      {/* Input row */}
      <div className="p-2.5 pt-1 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 max-h-40 resize-none rounded-xl bg-slate-950/80 border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all font-sans"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            title="Stop generation"
            className="p-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all shrink-0 cursor-pointer flex items-center justify-center animate-pulse"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim()}
            title="Send prompt"
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg shadow-indigo-600/25 transition-all shrink-0 cursor-pointer flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
