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
  // iMessage is fundamentally different from token-based channels — there's
  // no remote API. Mapping:
  //   • Requires a macOS host running the gateway (or SSH'd via remoteHost)
  //   • Uses the `imsg` CLI that reads chat.db and talks to the Messages app
  //   • Must be granted Full Disk Access (System Settings → Privacy & Security)
  //   • allowFrom is required for security (whitelist of handles/chat_ids)
  // Fields mirror IMessageAccountConfig from
  //   openclaw/src/config/types.imessage.ts (allowFrom, cliPath, dbPath,
  //   service, defaultTo, remoteHost). Optional advanced fields like
  //   attachmentRoots / groupPolicy are kept out of this initial pass.
  {
    id: 'imessage',
    name: 'iMessage',
    description: 'Send and receive iMessage / SMS via the macOS Messages app (requires a Mac)',
    color: '#1DC855',
    docsUrl: 'https://github.com/abhi1693/openclaw#imessage',
    auth: 'token',
    instructions: [
      'This channel requires the gateway (or a reachable Mac via SSH) to be on macOS with the Messages app signed in.',
      'Install the imsg CLI on the Mac. From your terminal: brew tap abhi1693/openclaw && brew install imsg',
      'Grant Full Disk Access to imsg / Terminal / the gateway binary in System Settings → Privacy & Security → Full Disk Access. Restart Terminal afterwards.',
      'Verify imsg can read chat.db: run `imsg ls` on the Mac — you should see your recent chats.',
      'Fill in the Allowed Handles list below — comma-separated phone numbers or Apple IDs that the bot will accept messages from. This is required for safety.',
      'Save & Connect, then restart the gateway.',
    ],
    fields: [
      {
        id: 'allowFrom',
        label: 'Allowed Handles',
        placeholder: 'e.g. +14155551212, you@icloud.com',
        required: true,
        description: 'Comma-separated phone numbers (E.164) or Apple IDs. The bot ignores messages from anyone else — required for security.',
      },
      {
        id: 'service',
        label: 'Send Service',
        options: [
          { value: 'auto',     label: 'auto — iMessage when possible, SMS as fallback' },
          { value: 'imessage', label: 'imessage — iMessage only' },
          { value: 'sms',      label: 'sms — always send SMS' },
        ],
        placeholder: 'auto (recommended)',
        required: false,
        description: 'Default delivery channel when sending. auto picks the best available.',
      },
      {
        id: 'defaultTo',
        label: 'Default Recipient',
        placeholder: 'e.g. +14155551212',
        required: false,
        description: 'Optional default handle for outbound replies when no explicit target is set.',
      },
      {
        id: 'cliPath',
        label: 'imsg CLI Path',
        placeholder: 'imsg (default — leave blank unless installed elsewhere)',
        required: false,
        description: 'Override only if imsg isn\'t on the gateway\'s $PATH.',
      },
      {
        id: 'remoteHost',
        label: 'Remote Mac Host',
        placeholder: 'e.g. you@mac.local',
        required: false,
        description: 'Only if the gateway runs on a non-Mac host; SSH target where imsg lives. Leave blank for local-Mac setups.',
      },
    ],
  },
];

export function getChannelDef(id) {
  return SUPPORTED_CHANNELS.find((c) => c.id === id) ?? null;
}
