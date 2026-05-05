// Scrollable message list. Tracks "is at bottom" so new content only
// auto-scrolls when the user is already at the bottom.

import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import Message from './Message.jsx';

const HINTS = [
  'What can you help me with?',
  'Write a Python hello world',
  'Explain quantum computing',
  'Debug my code',
];

export default function Messages({ messages, loadingHistory, onHint }) {
  const scroller = useRef(null);
  const endRef   = useRef(null);
  const atBottom = useRef(true);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (atBottom.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (loadingHistory && messages.length === 0) {
    return (
      <div className="messages" ref={scroller}>
        <div className="history-loading">
          <span className="hist-spinner" />
          Loading conversation history…
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="messages" ref={scroller}>
        <div className="empty">
          <div className="empty-icon"><Bot size={28} /></div>
          <h2>Leonardo AI</h2>
          <p>Your intelligent AI assistant. Ask anything to get started.</p>
          <div className="hints">
            {HINTS.map((h) => (
              <button key={h} className="hint-chip" onClick={() => onHint(h)}>{h}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      <div className="messages-inner">
        {loadingHistory && (
          <div className="history-refresh-bar">
            <span className="hist-spinner" /> Refreshing…
          </div>
        )}
        {messages.map((msg) => (
          <Message key={msg.id} msg={msg} expanded={expanded} setExpanded={setExpanded} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
