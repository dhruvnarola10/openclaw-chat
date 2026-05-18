// Floating slash-command autocomplete shown above the chat input.
//
// Layout mirrors OpenClaw's webchat popup:
//   ┌ CATEGORY ─────────────────────────────────────────────┐
//   │ <icon> /cmd [arg]            description     [badge]   │  ← active row tinted
//   └────────────────────────────────────────────────────────┘
//
// `results` is the flat filtered list (kept flat so keyboard `idx` is a
// simple array index). It's pre-sorted by category in useGatewayCommands,
// so we just emit a section header whenever the category changes from the
// previous row. Header rows are non-interactive and don't affect `idx`.

import {
  Activity, BarChart3, Bot, Box, Cpu, Eye, EyeOff, FileText, HelpCircle,
  List, Plus, Power, RotateCcw, Settings, Slash, Sparkles, Square,
  Terminal, Trash2, Wrench, Zap,
} from 'lucide-react';

// Per-command icon (keyed by the bare command name, no slash). Falls back
// to a category icon, then a generic slash glyph — so unknown plugin/skill
// commands still render cleanly.
const CMD_ICON = {
  stop: Square, reset: RotateCcw, new: Plus, compact: Sparkles,
  clear: Trash2, session: Terminal, focus: Eye, unfocus: EyeOff,
  model: Cpu, models: List, help: HelpCircle, commands: List,
  status: Activity, whoami: Bot, tools: Wrench, usage: BarChart3,
  context: FileText, config: Settings, plugins: Box, restart: Power,
  diagnostics: Activity, bash: Terminal, skill: Zap,
};
const CAT_ICON = {
  Session: Terminal, Options: Settings, Model: Cpu, Status: Activity,
  Tools: Wrench, Media: Box, Management: Settings, Docks: Box,
  Skill: Zap, Plugin: Box, Command: Slash, Info: HelpCircle,
  Output: FileText, Advanced: Zap, Admin: Settings,
};

function iconFor(item) {
  return CMD_ICON[item.iconKey || (item.cmd || '').replace(/^\//, '')]
    || CAT_ICON[item.cat]
    || Slash;
}

export default function SlashPopup({ results, idx, onSelect, onHover }) {
  let lastCat = null;

  return (
    <div className="slash-popup">
      <div className="slash-scroll">
        {results.map((item, i) => {
          const Icon   = iconFor(item);
          const newCat = item.cat && item.cat !== lastCat;
          if (newCat) lastCat = item.cat;
          return (
            <div key={item.cmd} className="slash-group">
              {newCat && <div className="slash-cat-head">{item.cat}</div>}
              <button
                className={`slash-item${i === idx ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
                onMouseEnter={() => onHover(i)}
              >
                <span className="slash-icon"><Icon size={14} /></span>
                <span className="slash-cmd">
                  {item.cmd}
                  {item.argHint && <span className="slash-arg"> {item.argHint}</span>}
                </span>
                <span className="slash-desc">{item.desc}</span>
                {item.badge && (
                  <span className={`slash-badge slash-badge--${item.badge.kind || 'default'}`}>
                    {item.badge.text}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="slash-footer">
        <span>↑↓ navigate</span>
        <span>↵ / Tab select</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}
