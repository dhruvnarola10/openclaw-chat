import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Settings, Square, ChevronDown, ChevronRight,
  Bot, Brain, Copy, Check, Trash2, X, Plus, Zap, MessageSquare, Radio, RefreshCw, Terminal,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/* ─── Helpers ────────────────────────────────────────────────────── */
const genId  = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const clip   = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
const relDay = ts => {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const t = new Date();   t.setHours(0,0,0,0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7)  return 'Previous 7 days';
  if (diff <= 30) return 'Previous 30 days';
  return 'Older';
};

function groupThreads(threads) {
  const order = ['Today','Yesterday','Previous 7 days','Previous 30 days','Older'];
  const map = {};
  for (const t of [...threads].sort((a,b) => b.updatedAt - a.updatedAt)) {
    const g = relDay(t.updatedAt);
    (map[g] ??= []).push(t);
  }
  return order.filter(k => map[k]).map(k => [k, map[k]]);
}

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

/* ─── Channel metadata ───────────────────────────────────────────── */
const CHANNELS = {
  telegram:  { label: 'Telegram',  abbr: 'TG', color: '#2AABEE' },
  slack:     { label: 'Slack',     abbr: 'SL', color: '#4A154B' },
  whatsapp:  { label: 'WhatsApp',  abbr: 'WA', color: '#25D366' },
  discord:   { label: 'Discord',   abbr: 'DC', color: '#5865F2' },
  signal:    { label: 'Signal',    abbr: 'SG', color: '#3A76F0' },
  imessage:  { label: 'iMessage',  abbr: 'iM', color: '#1DC855' },
  webchat:   { label: 'Web Chat',  abbr: 'WC', color: '#7c3aed' },
  web:       { label: 'Web',       abbr: 'WB', color: '#7c3aed' },
  internal:  { label: 'Internal',  abbr: 'IN', color: '#64748b' },
  main:      { label: 'Dashboard', abbr: 'DB', color: '#64748b' },
  email:     { label: 'Email',     abbr: 'EM', color: '#f59e0b' },
  sms:       { label: 'SMS',       abbr: 'SM', color: '#10b981' },
};
const channelMeta = ch => CHANNELS[ch?.toLowerCase()] ?? { label: ch || 'Unknown', abbr: (ch||'??').slice(0,2).toUpperCase(), color: '#555' };

const ago = ts => {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000)    return 'just now';
  if (d < 3600000)  return `${Math.round(d/60000)}m ago`;
  if (d < 86400000) return `${Math.round(d/3600000)}h ago`;
  return `${Math.round(d/86400000)}d ago`;
};

/* Parse "agent:<agentId>:<channel>:<peer>" → { agentId, channel, peer } */
function parseKey(key = '') {
  const parts = key.split(':');
  if (parts[0] !== 'agent' || parts.length < 3) return { agentId: '?', channel: 'unknown', peer: key };
  return { agentId: parts[1], channel: parts[2], peer: parts.slice(3).join(':') || '—' };
}

/* ─── Copy Button ────────────────────────────────────────────────── */
function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {}
    setDone(true); setTimeout(() => setDone(false), 2000);
  };
  return (
    <button className={`copy-btn${done ? ' copied' : ''}`} onClick={copy}>
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied!' : 'Copy'}
    </button>
  );
}

