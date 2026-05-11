// Declarative metadata for the channels exposed in the "Supported Channels"
// section. The shape mirrors the upstream ClawX channel schema so that wiring
// these up to a real backend later is a drop-in.

export const SUPPORTED_CHANNELS = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Connect Telegram using a bot token from @BotFather',
    color: '#229ED9',
    docsUrl: 'https://core.telegram.org/bots',
    auth: 'token',
    instructions: [
      'Open Telegram and search for @BotFather, send /newbot and copy the bot token',
      'Get your User ID from @userinfobot and paste it into Allowed User IDs (comma-separated)',
      'Paste the token + IDs below and Save & Connect',
      'Restart the gateway, then DM your bot once — it will reply with a pairing code',
      'On the gateway host run: openclaw pairing approve telegram <CODE> (codes expire in 1h)',
    ],
    fields: [
      {
        id: 'botToken',
        label: 'Bot Token',
        placeholder: '123456:ABC-DEF...',
        envVar: 'TELEGRAM_BOT_TOKEN',
        required: true,
        secret: true,
      },
      {
        id: 'allowedUsers',
        label: 'Allowed User IDs',
        placeholder: 'e.g. 123456789, 987654321',
        required: true,
        description: 'Comma separated list of User IDs allowed to use the bot. Required for security.',
      },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Connect Discord using a bot token from Developer Portal',
    color: '#5865F2',
    docsUrl: 'https://discord.com/developers/docs/intro',
    auth: 'token',
    instructions: [
      'Go to Discord Developer Portal → Applications → New Application',
      'In Bot section: Add Bot, then copy the Bot Token',
      'Enable Message Content Intent + Server Members Intent in Bot → Privileged Gateway Intents',
      'In OAuth2 → URL Generator: select "bot" + "applications.commands", add message permissions',
      'Invite the bot to your server using the generated URL',
      'Paste the bot token below',
    ],
    fields: [
      {
        id: 'token',
        label: 'Bot Token',
        placeholder: 'Your Discord bot token',
        envVar: 'DISCORD_BOT_TOKEN',
        required: true,
        secret: true,
      },
      {
        id: 'guildId',
        label: 'Guild/Server ID',
        placeholder: 'e.g., 123456789012345678',
        required: true,
        description: 'Limit bot to a specific server. Right-click server → Copy Server ID.',
      },
      {
        id: 'channelId',
        label: 'Channel ID (optional)',
        placeholder: 'e.g., 123456789012345678',
        required: false,
        description: 'Limit bot to a specific channel. Right-click channel → Copy Channel ID.',
      },
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Connect WhatsApp by scanning a QR code (no phone number required)',
    color: '#25D366',
    docsUrl: 'https://www.whatsapp.com/business',
    auth: 'qr',
    instructions: [
      'Open WhatsApp on your phone',
      'Go to Settings > Linked Devices > Link a Device',
      'Scan the QR code shown below',
      'The system will automatically identify your phone number',
    ],
    fields: [],
  },
];

export function getChannelDef(id) {
  return SUPPORTED_CHANNELS.find((c) => c.id === id) ?? null;
}
