import { useState } from 'react';
import {
  X,
  FileCode,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Download,
  Copy,
  Check,
  Calendar,
  HardDrive,
} from 'lucide-react';
import type { TimelineUpload } from '../utils/timelineSelectors';
import { MarkdownView } from './MarkdownView';

interface UploadPreviewModalProps {
  upload: TimelineUpload | null;
  onClose: () => void;
}

export function UploadPreviewModal({ upload, onClose }: UploadPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  if (!upload) return null;

  const isImage =
    upload.mime?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(upload.filename);

  const isJson =
    upload.mime?.includes('json') ||
    upload.filename.endsWith('.json');

  const isMarkdown =
    upload.mime?.includes('markdown') ||
    /\.(md|mdx|markdown)$/i.test(upload.filename);

  const isCodeOrText =
    upload.mime?.startsWith('text/') ||
    isJson ||
    isMarkdown ||
    /\.(ts|tsx|js|jsx|py|html|css|scss|json|yaml|yml|sh|bash|sql|rs|go|c|cpp|h)$/i.test(
      upload.filename
    );

  const isPdf =
    upload.mime?.includes('pdf') ||
    upload.filename.toLowerCase().endsWith('.pdf');

  const formattedDate = new Date(upload.createdAt).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCopyContent = async () => {
    if (!upload.url) return;
    try {
      await navigator.clipboard.writeText(upload.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload Preview"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            {isImage ? (
              <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : isCodeOrText ? (
              <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
            ) : isPdf ? (
              <FileText className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <FileIcon className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            <h3 className="font-semibold text-sm text-slate-200 truncate">
              {upload.filename}
            </h3>
            {upload.size && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {upload.size}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview Content Area */}
        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {/* Metadata pill */}
          <div className="flex items-center gap-4 mb-4 p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/60 text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Uploaded:</span>
              <span className="text-slate-300">{formattedDate}</span>
            </div>
            {upload.mime && (
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                <span>Type:</span>
                <span className="text-slate-300">{upload.mime}</span>
              </div>
            )}
          </div>

          {/* Type-Specific Preview */}
          {isImage && upload.url ? (
            <div className="flex items-center justify-center p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 max-h-[60vh] overflow-hidden">
              <img
                src={upload.url}
                alt={upload.filename}
                className="max-h-[55vh] max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : isMarkdown && upload.url ? (
            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 max-h-[60vh] overflow-y-auto">
              <MarkdownView content={upload.url} />
            </div>
          ) : isJson && upload.url ? (
            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 max-h-[60vh] overflow-y-auto font-mono text-[11px] text-emerald-300 whitespace-pre-wrap">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(upload.url), null, 2);
                } catch {
                  return upload.url;
                }
              })()}
            </div>
          ) : isCodeOrText && upload.url ? (
            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 max-h-[60vh] overflow-y-auto font-mono text-[11px] text-slate-200 whitespace-pre-wrap">
              {upload.url}
            </div>
          ) : isPdf && upload.url ? (
            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 flex flex-col items-center justify-center space-y-3 min-h-[220px]">
              <FileText className="w-12 h-12 text-rose-400" />
              <div className="text-center">
                <div className="font-semibold text-slate-200">{upload.filename}</div>
                <div className="text-slate-500 text-[11px] mt-0.5">PDF Document</div>
              </div>
              <a
                href={upload.url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Open / Download PDF</span>
              </a>
            </div>
          ) : (
            <div className="p-8 bg-slate-950/80 rounded-xl border border-slate-800/80 text-center space-y-3">
              <FileIcon className="w-10 h-10 text-slate-500 mx-auto" />
              <div>
                <p className="font-medium text-slate-200">{upload.filename}</p>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  Binary attachment ({upload.size || upload.mime || 'file'})
                </p>
              </div>
              {upload.url && (
                <a
                  href={upload.url}
                  download={upload.filename}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download file</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
          <div>
            {upload.url && typeof upload.url === 'string' && upload.url.length > 0 && (
              <button
                type="button"
                onClick={handleCopyContent}
                className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied content</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy content</span>
                  </>
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
