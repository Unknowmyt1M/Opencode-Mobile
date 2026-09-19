import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as TerminalIcon, Plus, X, RefreshCw } from 'lucide-react';
import type { PtySession } from '@opencode-remote/protocol';

interface XtermTerminalProps {
  ptys: PtySession[];
  activePtyId: string | null;
  onSelectPty: (id: string) => void;
  onCreatePty: (title?: string) => Promise<PtySession | null>;
  onClosePty: (id: string) => void;
  onSendInput: (ptyId: string, data: string) => void;
  onResize: (ptyId: string, cols: number, rows: number) => void;
  subscribeData: (ptyId: string, cb: (data: string) => void) => () => void;
  onRefresh: () => void;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  ptys,
  activePtyId,
  onSelectPty,
  onCreatePty,
  onClosePty,
  onSendInput,
  onResize,
  subscribeData,
  onRefresh,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || !activePtyId) return;

    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace, Consolas',
      theme: {
        background: '#090d16',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: '#312e81',
        black: '#0f172a',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f8fafc',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#38bdf8',
        brightWhite: '#ffffff',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    onResize(activePtyId, term.cols, term.rows);

    const onDataDisposable = term.onData((data) => {
      onSendInput(activePtyId, data);
    });

    const unsubscribe = subscribeData(activePtyId, (data) => {
      term.write(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        onResize(activePtyId, term.cols, term.rows);
      } catch {}
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      onDataDisposable.dispose();
      unsubscribe();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activePtyId, onSendInput, onResize, subscribeData]);

  const quickCommands = [
    { label: 'ls', cmd: 'dir\r' },
    { label: 'git status', cmd: 'git status\r' },
    { label: 'pnpm test', cmd: 'pnpm test\r' },
    { label: 'clear', cmd: 'cls\r' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#090d16] text-slate-200">
      {/* Tabs & Controls Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs select-none">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-[70%]">
          {ptys.map((pty) => {
            const isActive = pty.id === activePtyId;
            return (
              <div
                key={pty.id}
                onClick={() => onSelectPty(pty.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-colors shrink-0 ${
                  isActive
                    ? 'bg-slate-800 text-indigo-400 font-medium border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                <span className="truncate max-w-[100px]">{pty.title || 'Terminal'}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClosePty(pty.id);
                  }}
                  className="text-slate-500 hover:text-rose-400 ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onCreatePty()}
            title="Open new terminal tab"
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh terminals"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Bar */}
      {activePtyId && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 border-b border-slate-800/60 overflow-x-auto text-[11px] scrollbar-none">
          <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Quick:</span>
          {quickCommands.map((qc) => (
            <button
              key={qc.label}
              type="button"
              onClick={() => onSendInput(activePtyId, qc.cmd)}
              className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-indigo-300 font-mono transition-colors shrink-0 border border-slate-700/50"
            >
              {qc.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="flex-1 relative overflow-hidden p-2">
        {ptys.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/50 text-indigo-400">
              <TerminalIcon className="w-8 h-8" />
            </div>
            <div>
              <p className="font-medium text-slate-200">No active OpenCode terminal</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Launch a live interactive terminal session connected directly to OpenCode host.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCreatePty('PowerShell')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Launch Terminal
            </button>
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-full" />
        )}
      </div>
    </div>
  );
};
