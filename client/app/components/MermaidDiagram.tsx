'use client';

import { useEffect, useId, useRef, useState } from 'react';

// Lazy-load mermaid once, client-side only: it's large and manipulates the DOM,
// so we keep it out of the server bundle and code-split it behind this import.
let mermaidMod: Promise<typeof import('mermaid')> | null = null;
function getMermaid() {
  if (!mermaidMod) mermaidMod = import('mermaid');
  return mermaidMod;
}

// Renders a ```mermaid fenced block as an SVG diagram, themed to match the
// playground palette. Falls back to the raw source if the diagram fails to parse.
export function MermaidDiagram({ chart }: { chart: string }) {
  const id = 'mmd-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setReady(false);
    getMermaid()
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: 'Inconsolata, ui-monospace, monospace',
          themeVariables: {
            background: '#ffffff',
            primaryColor: '#f2f5f7',
            primaryTextColor: '#003359',
            primaryBorderColor: '#003359',
            secondaryColor: '#e5fff4',
            secondaryBorderColor: '#02ca7c',
            tertiaryColor: '#f7f9fa',
            tertiaryBorderColor: '#ccd6de',
            lineColor: '#66859b',
            fontSize: '14px',
          },
        });
        return mermaid.render(id + '-svg', chart);
      })
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setReady(true);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="my-6 overflow-x-auto rounded-card border border-navy-10 bg-navy px-4 py-4 font-mono text-[13px] leading-relaxed text-electric">
        <code className="bg-transparent p-0">{chart}</code>
      </pre>
    );
  }

  return (
    <div
      role="img"
      aria-label="diagram"
      className={`my-6 overflow-x-auto rounded-card border border-navy-10 bg-white px-4 py-6 transition-opacity ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div ref={ref} className="w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto" />
    </div>
  );
}
