// "Supported Channels" grid — entry point for configuring Telegram, Discord
// and WhatsApp. Clicking a card opens ChannelConfigModal. The "configured"
// indicator comes from /api/v1/channels.

import { useCallback, useEffect, useState } from 'react';
import { Settings2, CheckCircle2 } from 'lucide-react';
import { SUPPORTED_CHANNELS } from './channelDefs.js';
import ChannelIcon from './ChannelIcon.jsx';
import ChannelConfigModal from './ChannelConfigModal.jsx';
import { listChannelConfigs } from './channelStore.js';

export default function SupportedChannels() {
  const [active, setActive]         = useState(null);
  const [configured, setConfigured] = useState(() => new Set());
  const [error, setError]           = useState(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listChannelConfigs();
      setConfigured(new Set(items.map((i) => i.channelId)));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function handleSaved(channelId) {
    setConfigured((prev) => new Set(prev).add(channelId));
  }

  return (
    <section className="ch-section">
      <h2 className="ch-section-title">Supported Channels</h2>
      {error && <div className="ch-modal-error">Failed to load channel state: {error}</div>}
      <div className="ch-grid">
        {SUPPORTED_CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="ch-card"
            onClick={() => setActive(c)}
          >
            <span className="ch-card-icon" style={{ color: c.color }}>
              <ChannelIcon id={c.id} size={20} />
            </span>
            <span className="ch-card-body">
              <span className="ch-card-title">
                {c.name}
                {configured.has(c.id) && (
                  <span className="ch-card-saved" title="Configuration saved">
                    <CheckCircle2 size={12} />
                  </span>
                )}
              </span>
              <span className="ch-card-desc">{c.description}</span>
            </span>
            <span className="ch-card-action" aria-hidden="true">
              <Settings2 size={14} />
            </span>
          </button>
        ))}
      </div>

      {active && (
        <ChannelConfigModal
          channel={active}
          onClose={() => setActive(null)}
          onSaved={(id, row) => { handleSaved(id); refresh(); }}
        />
      )}
    </section>
  );
}
