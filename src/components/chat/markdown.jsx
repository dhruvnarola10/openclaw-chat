// Shared markdown renderer plumbing — used by the assistant bubble, the
// system/command bubble, and the workspace task transcript.

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Single source of truth for the remark plugin list so every render site
// behaves identically.
//   • remarkGfm    — tables, strikethrough, autolinks, task lists.
//   • remarkBreaks — render a single "\n" as a hard line break. CommonMark
//                     collapses single newlines into spaces, which mangled
//                     CLI-style command output (e.g. `/model`, `/status`)
//                     into one run-on line. Chat + terminal output is
//                     line-oriented, so this is the correct behaviour for
//                     ALL response types here.
export const mdRemarkPlugins = [remarkGfm, remarkBreaks];

export function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {}
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button className={`copy-btn${done ? ' copied' : ''}`} onClick={copy}>
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function CodeBlock({ language, children }) {
  const code = String(children).replace(/\n$/, '');
  return (
    <div className="code-wrap">
      <div className="code-header">
        <span className="code-lang">{language || 'plaintext'}</span>
        <CopyBtn text={code} />
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '14px 16px',
          background: '#141414',
          fontSize: '13px',
          lineHeight: '1.6',
          borderRadius: '0 0 12px 12px',
        }}
        codeTagProps={{ style: { fontFamily: "'SF Mono','Fira Code',Consolas,monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

// Why the split between `pre` and `code` is structured this way:
//
//   react-markdown emits a fenced code block as <pre><code class="language-X">…
//   and inline code as <code>…</code> (inside a <p> or similar block parent).
//
//   We used to detect fenced blocks inside the `code` override and return a
//   <CodeBlock> (a <div>) from there. During streaming the grammar
//   oscillates between inline and block classifications for the same
//   backticks — so react would briefly try to render a <div> inside the
//   current paragraph. The browser silently auto-closes the <p> (illegal
//   nesting), the real DOM diverges from React's virtual DOM, and the next
//   render explodes with "removeChild: not a child of this node".
//
//   Doing the block-replacement in the `pre` slot keeps the <div>
//   substitution at a block boundary where it's always valid.
export const mdComponents = {
  // Inline code only — fenced blocks come through `pre` below.
  code({ className, children, ...rest }) {
    return <code className={className} {...rest}>{children}</code>;
  },
  // Replace the whole <pre><code …>…</code></pre> with our <CodeBlock>.
  pre({ children }) {
    // react-markdown 9 passes a single React element here; older variants
    // may pass an array. Handle both defensively.
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === 'object' && child.props) {
      const m = /language-(\w+)/.exec(child.props.className ?? '');
      return (
        <CodeBlock language={m?.[1]}>
          {child.props.children}
        </CodeBlock>
      );
    }
    return <pre>{children}</pre>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};
