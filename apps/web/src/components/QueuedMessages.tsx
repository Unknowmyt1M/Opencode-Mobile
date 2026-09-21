import React, { useState } from 'react';
import {
  ChevronDown,
  ArrowUp,
  Pencil,
  Trash2,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { QueuedMessage } from '../types/queue';

interface QueuedMessagesProps {
  queue: QueuedMessage[];
  isStreaming?: boolean;
  onSendNow: (id: string) => void;
  onEdit: (item: QueuedMessage) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
}

export const QueuedMessages: React.FC<QueuedMessagesProps> = ({
  queue,
  isStreaming = false,
  onSendNow,
  onEdit,
  onDelete,
  onRetry,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!queue || queue.length === 0) {
    return null;
  }

  const firstItem = queue[0];
  const hasFailedItem = queue.some((m) => m.status === 'failed');
  const isDispatching = queue.some((m) => m.status === 'sending');

  // Dynamic header status
  const statusText = hasFailedItem
    ? "Couldn't send queued message"
    : isDispatching
    ? 'Sending next message…'
    : 'Sends after agent finishes work';

  return (
    <div
      role="region"
      aria-label="Queued Messages"
      className="w-full bg-slate-900/95 border border-slate-800/90 rounded-2xl shadow-xl backdrop-blur-md overflow-hidden transition-all duration-200 motion-reduce:transition-none"
    >
      {/* Header Row */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-xs text-slate-200 tracking-tight shrink-0">
            Queued Messages
          </span>
          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-500/30 shrink-0">
            {queue.length}
          </span>
          <span
            className={`text-xs truncate ${
              hasFailedItem ? 'text-rose-400 font-medium' : 'text-slate-400'
            }`}
          >
            {statusText}
          </span>
        </div>

        <button
          type="button"
          aria-label={isExpanded ? 'Collapse queued messages' : 'Expand queued messages'}
          className="w-11 h-11 -mr-2 flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer shrink-0 rounded-lg hover:bg-slate-800/60 transition-transform duration-200 motion-reduce:transition-none"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 motion-reduce:transition-none ${
              isExpanded ? 'rotate-180 text-indigo-400' : ''
            }`}
          />
        </button>
      </div>

      {/* =========================================================================
          COLLAPSED STATE PREVIEW (Shows when NOT expanded)
          ========================================================================= */}
      {!isExpanded && firstItem && (
        <div className="px-3.5 pb-2.5 pt-0.5 flex items-center justify-between gap-3 border-t border-slate-800/50">
          {/* Message Preview Clamped to 2 lines */}
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed break-words">
              {firstItem.content}
            </p>
            {firstItem.status === 'failed' && (
              <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1 font-mono truncate">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{firstItem.error || 'Failed to dispatch'}</span>
              </p>
            )}
          </div>

          {/* Right Action Buttons (>=44px touch targets) */}
          <div className="flex items-center shrink-0 -mr-1">
            {firstItem.status === 'failed' ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(firstItem.id);
                }}
                title="Retry sending message"
                className="w-11 h-11 flex items-center justify-center rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : firstItem.status === 'sending' ? (
              <div className="w-11 h-11 flex items-center justify-center text-indigo-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSendNow(firstItem.id);
                }}
                title={isStreaming ? 'Send next (move to front of queue)' : 'Send now'}
                className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-950/40 transition-colors cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(firstItem);
              }}
              title="Edit message"
              className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(firstItem.id);
              }}
              title="Delete from queue"
              className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          EXPANDED STATE LIST (Shows full queue when expanded)
          ========================================================================= */}
      {isExpanded && (
        <div className="border-t border-slate-800/80 divide-y divide-slate-800/60 max-h-64 sm:max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
          {queue.map((item, idx) => (
            <div
              key={item.id}
              className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/20 transition-colors"
            >
              {/* Item Index + Message Content */}
              <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-1">
                <span className="text-xs font-mono font-bold text-slate-500 shrink-0 mt-0.5 w-4 text-center">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-200 leading-relaxed break-words whitespace-pre-wrap">
                    {item.content}
                  </p>
                  {item.status === 'failed' && (
                    <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1 font-mono truncate">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{item.error || 'Send failed'}</span>
                    </p>
                  )}
                  {item.status === 'sending' && (
                    <p className="text-[11px] text-indigo-400 flex items-center gap-1 mt-1 font-mono">
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      <span>Dispatching…</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Right-Side Item Actions (>=44px touch targets) */}
              <div className="flex items-center shrink-0 -mr-1">
                {item.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(item.id);
                    }}
                    title="Retry sending message"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                ) : item.status === 'sending' ? (
                  <div className="w-11 h-11 flex items-center justify-center text-indigo-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendNow(item.id);
                    }}
                    title={
                      isStreaming
                        ? idx === 0
                          ? 'Already first in queue'
                          : 'Move to front of queue'
                        : 'Send now'
                    }
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-950/40 transition-colors cursor-pointer"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(item);
                  }}
                  title="Edit message"
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  title="Delete from queue"
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
