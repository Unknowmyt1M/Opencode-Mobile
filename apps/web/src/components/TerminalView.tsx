import { useState } from 'react';
import { Terminal, Shield, CheckCircle2, XCircle, Clock, Copy, Check } from 'lucide-react';
import type { SessionMessage } from '@opencode-remote/protocol';

interface TerminalViewProps {
  messages: SessionMessage[];
}

interface ToolExecution {
  id: string;
  tool: string;
  command?: string;
  input?: any;
  output?: string;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'error' | string;
  createdAt: number;
}

export function TerminalView({ messages }: TerminalViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Extract all tool executions from messages
  const toolExecutions: ToolExecution[] = [];

  for (const msg of messages) {
    if (!msg.parts) continue;
    for (const part of msg.parts) {
      if (part.type === 'tool' && part.tool) {
        const state = part.state || { status: 'completed' };
        let cmd = '';
        if (state.input && typeof state.input === 'object') {
          cmd = (state.input as any).command || (state.input as any).cmd || JSON.stringify(state.input);
        } else if (typeof state.input === 'string') {
          cmd = state.input;
        }

        let out = '';
        if (typeof state.output === 'string') {
          out = state.output;
        } else if (state.output) {
          out = JSON.stringify(state.output, null, 2);
        }

        toolExecutions.push({
          id: part.callID || part.id || `tool_${toolExecutions.length}`,
          tool: part.tool,
          command: cmd,
          input: state.input,
          output: out,
          error: state.error,
          status: state.status,
          createdAt: msg.createdAt,
        });
      }
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-3">
      {/* Capability Guardrail Notice */}
      <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-start gap-2.5">
        <Shield className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-zinc-400 leading-relaxed">
          <span className="font-semibold text-zinc-300">Audited Execution Stream</span>
          <p className="mt-0.5 text-zinc-500">
            Displays commands dispatched by OpenCode during reasoning steps. Arbitrary remote shell access is disabled by design.
          </p>
        </div>
      </div>

      {toolExecutions.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-300">No Tool Commands Run Yet</h4>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
              When OpenCode runs checks, tests, or bash tools, commands and terminal output will stream here.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {toolExecutions.map((exec) => (
            <div
              key={exec.id}
              className="rounded-2xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-md font-mono text-xs"
            >
              {/* Terminal Title Bar */}
              <div className="px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  <span className="text-[11px] font-semibold text-zinc-300">
                    tool: {exec.tool}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {exec.status === 'completed' && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>exit 0</span>
                    </span>
                  )}
                  {exec.status === 'error' && (
                    <span className="flex items-center gap-1 text-[10px] text-rose-400">
                      <XCircle className="w-3 h-3" />
                      <span>failed</span>
                    </span>
                  )}
                  {exec.status === 'running' && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 animate-pulse">
                      <Clock className="w-3 h-3" />
                      <span>running</span>
                    </span>
                  )}

                  {exec.output && (
                    <button
                      onClick={() => handleCopy(exec.id, exec.output || '')}
                      className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Copy Output"
                    >
                      {copiedId === exec.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Command Prompt */}
              {exec.command && (
                <div className="px-3.5 py-2 text-zinc-200 border-b border-zinc-900 bg-zinc-950/60 flex items-center gap-2">
                  <span className="text-emerald-400 font-bold select-none">$</span>
                  <span className="text-zinc-100 font-medium break-all">{exec.command}</span>
                </div>
              )}

              {/* Terminal Output */}
              {(exec.output || exec.error) && (
                <div className="p-3.5 text-[11px] leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-zinc-400 bg-black/40">
                  {exec.output}
                  {exec.error && (
                    <div className="text-rose-400 mt-1">{exec.error}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
