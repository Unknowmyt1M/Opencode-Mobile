import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Monitor,
  ChevronDown,
  Plus,
  Trash2,
  X,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import type { DeviceInfo } from '@opencode-remote/protocol';

interface MachineSelectorProps {
  devices: DeviceInfo[];
  selectedDevice?: DeviceInfo;
  onSelectDevice: (deviceId: string) => void;
  onPairSubmit: (code: string) => Promise<{ success: boolean; message?: string }>;
  onRevokeDevice: (deviceId: string) => Promise<boolean>;
  onRefresh: () => void;
}

export function MachineSelector({
  devices,
  selectedDevice,
  onSelectDevice,
  onPairSubmit,
  onRevokeDevice,
  onRefresh,
}: MachineSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingFeedback, setPairingFeedback] = useState<string | null>(null);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingCode.trim()) return;

    setPairingLoading(true);
    setPairingFeedback(null);
    try {
      const res = await onPairSubmit(pairingCode.trim());
      if (res.success) {
        setPairingFeedback('Computer successfully paired!');
        setPairingCode('');
        setTimeout(() => setShowPairModal(false), 1200);
      } else {
        setPairingFeedback(res.message || 'Pairing failed. Check code.');
      }
    } catch (err: any) {
      setPairingFeedback(err.message || 'Pairing failed.');
    } finally {
      setPairingLoading(false);
    }
  };

  const getStatusDot = (device?: DeviceInfo) => {
    if (!device || !device.online) return 'bg-zinc-600';
    if (device.opencodeStatus === 'connected') return 'bg-emerald-400 shadow-sm shadow-emerald-500/50';
    if (device.opencodeStatus === 'checking') return 'bg-sky-400 animate-pulse';
    return 'bg-amber-400';
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors shadow-sm"
        >
          <span className={`w-2 h-2 rounded-full ${getStatusDot(selectedDevice)}`} />
          <span className="max-w-[120px] truncate">
            {selectedDevice ? selectedDevice.deviceName : 'No Computer'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-2 border-b border-zinc-800/80 flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400">
                Paired Computers
              </span>
              <button
                onClick={onRefresh}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Refresh Devices"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="py-1 max-h-60 overflow-y-auto space-y-1">
              {devices.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-zinc-500">
                  No computers connected yet
                </div>
              ) : (
                devices.map((d) => (
                  <div
                    key={d.deviceId}
                    className={`flex items-center justify-between p-2.5 rounded-xl transition-colors cursor-pointer ${
                      selectedDevice?.deviceId === d.deviceId
                        ? 'bg-indigo-600/20 border border-indigo-500/30 text-white'
                        : 'hover:bg-zinc-800/60 text-zinc-300'
                    }`}
                    onClick={() => {
                      onSelectDevice(d.deviceId);
                      setDropdownOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Monitor className="w-4 h-4 shrink-0 text-zinc-400" />
                      <div className="truncate">
                        <p className="text-xs font-medium truncate">{d.deviceName}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                          <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(d)}`} />
                          <span>{d.online ? (d.opencodeStatus === 'connected' ? 'OpenCode v' + (d.opencodeVersion || '1.18') : 'OpenCode off') : (d.paired ? 'Authorized • Offline' : 'Offline')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {d.paired && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Revoke pairing for ${d.deviceName}?`)) {
                              onRevokeDevice(d.deviceId);
                            }
                          }}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Revoke access"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800/80">
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  setShowPairModal(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Pair New Computer</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pairing Modal - Rendered via Portal to document.body to avoid header backdrop-filter containing-block issues */}
      {showPairModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 min-h-[100dvh]"
            onClick={(e) => {
              if (e.target === e.currentTarget && !pairingLoading) {
                setShowPairModal(false);
              }
            }}
          >
            <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 my-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">Pair With Computer</h3>
                    <p className="text-[11px] text-zinc-400">Enter code from Windows agent</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPairModal(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-zinc-950/70 rounded-xl p-3 border border-zinc-800/70 text-xs text-zinc-400 leading-relaxed text-center">
                Enter the 6-character one-time pairing code shown in your PC terminal.
              </div>

              <form onSubmit={handlePair} className="space-y-4">
                <div className="space-y-1">
                  <input
                    type="text"
                    value={pairingCode}
                    onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                    placeholder="529381 or 529-381"
                    maxLength={10}
                    className="w-full bg-zinc-950 border-2 border-indigo-500/50 focus:border-indigo-400 rounded-xl px-4 py-3.5 text-center text-2xl font-mono font-bold tracking-widest text-zinc-100 focus:outline-none shadow-inner"
                    autoFocus
                  />
                  <p className="text-[10px] text-zinc-500 text-center font-mono">
                    Dash '-' is optional
                  </p>
                </div>

                {pairingFeedback && (
                  <p
                    className={`text-xs text-center font-medium p-2.5 rounded-xl ${
                      pairingFeedback.includes('successfully') || pairingFeedback.includes('approved')
                        ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/50'
                        : 'text-rose-400 bg-rose-950/40 border border-rose-800/50'
                    }`}
                  >
                    {pairingFeedback}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPairModal(false)}
                    className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pairingLoading || !pairingCode.trim()}
                    className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-colors"
                  >
                    {pairingLoading ? 'Verifying...' : 'Pair Computer'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
