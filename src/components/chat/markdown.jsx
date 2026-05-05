// Shared markdown renderer plumbing — used by both the assistant bubble
// and the system/command bubble.

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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

export const mdComponents = {
  code({ className, children }) {
    const m = /language-(\w+)/.exec(className || '');
    return m
      ? <CodeBlock language={m[1]}>{children}</CodeBlock>
      : <code>{children}</code>;
  },
  pre({ children }) { return <>{children}</>; },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};
