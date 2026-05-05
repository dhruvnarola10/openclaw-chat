// Display metadata for the various OpenClaw channels.

export const CHANNELS = {
  telegram: { label: 'Telegram', abbr: 'TG', color: '#2AABEE' },
  slack:    { label: 'Slack',    abbr: 'SL', color: '#4A154B' },
  whatsapp: { label: 'WhatsApp', abbr: 'WA', color: '#25D366' },
  discord:  { label: 'Discord',  abbr: 'DC', color: '#5865F2' },
  signal:   { label: 'Signal',   abbr: 'SG', color: '#3A76F0' },
  imessage: { label: 'iMessage', abbr: 'iM', color: '#1DC855' },
  webchat:  { label: 'Web Chat', abbr: 'WC', color: '#7c3aed' },
  web:      { label: 'Web',      abbr: 'WB', color: '#7c3aed' },
  internal: { label: 'Internal', abbr: 'IN', color: '#64748b' },
  main:     { label: 'Dashboard',abbr: 'DB', color: '#64748b' },
  email:    { label: 'Email',    abbr: 'EM', color: '#f59e0b' },
  sms:      { label: 'SMS',      abbr: 'SM', color: '#10b981' },
};

export const channelMeta = (ch) =>
  CHANNELS[ch?.toLowerCase()] ?? {
    label: ch || 'Unknown',
    abbr: (ch || '??').slice(0, 2).toUpperCase(),
    color: '#555',
  };
