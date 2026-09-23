import React from 'react';
import {
  X,
  Zap,
  Cpu,
  Coins,
  Brain,
  Layers,
  Database,
  ArrowDownToLine,
} from 'lucide-react';
import type { SessionTelemetry } from '../useRelay';

interface SessionTelemetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: SessionTelemetry | null;
  onCompact?: () => void;
  isCompacting?: boolean;
}

export const SessionTelemetryModal: React.FC<SessionTelemetryModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  onCompact,
  isCompacting = false,
}) => {
  if (!isOpen) return null;

  const total = telemetry?.totalTokens || 0;
  const limit = telemetry?.contextLimit || 200000;
  const usage = telemetry?.usagePercent ?? (limit ? Math.min(100, Math.round((total / limit) * 100)) : 0);

  // Health color
  const statusColor =
    usage > 85 ? 'text-rose-400' : usage > 60 ? 'text-amber-400' : 'text-emerald-400';
  const statusBg =
    usage > 85 ? 'bg-rose-500/10 border-rose-500/30' : usage > 60 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30';
  const statusLabel =
    usage > 85 ? 'Heavy Load (>85%)' : usage > 60 ? 'Moderate (>60%)' : 'Optimal (<60%)';

  // Bar percentages
  const inputPct = total > 0 ? ((telemetry?.inputTokens || 0) / total) * 100 : 0;
  const outputPct = total > 0 ? ((telemetry?.outputTokens || 0) / total) * 100 : 0;
  const reasoningPct = total > 0 ? ((telemetry?.reasoningTokens || 0) / total) * 100 : 0;
  const cachePct = total > 0 ? ((telemetry?.cacheReadTokens || 0) / total) * 100 : 0;

  // Circular Gauge math
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(usage, 100) / 100) * circumference;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Context & Token Telemetry
              </h2>
              <p className="text-xs text-slate-400">
                {telemetry?.modelLabel || 'Active Session'} {telemetry?.providerLabel ? `· ${telemetry.providerLabel}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
          {/* Main Ring & Overview Banner */}
          <div className="flex items-center gap-5 p-4 rounded-xl bg-slate-800/40 border border-slate-800">
            <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 96 96">
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  className="text-slate-800"
                  strokeWidth="7"
                  stroke="currentColor"
                  fill="transparent"
                />
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  className={usage > 85 ? 'text-rose-500' : usage > 60 ? 'text-amber-500' : 'text-emerald-500'}
                  strokeWidth="7"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                  style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-bold font-mono text-slate-100">{usage}%</span>
                <span className="text-[10px] text-slate-400">Context</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBg} ${statusColor}`}>
                  {statusLabel}
                </span>
              </div>
              <div className="text-xs text-slate-300">
                <span className="font-semibold text-slate-100 font-mono">
                  {total.toLocaleString()}
                </span>{' '}
                / <span className="text-slate-400 font-mono">{limit.toLocaleString()}</span> tokens used
              </div>
              {telemetry && telemetry.totalCost > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                  <Coins className="w-3.5 h-3.5" />
                  <span>Est. Session Cost: ${telemetry.totalCost.toFixed(4)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Color-Coded Token Composition Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Token Composition</span>
              <span className="font-mono text-[11px]">{total.toLocaleString()} tokens</span>
            </div>
            <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden flex shadow-inner">
              {inputPct > 0 && (
                <div
                  style={{ width: `${inputPct}%` }}
                  className="h-full bg-blue-500 hover:opacity-90 transition-all duration-300"
                  title={`Input: ${telemetry?.inputTokens.toLocaleString()} (${inputPct.toFixed(1)}%)`}
                />
              )}
              {reasoningPct > 0 && (
                <div
                  style={{ width: `${reasoningPct}%` }}
                  className="h-full bg-violet-500 hover:opacity-90 transition-all duration-300"
                  title={`Reasoning: ${telemetry?.reasoningTokens.toLocaleString()} (${reasoningPct.toFixed(1)}%)`}
                />
              )}
              {outputPct > 0 && (
                <div
                  style={{ width: `${outputPct}%` }}
                  className="h-full bg-indigo-500 hover:opacity-90 transition-all duration-300"
                  title={`Output: ${telemetry?.outputTokens.toLocaleString()} (${outputPct.toFixed(1)}%)`}
                />
              )}
              {cachePct > 0 && (
                <div
                  style={{ width: `${cachePct}%` }}
                  className="h-full bg-emerald-500 hover:opacity-90 transition-all duration-300"
                  title={`Cache Read: ${telemetry?.cacheReadTokens.toLocaleString()} (${cachePct.toFixed(1)}%)`}
                />
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 shrink-0" />
                <span>Input ({inputPct.toFixed(0)}%)</span>
              </div>
              {reasoningPct > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 shrink-0" />
                  <span>Thinking ({reasoningPct.toFixed(0)}%)</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 shrink-0" />
                <span>Output ({outputPct.toFixed(0)}%)</span>
              </div>
              {cachePct > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
                  <span>Cache ({cachePct.toFixed(0)}%)</span>
                </div>
              )}
            </div>
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800/60">
              <div className="flex items-center gap-1.5 text-xs text-blue-400 mb-1">
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>Input Tokens</span>
              </div>
              <div className="text-base font-bold font-mono text-slate-100">
                {(telemetry?.inputTokens || 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">History & Prompts</div>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800/60">
              <div className="flex items-center gap-1.5 text-xs text-indigo-400 mb-1">
                <Zap className="w-3.5 h-3.5" />
                <span>Output Tokens</span>
              </div>
              <div className="text-base font-bold font-mono text-slate-100">
                {(telemetry?.outputTokens || 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">Model responses</div>
            </div>

            {telemetry && (telemetry.reasoningTokens > 0) && (
              <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800/60">
                <div className="flex items-center gap-1.5 text-xs text-violet-400 mb-1">
                  <Brain className="w-3.5 h-3.5" />
                  <span>Reasoning Tokens</span>
                </div>
                <div className="text-base font-bold font-mono text-slate-100">
                  {telemetry.reasoningTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500">CoT thinking tokens</div>
              </div>
            )}

            {telemetry && (telemetry.cacheReadTokens > 0 || telemetry.cacheWriteTokens > 0) && (
              <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800/60">
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-1">
                  <Database className="w-3.5 h-3.5" />
                  <span>Cache Efficiency</span>
                </div>
                <div className="text-base font-bold font-mono text-slate-100">
                  {(telemetry.cacheReadTokens || 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500">Cached tokens reused</div>
              </div>
            )}
          </div>

          {/* Quick Action: Compact Session */}
          {onCompact && (
            <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/20 space-y-2.5">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Context Compaction
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Summarizes older conversation turns into a dense briefing, freeing up context window capacity.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onCompact}
                disabled={isCompacting}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-md shadow-indigo-900/30"
              >
                {isCompacting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Compacting Conversation...</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-3.5 h-3.5" />
                    <span>Trigger Session Compaction</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
