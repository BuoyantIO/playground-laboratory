'use client';

import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../lib/i18n';
import { CheckIcon, CopyIcon } from './Icons';

interface MarkdownProps {
  content: string;
}

export function Markdown({ content }: MarkdownProps) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: props => (
            <h1
              className="mt-2 font-sans text-3xl font-medium tracking-tight text-navy md:text-4xl"
              {...props}
            />
          ),
          h2: props => (
            <h2
              className="mt-10 border-t border-navy-10 pt-8 font-sans text-2xl font-medium tracking-tight text-navy"
              {...props}
            />
          ),
          h3: props => (
            <h3
              className="mt-8 font-sans text-lg font-semibold text-navy"
              {...props}
            />
          ),
          h4: props => (
            <h4
              className="mt-6 font-sans text-base font-semibold text-navy-70"
              {...props}
            />
          ),
          p: props => (
            <p className="my-4 leading-relaxed text-navy-80" {...props} />
          ),
          ul: props => (
            <ul className="my-4 list-disc space-y-1.5 pl-6 text-navy-80" {...props} />
          ),
          ol: props => (
            <ol className="my-4 list-decimal space-y-1.5 pl-6 text-navy-80" {...props} />
          ),
          li: props => <li className="leading-relaxed" {...props} />,
          a: ({ href, ...props }) => {
            const external = href?.startsWith('http');
            return (
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                className="text-navy underline decoration-electric decoration-2 underline-offset-2 hover:text-electric"
                {...props}
              />
            );
          },
          blockquote: props => (
            <blockquote
              className="my-5 border-l-2 border-electric bg-navy-2 px-5 py-3 text-navy-70"
              {...props}
            />
          ),
          hr: () => <hr className="my-10 border-t border-navy-10" />,
          table: props => (
            <div className="my-6 overflow-x-auto rounded-card border border-gray1">
              <table className="w-full text-left text-sm" {...props} />
            </div>
          ),
          thead: props => (
            <thead className="bg-navy-3 font-mono text-xs uppercase tracking-wider text-navy-60" {...props} />
          ),
          th: props => (
            <th className="border-b border-navy-10 px-4 py-3 align-top font-medium" {...props} />
          ),
          td: props => (
            <td className="border-b border-navy-10 px-4 py-3 align-top text-navy-80" {...props} />
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = className?.startsWith('language-');
            if (isBlock) {
              return (
                <code className={`${className ?? ''}`} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-navy-5 px-1.5 py-0.5 font-mono text-[0.9em] text-navy"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          strong: props => (
            <strong className="font-semibold text-navy" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Recursively flatten the text content of a rendered node (the raw command text).
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  const el = node as { props?: { children?: ReactNode } };
  if (el.props?.children !== undefined) return extractText(el.props.children);
  return '';
}

// Copies the command to the clipboard so you can paste & run it.
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts (e.g. the dashboard served over plain
      // HTTP via Ingress, where navigator.clipboard is unavailable).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      // Pin the textarea to the current viewport so focusing/selecting it never
      // scrolls the page. A bare `position: fixed` with no offsets keeps the
      // element at its in-flow position, so select() jumps the panel to reveal it.
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.padding = '0';
      ta.style.border = 'none';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus({ preventScroll: true });
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const label = copied ? t('code.copied') : t('code.copy');
  return (
    <button
      type="button"
      // Don't let the click focus the button: focusing a control inside the
      // scrollable panel makes the browser scroll it into view, which reads as
      // the panel jumping. The click still fires and copies.
      onMouseDown={(e) => e.preventDefault()}
      onClick={copy}
      aria-label={label}
      title={label}
      className="absolute right-2 top-2 rounded-md border border-white/20 bg-white/10 p-1.5 text-electric transition hover:bg-white/20"
    >
      {copied ? (
        <CheckIcon className="h-4 w-4" />
      ) : (
        <CopyIcon className="h-4 w-4" />
      )}
    </button>
  );
}

// Renders a fenced code block. Command/manifest blocks (```sh, ```yaml, …) get
// an Apply button; plain output blocks (no language) do not.
function CodeBlock({ children }: { children: ReactNode }) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  const isCommand = (codeEl?.props?.className ?? '').startsWith('language-');
  const text = extractText(children).replace(/\n+$/, '');

  return (
    <div className="group relative my-5">
      <pre
        className={`overflow-x-auto rounded-card border border-navy-10 bg-navy px-4 py-4 font-mono text-[13px] leading-relaxed text-electric ${
          isCommand ? 'pr-12' : ''
        }`}
      >
        {children}
      </pre>
      {isCommand && <CopyButton text={text} />}
    </div>
  );
}