/* ─── Code Block ─────────────────────────────────────────────────── */
function CodeBlock({ language, children }) {
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
        customStyle={{ margin:0, padding:'14px 16px', background:'#141414', fontSize:'13px', lineHeight:'1.6', borderRadius:'0 0 12px 12px' }}
        codeTagProps={{ style:{ fontFamily:"'SF Mono','Fira Code',Consolas,monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const mdComponents = {
  code({ className, children }) {
    const m = /language-(\w+)/.exec(className || '');
    return m ? <CodeBlock language={m[1]}>{children}</CodeBlock> : <code>{children}</code>;
  },
  pre({ children }) { return <>{children}</>; },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>; },
};

/* ─── Thinking Block ─────────────────────────────────────────────── */
function ThinkingBlock({ content, streaming, expanded, onToggle }) {
  return (
    <div className="thinking">
      <button className="thinking-head" onClick={onToggle}>
        <Brain size={13} />
        <span>{streaming ? 'Thinking…' : 'Thought process'}</span>
        <span className="thinking-spacer" />
        {streaming && <span className="thinking-spinner" />}
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && (
        <div className="thinking-body">
          <p>{content}{streaming && <span className="cursor" />}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Message ────────────────────────────────────────────────────── */
function Message({ msg, expanded, setExpanded }) {
  const id = msg.id;
  const toggle = useCallback(() => setExpanded(p => ({ ...p, [id]: !p[id] })), [id, setExpanded]);
  const isExpanded = expanded[id] === true;

  /* User message */
  if (msg.role === 'user') {
    if (msg.isCommand) {
      return (
        <div className="msg-row cmd-sent-row">
          <span className="cmd-sent-pill">{msg.content}</span>
        </div>
      );
    }
    return (
      <div className="msg-row user">
        <div className="user-bubble">{msg.content}</div>
        <div className="avatar avatar-user">You</div>
      </div>
    );
  }

  /* System / command response */
  if (msg.isCommand) {
    return (
      <div className="msg-row system-row">
        <div className="system-icon-wrap"><Terminal size={13} /></div>
        <div className="system-bubble">
          {msg.waiting && !msg.content && (
            <div className="thinking-dots" style={{ padding: '6px 0' }}>
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          )}
          {msg.content && (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
              {msg.streaming && <span className="cursor" />}
            </>
          )}
          {!msg.streaming && msg.content && (
            <div className="system-footer">system</div>
          )}
        </div>
      </div>
    );
  }

  /* Regular assistant message */
  return (
    <div className="msg-row assistant">
      <div className="avatar avatar-bot"><Bot size={16} /></div>
      <div className="asst">
        {(msg.thinking || msg.thinkingStreaming) && (
          <ThinkingBlock content={msg.thinking || ''} streaming={msg.thinkingStreaming} expanded={isExpanded} onToggle={toggle} />
        )}
        {msg.waiting && !msg.content && (
          <div className="thinking-dots">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}
        {msg.content && (
          <div className={`asst-msg${msg.isError ? ' error-msg' : ''}`}>
            {msg.isError
              ? <pre style={{ whiteSpace:'pre-wrap', fontFamily:'inherit' }}>{msg.content}</pre>
              : <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
            }
            {msg.streaming && <span className="cursor" />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Slash Commands ─────────────────────────────────────────────── */
const SLASH_COMMANDS = [
  { cmd: '/help',        desc: 'Show help summary',                              cat: 'Info'     },
  { cmd: '/commands',    desc: 'List all available commands',                    cat: 'Info'     },
  { cmd: '/status',      desc: 'Show runtime execution / quota info',            cat: 'Info'     },
  { cmd: '/whoami',      desc: 'Show your sender ID',                            cat: 'Info'     },
  { cmd: '/tools',       desc: 'Display agent capabilities',                     cat: 'Info'     },
  { cmd: '/usage',       desc: 'Show token usage and cost summary',              cat: 'Info'     },
  { cmd: '/context',     desc: 'Explain context assembly',                       cat: 'Info'     },
  { cmd: '/new',         desc: 'Start a new session',                            cat: 'Session'  },
  { cmd: '/reset',       desc: 'Reset session history',                          cat: 'Session'  },
  { cmd: '/compact',     desc: 'Compress session context',                       cat: 'Session'  },
  { cmd: '/stop',        desc: 'Abort the current run',                          cat: 'Session'  },
  { cmd: '/model',       desc: 'Show or set current model',                      cat: 'Model'    },
  { cmd: '/models',      desc: 'List available models and providers',            cat: 'Model'    },
  { cmd: '/think',       desc: 'Set thinking level (off / low / medium / high)', cat: 'Model'   },
  { cmd: '/fast',        desc: 'Toggle fast mode on or off',                     cat: 'Model'    },
  { cmd: '/reasoning',   desc: 'Toggle reasoning output visibility',             cat: 'Model'    },
  { cmd: '/elevated',    desc: 'Toggle elevated permission mode',                cat: 'Model'    },
  { cmd: '/verbose',     desc: 'Toggle verbose output',                          cat: 'Output'   },
  { cmd: '/trace',       desc: 'Toggle plugin trace output',                     cat: 'Output'   },
  { cmd: '/btw',         desc: 'Ask a side question without changing context',   cat: 'Advanced' },
  { cmd: '/skill',       desc: 'Run a skill by name',                            cat: 'Advanced' },
  { cmd: '/queue',       desc: 'Manage queue behavior',                          cat: 'Advanced' },
  { cmd: '/steer',       desc: 'Inject guidance into an active run',             cat: 'Advanced' },
  { cmd: '/subagents',   desc: 'Manage sub-agent runs',                          cat: 'Advanced' },
  { cmd: '/approve',     desc: 'Resolve exec approval prompts',                  cat: 'Advanced' },
  { cmd: '/config',      desc: 'Read or write openclaw.json config',             cat: 'Admin'    },
  { cmd: '/plugins',     desc: 'Inspect or mutate plugins',                      cat: 'Admin'    },
  { cmd: '/restart',     desc: 'Restart OpenClaw',                               cat: 'Admin'    },
  { cmd: '/diagnostics', desc: 'Generate a support diagnostics report',          cat: 'Admin'    },
  { cmd: '/bash',        desc: 'Run a shell command (requires bash enabled)',     cat: 'Admin'    },
];

/* ─── App ────────────────────────────────────────────────────────── */
const ENV = {
  apiUrl:   import.meta.env.VITE_API_URL       || '/api/responses',
  token:    import.meta.env.VITE_BEARER_TOKEN  || '',
  agentId:  import.meta.env.VITE_AGENT_ID      || 'main',
  model:    import.meta.env.VITE_MODEL         || 'openclaw',
  stream:   import.meta.env.VITE_STREAM !== 'false',
  appToken: import.meta.env.VITE_APP_TOKEN     || '',
};

/* ─── Login Screen ───────────────────────────────────────────────── */
function LoginScreen({ onAuth }) {
  const [value,  setValue]  = useState('');
  const [error,  setError]  = useState('');
  const [shaking,setShaking]= useState(false);

  const submit = e => {
    e.preventDefault();
    if (value.trim() === ENV.appToken) {
      sessionStorage.setItem('oc-authed', '1');
      onAuth();
    } else {
      setError('Invalid access token.');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      setValue('');
    }
  };

  return (
    <div className="login-screen">
      <div className={`login-card${shaking ? ' shake' : ''}`}>
        <div className="login-logo"><Zap size={24} /></div>
        <h1 className="login-title">OpenClaw Chat</h1>
        <p className="login-sub">Enter your access token to continue</p>
        <form onSubmit={submit} className="login-form">
          <input
            className={`login-input${error ? ' login-input-err' : ''}`}
            type="password"
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            placeholder="Access token"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" type="submit" disabled={!value.trim()}>
            <Send size={15} /> Continue
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() =>
    !ENV.appToken || sessionStorage.getItem('oc-authed') === '1'
  );

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;
  /* Config ─────────────────────────────────────────────────────── */
  const [apiUrl,       setApiUrl]       = useState(() => load('oc-apiUrl',  ENV.apiUrl));
  const [token,        setToken]        = useState(() => load('oc-token',   ENV.token));
  const [agentId,      setAgentId]      = useState(() => load('oc-agentId', ENV.agentId));
  const [model,        setModel]        = useState(() => load('oc-model',   ENV.model));
  const [stream,       setStream]       = useState(() => load('oc-stream',  ENV.stream));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => localStorage.setItem('oc-apiUrl',  JSON.stringify(apiUrl)),  [apiUrl]);
  useEffect(() => localStorage.setItem('oc-token',   JSON.stringify(token)),   [token]);
  useEffect(() => localStorage.setItem('oc-agentId', JSON.stringify(agentId)), [agentId]);
  useEffect(() => localStorage.setItem('oc-model',   JSON.stringify(model)),   [model]);
  useEffect(() => localStorage.setItem('oc-stream',  JSON.stringify(stream)),  [stream]);

  /* Models ─────────────────────────────────────────────────────── */
  const [models,        setModels]        = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError,   setModelsError]   = useState('');

  const fetchModels = useCallback(async (currentToken = token, currentApiUrl = apiUrl) => {
    setModelsLoading(true);
    setModelsError('');
    // Build the models URL from the API URL
    // e.g. /api/responses → /api/models  |  http://host/v1/responses → http://host/v1/models
    const base = (currentApiUrl || '/api/responses')
      .replace(/\/responses$/, '')
      .replace(/\/(chat\/)?completions$/, '');
    const url = base.endsWith('/models') ? base : `${base}/models`;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${currentToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = await res.json();
      // Handle: { data:[...] }  |  { models:[...] }  |  bare array
      const list = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
      const mapped = list
        .filter(m => m.id)
        .map(m => ({
          id:    m.id,
          label: m.alias ? `${m.name ?? m.id} (${m.alias})` : (m.name ?? m.id),
        }));
      if (mapped.length) {
        setModels(mapped);
        if (!mapped.find(m => m.id === model)) setModel(mapped[0].id);
      } else {
        setModelsError(`No models returned from ${url}`);
      }
    } catch (e) {
      setModelsError(e.message);
    } finally {
      setModelsLoading(false);
    }
  }, [token, apiUrl, model]);

  // Fetch on mount
  useEffect(() => { fetchModels(); }, []); // eslint-disable-line
  // Re-fetch when token or apiUrl changes (debounced)
  const modelFetchTimer = useRef(null);
  useEffect(() => {
    clearTimeout(modelFetchTimer.current);
    modelFetchTimer.current = setTimeout(() => fetchModels(token, apiUrl), 800);
  }, [token, apiUrl]); // eslint-disable-line

  /* Threads ────────────────────────────────────────────────────── */
  const [threads,  setThreads]  = useState(() => load('oc-threads', []));
  const [activeId, setActiveId] = useState(() => load('oc-activeId', null));

  useEffect(() => localStorage.setItem('oc-threads',  JSON.stringify(threads)),  [threads]);
  useEffect(() => localStorage.setItem('oc-activeId', JSON.stringify(activeId)), [activeId]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId) || null, [threads, activeId]);
  const messages     = activeThread?.messages || [];
  const grouped      = useMemo(() => groupThreads(threads), [threads]);

  /* Sessions (WebSocket) ───────────────────────────────────────── */
  const [sidebarTab,     setSidebarTab]     = useState('threads');
  const [wsStatus,       setWsStatus]       = useState('off');
  const [remoteSessions, setRemoteSessions] = useState([]);
  const wsRef          = useRef(null);
  const wsRetry        = useRef(null);
  const wsActive       = useRef(false); // guard against concurrent connects
  const tokenRef       = useRef(token);
  const modelRef       = useRef(model);
  const historyPending = useRef(new Map()); // reqId → threadId
  const [loadingHistory, setLoadingHistory] = useState(new Set());
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { modelRef.current = model; }, [model]);

  const connectWS = useCallback(() => {
    // Block concurrent connection attempts
    if (wsActive.current) return;
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    wsActive.current = true;
    clearTimeout(wsRetry.current);
    setWsStatus('connecting');

    const proto  = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = socket;

    let pingTimer   = null;
    let authed      = false;

    const req = (method, params = {}) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'req', id: genId(), method, params }));
    };

    const onAuthed = () => {
      authed = true;
      wsActive.current = false;
      setWsStatus('on');
      req('sessions.list');
      req('sessions.subscribe');
      req('models.list');
      pingTimer = setInterval(() => req('ping'), 20000);
    };

    const parseSessions = payload => {
      // payload.items is the documented field; fall back to payload.sessions or array
      const raw = payload?.items ?? payload?.sessions ?? (Array.isArray(payload) ? payload : null);
      if (!Array.isArray(raw)) return;
      setRemoteSessions(raw.map(s => {
        const parsed = parseKey(s.key ?? '');
        return {
          key:       s.key ?? '',
          channel:   s.channel   || parsed.channel,
          peer:      s.displayName || parsed.peer,
          agentId:   parsed.agentId,
          kind:      s.kind,
          updatedAt: s.updatedAt,
        };
      }));
    };

    socket.onopen = () => {
      // Do NOT send anything yet — wait for connect.challenge from server.
      // Some instances skip the challenge; set a 3 s fallback.
      setTimeout(() => { if (!authed) onAuthed(); }, 3000);
    };

    socket.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);

        // 1. Server challenges → respond with correct auth params
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          socket.send(JSON.stringify({
            type: 'req', id: genId(), method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'ui' },
              auth: { token: tokenRef.current },
              scopes: ['operator.read', 'operator.write'],
            },
          }));
          return;
        }

        // 2. hello-ok → we are authenticated
        if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
          onAuthed();
          return;
        }

        // 3. models.list response (success)
        if (msg.type === 'res' && msg.ok && Array.isArray(msg.payload?.models)) {
          const mapped = msg.payload.models.map(m => ({
            id:    m.id,
            label: m.alias ? `${m.name} (${m.alias})` : m.name,
          }));
          setModels(mapped);
          setModelsLoading(false);
          setModelsError('');
          if (mapped.length && !mapped.find(m => m.id === modelRef.current))
            setModel(mapped[0].id);
          return;
        }

        // 3b. chat.history response (keyed by pending map)
        if (historyPending.current.has(msg.id)) {
          const tId = historyPending.current.get(msg.id);
          historyPending.current.delete(msg.id);
          setLoadingHistory(p => { const s = new Set(p); s.delete(tId); return s; });
          if (msg.ok) {
            const raw = msg.payload?.messages ?? msg.payload?.items ?? [];
            const mapped = raw.flatMap(item => {
              const m = item.message ?? item;
              if (!m?.role || m.role === 'tool' || m.role === 'toolResult') return [];
              let content = '', thinking = '';
              if (Array.isArray(m.content)) {
                for (const c of m.content) {
                  if (c.type === 'text') content += c.text ?? '';
                  else if (c.type === 'thinking' || c.type === 'reasoning')
                    thinking += c.thinking ?? c.text ?? '';
                }
              } else if (typeof m.content === 'string') {
                content = m.content;
              }
              if (!content && !thinking) return [];
              return [{ id: item.id ?? m.id ?? genId(), role: m.role, content, thinking: thinking || undefined }];
            });
            setThreads(prev => prev.map(t =>
              t.id === tId ? { ...t, messages: mapped, updatedAt: Date.now() } : t
            ));
          }
          return;
        }

        // 3c. Generic error — log and continue
        if (msg.type === 'res' && !msg.ok) {
          console.warn('[WS] error response:', msg.payload ?? msg);
          return;
        }

        // 4. sessions.list response
        if (msg.type === 'res' && msg.ok) {
          parseSessions(msg.payload);
        }

        // 5. Any event after auth → refresh session list
        if (msg.type === 'event' && authed) {
          req('sessions.list');
        }
      } catch {}
    };

    socket.onclose = () => {
      wsActive.current = false;
      clearInterval(pingTimer);
      setWsStatus('off');
      wsRetry.current = setTimeout(connectWS, 5000);
    };

    socket.onerror = () => { setWsStatus('error'); /* onclose fires next */ };
  }, []); // stable — token accessed via ref

  useEffect(() => {
    connectWS();
    return () => {
      clearTimeout(wsRetry.current);
      wsActive.current = false;
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* UI state ───────────────────────────────────────────────────── */
  const [input,           setInput]           = useState('');
  const [loading,         setLoading]         = useState(false);
  const [expandedThinking,setExpandedThinking]= useState({});
  const [editingTitle,    setEditingTitle]    = useState('');   // '' = not editing
  const [deletingId,      setDeletingId]      = useState(null); // confirm-delete

  /* Slash commands ─────────────────────────────────────────────── */
  const [slashIdx,       setSlashIdx]       = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashResults = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q));
  }, [input]);
  const slashOpen = !slashDismissed && slashResults.length > 0;
  const slashPopupRef = useRef(null);

  /* Refs ───────────────────────────────────────────────────────── */
  const endRef      = useRef(null);
  const abortRef    = useRef(null);
  const textareaRef = useRef(null);
  const msgsRef     = useRef(null);
  const atBottom    = useRef(true);

  useEffect(() => {
    if (atBottom.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onScroll = () => {
    const el = msgsRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  /* Thread helpers ─────────────────────────────────────────────── */
  const patchLast = useCallback((tId, fn) => {
    setThreads(prev => prev.map(t => {
      if (t.id !== tId) return t;
      const msgs = t.messages;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return t;
      return { ...t, updatedAt: Date.now(), messages: [...msgs.slice(0, -1), fn(last)] };
    }));
  }, []);

  const newThread = useCallback(() => {
    const current = threads.find(t => t.id === activeId);
    if (current && current.messages.length === 0) return; // already empty
    const id = genId();
    const thread = { id, title: '', sessionKey: `agent:${agentId}:web:${id}`, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setThreads(prev => [thread, ...prev]);
    setActiveId(id);
    setExpandedThinking({});
    setInput('');
  }, [threads, activeId, agentId]);

  const switchThread = useCallback((id) => {
    setActiveId(id);
    setExpandedThinking({});
    atBottom.current = true;
  }, []);

  const deleteThread = useCallback((id) => {
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeId === id) setActiveId(t => {
      const remaining = threads.filter(x => x.id !== id);
      return remaining[0]?.id || null;
    });
    setDeletingId(null);
  }, [activeId, threads]);

  const renameThread = useCallback((id, title) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title } : t));
    setEditingTitle('');
  }, []);

  /* Fetch history for a thread via WebSocket chat.history */
  const fetchHistory = useCallback((sessionKey, threadId) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const reqId = genId();
    historyPending.current.set(reqId, threadId);
    setLoadingHistory(p => new Set([...p, threadId]));
    ws.send(JSON.stringify({
      type: 'req', id: reqId, method: 'chat.history',
      params: { sessionKey, limit: 200 },
    }));
  }, []);

  /* Join any remote session — find or create a local thread for it */
  const joinSession = useCallback((sessionKey) => {
    const existing = threads.find(t => t.sessionKey === sessionKey);
    if (existing) {
      switchThread(existing.id);
      setSidebarTab('threads');
      fetchHistory(sessionKey, existing.id);
      return;
    }
    const { channel, peer } = parseKey(sessionKey);
    const meta  = channelMeta(channel);
    const id    = genId();
    const title = `${meta.label} · ${clip(peer, 24)}`;
    setThreads(prev => [{
      id, title, sessionKey,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
    }, ...prev]);
    setActiveId(id);
    setExpandedThinking({});
    setSidebarTab('threads');
    fetchHistory(sessionKey, id);
  }, [threads, switchThread, fetchHistory]);

  /* Textarea grow ──────────────────────────────────────────────── */
  const grow = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };
  const handleInput = e => {
    setInput(e.target.value);
    setSlashDismissed(false);
    setSlashIdx(0);
    grow();
  };
  const applySlash = useCallback((item) => {
    setInput(item.cmd + ' ');
    setSlashDismissed(false);
    setSlashIdx(0);
    textareaRef.current?.focus();
    setTimeout(grow, 0);
  }, []);
  const setHint = text => { setInput(text); textareaRef.current?.focus(); setTimeout(grow, 0); };

  /* Send ───────────────────────────────────────────────────────── */
  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    atBottom.current = true;

    const existing = threads.find(t => t.id === activeId);
    const threadId         = existing?.id       || genId();
    const threadSessionKey = existing?.sessionKey|| `agent:${agentId}:web:${threadId}`;
    const asstId           = genId();

    const isCommand = text.startsWith('/');
    const userMsg = { id: genId(), role: 'user', content: text, isCommand };
    const asstMsg = { id: asstId, role: 'assistant', content: '', thinking: '', streaming: true, thinkingStreaming: false, waiting: true, isError: false, isCommand };

    const titleText = isCommand ? '' : clip(text, 38);
    if (!existing) {
      setThreads(prev => [{
        id: threadId, title: titleText, sessionKey: threadSessionKey,
        messages: [userMsg, asstMsg], createdAt: Date.now(), updatedAt: Date.now(),
      }, ...prev]);
      setActiveId(threadId);
    } else {
      setThreads(prev => prev.map(t => t.id !== threadId ? t : {
        ...t,
        title: t.title || titleText,
        updatedAt: Date.now(),
        messages: [...t.messages, userMsg, asstMsg],
      }));
    }
    setExpandedThinking(p => ({ ...p, [asstId]: false }));
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': agentId,
          'x-openclaw-session-key': threadSessionKey,
        },
        body: JSON.stringify({ model, stream, input: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok)   throw new Error(`HTTP ${res.status} – ${res.statusText}`);
      if (!res.body) throw new Error('No response body');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', evt = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line) { evt = ''; continue; }
          if (line.startsWith('event:')) { evt = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let parsed; try { parsed = JSON.parse(data); } catch { continue; }
          const type = parsed.type || evt;

          if (/thinking|reasoning/.test(type) && !type.includes('done')) {
            const d = parsed.delta ?? parsed.thinking ?? parsed.reasoning ?? '';
            if (d) patchLast(threadId, m => ({ ...m, thinking: (m.thinking||'') + d, thinkingStreaming: true, waiting: false }));
          }
          if (/thinking|reasoning/.test(type) && type.includes('done')) {
            patchLast(threadId, m => ({ ...m, thinkingStreaming: false }));
          }
          if (type === 'response.output_text.delta' && parsed.delta) {
            patchLast(threadId, m => ({ ...m, content: m.content + parsed.delta, waiting: false, thinkingStreaming: false }));
          }
        }
      }
      patchLast(threadId, m => ({ ...m, streaming: false, thinkingStreaming: false, waiting: false }));

    } catch (err) {
      if (err.name === 'AbortError') {
        patchLast(threadId, m => ({ ...m, streaming: false, thinkingStreaming: false, waiting: false }));
        return;
      }
      patchLast(threadId, m => ({
        ...m,
        content: `${err.message}\n\nCheck:\n• API running at ${apiUrl}\n• Bearer token correct\n• Agent ID valid`,
        streaming: false, thinkingStreaming: false, waiting: false, isError: true,
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onKey = e => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx(i => Math.min(i + 1, slashResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySlash(slashResults[slashIdx] ?? slashResults[0]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const stop  = () => abortRef.current?.abort();

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <div className="app">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="brand-icon"><Zap size={15} /></div>
          <span className="brand-text">Leonardo AI</span>
        </div>

        {/* Tabs */}
        <div className="sb-tabs">
          <button className={`sb-tab${sidebarTab==='threads'?' active':''}`} onClick={() => setSidebarTab('threads')}>
            <MessageSquare size={13} />Threads
          </button>
          <button className={`sb-tab${sidebarTab==='sessions'?' active':''}`} onClick={() => setSidebarTab('sessions')}>
            <Radio size={13} />
            Sessions
            <span className={`ws-dot ws-${wsStatus}`} title={wsStatus} />
          </button>
        </div>

        {sidebarTab === 'threads' ? (
          <>
            <div className="sb-new" onClick={newThread}>
              <Plus size={15} /><span>New chat</span>
            </div>
            <div className="sb-threads">
              {threads.length === 0 && <div className="sb-empty">No conversations yet</div>}
              {grouped.map(([label, items]) => (
                <div key={label} className="sb-group">
                  <div className="sb-group-label">{label}</div>
                  {items.map(t => (
                    <div key={t.id} className={`sb-item${t.id === activeId ? ' active' : ''}`} onClick={() => switchThread(t.id)}>
                      <MessageSquare size={13} className="sb-item-icon" />
                      <span className="sb-item-title">{t.title || 'New chat'}</span>
                      <button className="sb-item-del" onClick={e => { e.stopPropagation(); setDeletingId(t.id); }} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="sb-sessions">
            {/* WS status bar */}
            <div className={`ws-status ws-status-${wsStatus}`}>
              <span className={`ws-dot ws-${wsStatus}`} />
              {wsStatus === 'on'         && `Live · ${remoteSessions.length} session${remoteSessions.length!==1?'s':''}`}
              {wsStatus === 'connecting' && 'Connecting…'}
              {wsStatus === 'off'        && <><span>Disconnected</span><button className="ws-retry" onClick={connectWS}>Retry</button></>}
              {wsStatus === 'error'      && <><span>Error</span><button className="ws-retry" onClick={connectWS}>Retry</button></>}
            </div>

            {remoteSessions.length === 0 && wsStatus === 'on' && (
              <div className="sb-empty">No active sessions</div>
            )}

            {/* Group by channel */}
            {Object.entries(
              remoteSessions.reduce((acc, s) => { (acc[s.channel] ??= []).push(s); return acc; }, {})
            ).map(([ch, sessions]) => {
              const meta = channelMeta(ch);
              return (
                <div key={ch} className="sb-group">
                  <div className="sb-group-label" style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span className="ch-abbr" style={{ background: meta.color }}>{meta.abbr}</span>
                    {meta.label}
                    <span className="sb-count">{sessions.length}</span>
                  </div>
                  {sessions.map(s => {
                    const isLinked = threads.some(t => t.sessionKey === s.key);
                    const isActive = isLinked && activeThread?.sessionKey === s.key;
                    return (
                      <div key={s.key} className={`sb-item${isActive ? ' active' : ''}`} onClick={() => joinSession(s.key)} title={s.key}>
                        <span className="ch-dot" style={{ background: meta.color }} />
                        <span className="sb-item-title">{s.peer || s.key}</span>
                        <span className="sb-item-right">
                          {s.kind && s.kind !== 'main' && <span className="kind-badge">{s.kind}</span>}
                          {s.updatedAt && <span className="sess-time">{ago(s.updatedAt)}</span>}
                          {isLinked && <span className="linked-badge">open</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Workspace ───────────────────────────────────────────── */}
      <div className="workspace">

        {/* Chat header */}
        <div className="chat-header">
          <div className="chat-header-left">
            {editingTitle && activeThread ? (
              <input
                className="title-edit"
                autoFocus
                defaultValue={activeThread.title}
                onBlur={e  => renameThread(activeThread.id, e.target.value.trim() || activeThread.title)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  if (e.key === 'Escape') { setEditingTitle(''); }
                }}
              />
            ) : (
              <h1 className="chat-title" onClick={() => activeThread && setEditingTitle('edit')} title="Click to rename">
                {activeThread?.title || 'Leonardo AI'}
              </h1>
            )}
          </div>
          <div className="chat-header-right">
            {activeThread && (
              <span className="session-badge" title={`Session: ${activeThread.sessionKey}`}>
                {activeThread.sessionKey.split(':').pop().slice(0, 8)}
              </span>
            )}
            {activeThread && (
              <button
                className={`icon-btn${loadingHistory.has(activeId) ? ' spinning' : ''}`}
                onClick={() => fetchHistory(activeThread.sessionKey, activeThread.id)}
                title="Refresh history"
                disabled={loadingHistory.has(activeId)}
              >
                <RefreshCw size={15} />
              </button>
            )}
            <button
              className={`icon-btn${showSettings ? ' active' : ''}`}
              onClick={() => setShowSettings(s => !s)}
              title="Settings"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="messages" ref={msgsRef} onScroll={onScroll}>
          {loadingHistory.has(activeId) && messages.length === 0 ? (
            <div className="history-loading">
              <span className="hist-spinner" />
              Loading conversation history…
            </div>
          ) : messages.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><Bot size={28} /></div>
              <h2>OpenClaw AI</h2>
              <p>Your intelligent AI assistant. Ask anything to get started.</p>
              <div className="hints">
                {['What can you help me with?','Write a Python hello world','Explain quantum computing','Debug my code'].map(h => (
                  <button key={h} className="hint-chip" onClick={() => setHint(h)}>{h}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-inner">
              {loadingHistory.has(activeId) && (
                <div className="history-refresh-bar">
                  <span className="hist-spinner" /> Refreshing…
                </div>
              )}
              {messages.map(msg => (
                <Message key={msg.id} msg={msg} expanded={expandedThinking} setExpanded={setExpandedThinking} />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-wrap">
            {/* Slash command popup */}
            {slashOpen && (
              <div className="slash-popup" ref={slashPopupRef}>
                {slashResults.map((item, i) => (
                  <button
                    key={item.cmd}
                    className={`slash-item${i === slashIdx ? ' active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); applySlash(item); }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className="slash-cmd">{item.cmd}</span>
                    <span className="slash-desc">{item.desc}</span>
                    <span className="slash-cat">{item.cat}</span>
                  </button>
                ))}
                <div className="slash-footer">
                  <span>↑↓ navigate</span>
                  <span>↵ / Tab select</span>
                  <span>Esc dismiss</span>
                </div>
              </div>
            )}
            <div className="input-box">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={onKey}
                placeholder="Message OpenClaw… (type / for commands)"
                className="chat-input"
                rows={1}
                disabled={loading}
              />
              <div className="input-right">
                {loading
                  ? <button className="stop-btn" onClick={stop} title="Stop"><Square size={16} /></button>
                  : <button className="send-btn" onClick={send} disabled={!input.trim()} title="Send"><Send size={16} /></button>
                }
              </div>
            </div>
          </div>
          <div className="input-hint">Enter to send · Shift+Enter for new line · / for commands</div>
        </div>
      </div>

      {/* ── Settings Panel ──────────────────────────────────────── */}
      {showSettings && (
        <aside className="settings">
          <div className="settings-head">
            <h2>Configuration</h2>
            <button className="icon-btn" onClick={() => setShowSettings(false)}><X size={16} /></button>
          </div>
          <div className="settings-body">
            <div className="field"><label>API URL</label>
              <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://127.0.0.1:18789/v1/responses" />
            </div>
            <div className="field"><label>Bearer Token</label>
              <textarea value={token} onChange={e => setToken(e.target.value)} rows={3} placeholder="Enter bearer token" />
            </div>
            <div className="field"><label>Agent ID</label>
              <input type="text" value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="main" />
            </div>
            <div className="field">
              <div className="field-label-row">
                <label>Model</label>
                <button
                  className={`refresh-btn${modelsLoading ? ' spinning' : ''}`}
                  onClick={() => fetchModels()}
                  disabled={modelsLoading}
                  title="Refresh model list"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
              {models.length > 0 ? (
                <select
                  className="field-select"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="Leonardo AI"
                  className={modelsLoading ? 'loading' : ''}
                />
              )}
              {modelsError && (
                <div className="field-err-block">
                  <span className="field-err">{modelsError}</span>
                  <span className="field-err-hint">Check API URL and bearer token, then click ↺</span>
                </div>
              )}
              {modelsLoading && !modelsError && (
                <span className="field-hint">Fetching models…</span>
              )}
              {!modelsLoading && !modelsError && models.length === 0 && (
                <span className="field-hint">No models found — click ↺ to retry</span>
              )}
            </div>
            <div className="field field-row">
              <label>Streaming</label>
              <button className={`toggle-btn${stream ? ' on' : ''}`} onClick={() => setStream(s => !s)}>
                {stream ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            <div className="env-note">
              Defaults loaded from <code>.env</code>. Settings are saved to localStorage and override .env on reload.
            </div>
            <div className="status-card">
              <div className="status-card-title">Status</div>
              <div className="status-row"><span className={`status-dot ${stream?'on':'off'}`}/>&nbsp;Streaming {stream?'enabled':'disabled'}</div>
              <div className="status-row"><span className="status-label">Model</span><span className="status-val">{model}</span></div>
              <div className="status-row"><span className="status-label">Threads</span><span className="status-val">{threads.length}</span></div>
              <div className="status-row"><span className="status-label">Messages</span><span className="status-val">{messages.length}</span></div>
            </div>
            <button className="clear-btn" onClick={() => { setThreads([]); setActiveId(null); }}>
              <Trash2 size={14} />Clear All History
            </button>
          </div>
        </aside>
      )}

      {/* ── Delete confirm dialog ────────────────────────────────── */}
      {deletingId && (
        <div className="dialog-overlay" onClick={() => setDeletingId(null)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Delete conversation?</h3>
            <p>This will permanently remove the chat history. The server-side session will be unaffected.</p>
            <div className="dialog-actions">
              <button className="dialog-cancel" onClick={() => setDeletingId(null)}>Cancel</button>
              <button className="dialog-confirm" onClick={() => deleteThread(deletingId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
