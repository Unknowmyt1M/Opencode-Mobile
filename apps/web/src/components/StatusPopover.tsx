import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Server,
  Puzzle,
  RotateCw,
  Code,
} from 'lucide-react';
import type { McpServerInfo, LspItem } from '@opencode-remote/protocol';

interface StatusPopoverProps {
  mcps?: Record<string, McpServerInfo>;
  plugins?: string[];
  lsps?: LspItem[];
  onToggleMcp?: (name: string) => Promise<boolean>;
  isTogglingMcp?: string | null;
  onRefresh?: () => void;
  className?: string;
  compact?: boolean;
}

export const StatusPopover: React.FC<StatusPopoverProps> = ({
  mcps = {},
  plugins = [],
  lsps = [],
  onToggleMcp,
  isTogglingMcp,
  onRefresh,
  className = '',
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'mcp' | 'plugins' | 'lsp'>('mcp');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const mcpEntries = useMemo(() => {
    return Object.entries(mcps)
      .map(([name, info]) => ({
        name,
        status: info.status,
        error: info.error,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mcps]);

  const connectedCount = useMemo(
    () => mcpEntries.filter((m) => m.status === 'connected').length,
    [mcpEntries]
  );
  const totalMcp = mcpEntries.length;

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setLoading(false), 300);
    }
  };

  const handleRetryOrToggle = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleMcp) return;
    await onToggleMcp(name);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next && onRefresh) handleRefresh();
        }}
        className={`flex items-center space-x-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
          isOpen
            ? 'bg-[#252830] text-white border-blue-500/50 shadow-sm'
            : 'bg-[#18191d] hover:bg-[#202227] text-[#c9d1d9] hover:text-white border-white/[0.08]'
        }`}
        title="OpenCode MCP & Plugin Status"
      >
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="text-[11.5px] font-medium">
          {compact ? `MCP (${connectedCount}/${totalMcp})` : `MCP (${connectedCount}/${totalMcp})`}
        </span>
        {!compact && (
          <>
            <span className="text-white/20">•</span>
            <span className="text-[11px] text-[#8b949e]">
              Plugins ({plugins.length})
            </span>
          </>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setIsOpen(false)}
          />

          <div
            ref={popoverRef}
            className="absolute right-0 top-full mt-2 z-50 w-[360px] bg-[#16171b] border border-[#2d3139] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100 select-none text-left"
          >
            {/* Header Tabs */}
            <div className="p-1.5 bg-[#121316] border-b border-[#252830] flex items-center justify-between">
              <div className="flex items-center space-x-1">
                {[
                  { id: 'mcp', label: `MCP (${connectedCount}/${totalMcp})`, icon: Server },
                  { id: 'plugins', label: `Plugins (${plugins.length})`, icon: Puzzle },
                  { id: 'lsp', label: 'LSP', icon: Code },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-[#8b949e] hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                className="p-1 text-[#6e7681] hover:text-white hover:bg-white/[0.06] rounded transition-colors cursor-pointer"
                title="Refresh Status"
              >
                <RotateCw className={`w-3 h-3 ${loading ? 'animate-spin text-blue-400' : ''}`} />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-2 max-h-[360px] overflow-y-auto space-y-1">
              {/* Tab 1: MCP Servers */}
              {activeTab === 'mcp' && (
                <div className="space-y-1">
                  {mcpEntries.length === 0 ? (
                    <div className="py-6 text-center text-[#6e7681]">No MCPs configured in opencode.json</div>
                  ) : (
                    mcpEntries.map((item) => {
                      const isConn = item.status === 'connected';
                      const isNeedsAuth = item.status === 'needs_auth';
                      const isDisabled = item.status === 'disabled';
                      const isToggling = isTogglingMcp === item.name;

                      return (
                        <div
                          key={item.name}
                          className="px-2.5 py-2 rounded-lg bg-[#0e1013] border border-white/[0.04] hover:border-white/[0.08] flex items-center justify-between group transition-colors"
                        >
                          <div className="flex items-center space-x-2.5 truncate pr-2 min-w-0 flex-1">
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                                isConn
                                  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                                  : isNeedsAuth
                                  ? 'bg-amber-400'
                                  : isDisabled
                                  ? 'bg-zinc-600'
                                  : 'bg-red-400'
                              }`}
                            />
                            <div className="truncate min-w-0">
                              <span className="font-medium text-[12px] text-white truncate block">
                                {item.name}
                              </span>
                              <span
                                className="text-[10px] text-[#6e7681] capitalize block truncate max-w-[170px]"
                                title={
                                  isConn
                                    ? 'Connected'
                                    : isNeedsAuth
                                    ? 'OAuth Required'
                                    : isDisabled
                                    ? 'Disabled'
                                    : item.error || 'Failed to connect'
                                }
                              >
                                {isConn
                                  ? 'Connected'
                                  : isNeedsAuth
                                  ? 'OAuth Required'
                                  : isDisabled
                                  ? 'Disabled'
                                  : item.error || 'Failed to connect'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 flex-shrink-0">
                            {/* Status Badge */}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9.5px] font-semibold border transition-colors ${
                                isConn
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : isNeedsAuth
                                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                  : isDisabled
                                  ? 'bg-zinc-800/80 text-zinc-400 border-zinc-700/50'
                                  : 'bg-red-500/15 text-red-400 border-red-500/30'
                              }`}
                            >
                              {isToggling
                                ? 'Updating...'
                                : isConn
                                ? 'Active'
                                : isNeedsAuth
                                ? 'Auth'
                                : isDisabled
                                ? 'Disabled'
                                : 'Offline'}
                            </span>

                            {/* Retry button for failed servers */}
                            {!isConn && !isDisabled && (
                              <button
                                type="button"
                                onClick={(e) => handleRetryOrToggle(item.name, e)}
                                disabled={isToggling}
                                className="p-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#8b949e] hover:text-white transition-colors cursor-pointer"
                                title="Retry connection"
                              >
                                <RotateCw className={`w-3 h-3 ${isToggling ? 'animate-spin text-blue-400' : ''}`} />
                              </button>
                            )}

                            {/* Toggle Switch */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isConn}
                              disabled={isToggling}
                              onClick={(e) => handleRetryOrToggle(item.name, e)}
                              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-wait ${
                                isConn ? 'bg-emerald-500' : 'bg-[#2d3139] hover:bg-[#383d47]'
                              }`}
                              title={isConn ? `Turn off ${item.name}` : `Turn on ${item.name}`}
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                  isConn ? 'translate-x-3' : 'translate-x-0'
                                } flex items-center justify-center`}
                              >
                                {isToggling && (
                                  <RotateCw className="w-1.5 h-1.5 text-zinc-700 animate-spin" />
                                )}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Tab 2: Plugins */}
              {activeTab === 'plugins' && (
                <div className="space-y-1">
                  {plugins.length === 0 ? (
                    <div className="py-6 text-center text-[#6e7681]">No plugins loaded</div>
                  ) : (
                    plugins.map((pluginName) => (
                      <div
                        key={pluginName}
                        className="px-2.5 py-2 rounded-lg bg-[#0e1013] border border-white/[0.04] flex items-center justify-between group"
                      >
                        <div className="flex items-center space-x-2 truncate pr-2">
                          <Puzzle className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                          <span className="font-medium text-[12px] text-white truncate">
                            {pluginName}
                          </span>
                        </div>
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex-shrink-0">
                          Loaded
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: LSP */}
              {activeTab === 'lsp' && (
                <div className="space-y-1">
                  {lsps && lsps.length > 0 ? (
                    lsps.map((lsp, idx) => (
                      <div
                        key={lsp.id || idx}
                        className="px-2.5 py-2 rounded-lg bg-[#0e1013] border border-white/[0.04] flex items-center justify-between group"
                      >
                        <div className="flex items-center space-x-2 truncate pr-2">
                          <Code className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <span className="font-medium text-[12px] text-white truncate">
                            {lsp.name || lsp.id}
                          </span>
                        </div>
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 flex-shrink-0">
                          {lsp.status || 'Active'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center text-[#6e7681] space-y-1">
                      <Code className="w-5 h-5 mx-auto text-[#484f58]" />
                      <p className="text-xs">Language Server Protocol</p>
                      <p className="text-[10.5px] text-[#484f58]">TypeScript & Python LSPs auto-spawned per file</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 bg-[#0e1013] border-t border-[#252830] text-[10px] text-[#6e7681] flex items-center justify-between">
              <span>OpenCode Daemon (4096)</span>
              <span className="font-mono text-emerald-400">opencode.json</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
