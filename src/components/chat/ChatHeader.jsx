// Header strip above the chat — shows the thread title (editable inline)
// and action buttons for refresh-history + settings.

import { useState } from 'react';
import { Menu, RefreshCw, Settings as SettingsIcon } from 'lucide-react';

export default function ChatHeader({
  thread, onRename,
  onRefreshHistory, refreshing,
  onToggleSettings, settingsOpen,
  onToggleSidebar,
}) {
  const [editing, setEditing] = useState(false);
  const title = thread?.title || 'New conversation';

  const finish = (val) => {
    const trimmed = val.trim();
    if (thread && trimmed) onRename(thread.id, trimmed);
    setEditing(false);
  };

  return (
    <div className="chat-header">
      <div className="chat-header-left">
        {onToggleSidebar && (
          <button
            className="icon-btn chat-header-menu"
            onClick={onToggleSidebar}
            title="Open threads"
            aria-label="Open threads panel"
          >
            <Menu size={18} />
          </button>
        )}
        {editing && thread ? (
          <input
            className="title-edit"
            autoFocus
            defaultValue={thread.title}
            onBlur={(e) => finish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  e.target.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <h1
            className="chat-title"
            title={thread ? 'Click to rename' : undefined}
            onClick={() => thread && setEditing(true)}
          >
            {title}
          </h1>
        )}
      </div>
      <div className="chat-header-right">
        {thread && (
          <span className="session-badge" title={`Session: ${thread.sessionKey}`}>
            {thread.sessionKey.split(':').pop().slice(0, 8)}
          </span>
        )}
        {thread && (
          <button
            className={`icon-btn${refreshing ? ' spinning' : ''}`}
            onClick={onRefreshHistory}
            disabled={refreshing}
            title="Refresh history"
          >
            <RefreshCw size={15} />
          </button>
        )}
        <button
          className={`icon-btn${settingsOpen ? ' active' : ''}`}
          onClick={onToggleSettings}
          title="Settings"
        >
          <SettingsIcon size={17} />
        </button>
      </div>
    </div>
  );
}
