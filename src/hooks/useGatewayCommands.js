// Live slash-command catalog, pulled from the gateway's `commands.list`
// RPC (protocol v4) so the autocomplete reflects what the connected
// gateway + its plugins/skills actually expose — not a hardcoded list.
//
// Falls back to the static SLASH_COMMANDS bundle when the gateway is
// offline or the RPC fails, so the popup is never empty.
//
// `commands.list` result (openclaw/openclaw schema/commands.ts):
//   { commands: [{
//       name, nativeName?, textAliases?, description,
//       category?  ('session'|'options'|'status'|'management'|'media'|'tools'|'docks'),
//       source     ('native'|'skill'|'plugin'),
//       scope      ('text'|'native'|'both'),
//       acceptsArgs, args?[]
//   }] }
// Requires operator.read scope (our connect already has it). No sessionKey.

import { useEffect, useState } from 'react';
import { SLASH_COMMANDS } from '../utils/slashCommands.js';

const CAT_LABEL = {
  session:    'Session',
  options:    'Options',
  status:     'Status',
  management: 'Management',
  media:      'Media',
  tools:      'Tools',
  docks:      'Docks',
};

// Stable display order for category sections in the popup. Anything not
// listed sorts after these, alphabetically.
const CAT_ORDER = [
  'Session', 'Options', 'Model', 'Status', 'Tools',
  'Media', 'Management', 'Docks', 'Skill', 'Plugin', 'Command',
];
export function catRank(cat) {
  const i = CAT_ORDER.indexOf(cat);
  return i === -1 ? CAT_ORDER.length : i;
}

function toEntry(c) {
  // Prefer the canonical typed form. textAliases are already slash-prefixed
  // (e.g. ["/model","/m"]); fall back to nativeName/name with a leading "/".
  const primary =
    (Array.isArray(c.textAliases) && c.textAliases.find((a) => a.startsWith('/')))
    || `/${(c.nativeName || c.name || '').replace(/^\/+/, '')}`;
  if (!primary || primary === '/') return null;

  const cat =
    CAT_LABEL[c.category]
    || (c.source === 'skill'  ? 'Skill'
      : c.source === 'plugin' ? 'Plugin'
      : 'Command');

  // Arg hint like "[action] [value]" from the command's declared args.
  const args = Array.isArray(c.args) ? c.args : [];
  const argHint = args.map((a) => `[${a.name}]`).join(' ');

  // Badge mirrors OpenClaw's webchat:
  //   • no args              → "instant" (executes with nothing to fill in)
  //   • first arg has choices → "N options"
  //   • free-text args        → no badge
  let badge = null;
  if (!c.acceptsArgs || args.length === 0) {
    badge = { text: 'instant', kind: 'instant' };
  } else {
    const choices = args.find((a) => Array.isArray(a.choices) && a.choices.length)?.choices;
    if (choices?.length) badge = { text: `${choices.length} options`, kind: 'options' };
  }

  return {
    cmd:  primary,
    desc: c.description || '',
    cat,
    argHint,
    badge,
    iconKey:     (c.nativeName || c.name || '').replace(/^\/+/, '').toLowerCase(),
    source:      c.source,
    acceptsArgs: !!c.acceptsArgs,
    args,
    aliases:     Array.isArray(c.textAliases) ? c.textAliases : [],
  };
}

export function useGatewayCommands({ gateway, agentId }) {
  // Start with the static bundle so the popup works before the RPC lands
  // (and as the permanent fallback when the gateway can't be reached).
  const [commands, setCommands] = useState(SLASH_COMMANDS);
  const [source,   setSource]   = useState('static');   // 'static' | 'gateway'

  useEffect(() => {
    if (gateway?.status !== 'on') return;
    let alive = true;

    (async () => {
      try {
        // scope:'both' → include commands usable as typed text. We then
        // drop any that are native-only (can't be typed as "/cmd").
        // includeArgs → populate args[] so we can show "[arg]" hints and
        // the "instant" / "N options" badge.
        const payload = await gateway.request('commands.list', { scope: 'both', includeArgs: true });
        const raw = Array.isArray(payload?.commands) ? payload.commands : [];
        const mapped = raw
          .filter((c) => c && c.scope !== 'native')
          .map(toEntry)
          .filter(Boolean);

        if (!alive) return;
        if (mapped.length) {
          // De-dupe by cmd (a skill + native could collide); first wins.
          const seen = new Set();
          const deduped = mapped.filter((e) => {
            if (seen.has(e.cmd)) return false;
            seen.add(e.cmd);
            return true;
          });
          // Sort by category section, then command name, so the popup can
          // render clean grouped headers (it inserts a header whenever the
          // category changes from the previous row).
          deduped.sort((a, b) =>
            (catRank(a.cat) - catRank(b.cat))
            || a.cat.localeCompare(b.cat)
            || a.cmd.localeCompare(b.cmd));
          setCommands(deduped);
          setSource('gateway');
        }
      } catch {
        // Keep the static fallback already in state.
        if (alive) setSource('static');
      }
    })();

    return () => { alive = false; };
    // Re-fetch when the gateway (re)connects or the active agent changes —
    // skills/plugins are per-agent so the catalog can differ.
  }, [gateway?.status, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { commands, source };
}
