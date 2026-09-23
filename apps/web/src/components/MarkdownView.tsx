import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  language?: string;
  children: string;
}

const CodeBlock: React.FC<CodeBlockProps> = React.memo(({ language, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-xl border border-slate-800 bg-[#070a12] overflow-hidden text-xs font-mono shadow-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/80 border-b border-slate-800/80 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-300 uppercase tracking-wider">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-800"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 text-[10px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-slate-200 leading-5 scrollbar-thin scrollbar-thumb-slate-800">
        <code>{children}</code>
      </pre>
    </div>
  );
});

const MarkdownViewComponent: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-body text-xs text-slate-200 leading-relaxed select-text font-sans ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom Code Renderer (Block vs Inline)
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isInline = !match && !String(children).includes('\n');

            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800/90 text-indigo-300 font-mono text-[11px] border border-slate-700/60 break-all select-all"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock language={match ? match[1] : undefined}>
                {String(children).replace(/\n$/, '')}
              </CodeBlock>
            );
          },

          // GFM Tables with mobile horizontal scroll container
          table({ children }) {
            return (
              <div className="my-3 w-full overflow-x-auto rounded-xl border border-slate-800 shadow-sm scrollbar-thin scrollbar-thumb-slate-800">
                <table className="w-full text-left text-xs border-collapse bg-slate-900/50">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-slate-850/90 border-b border-slate-800 text-slate-200 font-semibold">{children}</thead>;
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-slate-800/60">{children}</tbody>;
          },
          tr({ children }) {
            return <tr className="hover:bg-slate-800/30 transition-colors">{children}</tr>;
          },
          th({ children }) {
            return <th className="px-3.5 py-2 text-[11px] font-semibold tracking-wide text-slate-300">{children}</th>;
          },
          td({ children }) {
            return <td className="px-3.5 py-2 text-xs text-slate-300 whitespace-nowrap sm:whitespace-normal">{children}</td>;
          },

          // Typography
          h1({ children }) {
            return <h1 className="text-base font-bold text-white mt-3.5 mb-1.5 tracking-tight border-b border-slate-800/80 pb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-sm font-semibold text-white mt-3 mb-1 tracking-tight">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-xs font-semibold text-slate-100 mt-2.5 mb-1">{children}</h3>;
          },
          h4({ children }) {
            return <h4 className="text-xs font-medium text-slate-200 mt-2 mb-0.5">{children}</h4>;
          },
          p({ children }) {
            return <p className="leading-relaxed my-1.5 text-slate-200 last:mb-0 first:mt-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc list-inside space-y-1 my-2 pl-1 text-slate-300">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside space-y-1 my-2 pl-1 text-slate-300">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-indigo-500/70 pl-3 my-2.5 text-slate-400 italic bg-slate-900/30 py-1.5 rounded-r-lg">
                {children}
              </blockquote>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 break-all transition-colors font-medium"
              >
                {children}
              </a>
            );
          },
          hr() {
            return <hr className="my-3 border-slate-800" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownView = React.memo(MarkdownViewComponent, (prevProps, nextProps) => {
  return prevProps.content === nextProps.content && prevProps.className === nextProps.className;
});
