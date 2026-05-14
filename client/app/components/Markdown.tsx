'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
          pre: ({ children, ...props }) => (
            <pre
              className="my-5 overflow-x-auto rounded-card border border-navy-10 bg-navy px-4 py-4 font-mono text-[13px] leading-relaxed text-electric"
              {...props}
            >
              {children}
            </pre>
          ),
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
