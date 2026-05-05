// Far-left vertical icon rail. Each entry maps to a top-level view.
// Adding a new view is one line in the array below.

import {
  BarChart3, Bot, Clock, LayoutDashboard, Monitor, MessageSquare,
  Moon, Plug, Sparkles, Sun, Users, Zap,
} from 'lucide-react';

export const VIEWS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat',     label: 'Chat',     icon: MessageSquare   },
  // { id: 'agents',   label: 'Agents',   icon: Bot             },
  { id: 'sessions', label: 'Sessions', icon: Users           },
  { id: 'usage',    label: 'Usage',    icon: BarChart3       },
  { id: 'skills',   label: 'Skills',   icon: Sparkles        },
  // { id: 'cron',     label: 'Cron',     icon: Clock           },
  // { id: 'channels', label: 'Channels', icon: Plug            },
];

const THEME_ICON = { dark: Moon, light: Sun, system: Monitor };
const THEME_NEXT = { dark: 'light', light: 'system', system: 'dark' };

export default function NavRail({ view, onChange, theme = 'dark', onCycleTheme }) {
  const ThemeIcon = THEME_ICON[theme] ?? Moon;
  return (
    <nav className="navrail">
      <div className="navrail-logo"><Zap size={18} /></div>
      <div className="navrail-items">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`navrail-item${view === id ? ' active' : ''}`}
            onClick={() => onChange(id)}
            title={label}
          >
            <Icon size={18} />
            <span className="navrail-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="navrail-bottom">
        {onCycleTheme && (
          <button
            className="navrail-item"
            onClick={onCycleTheme}
            title={`Theme: ${theme} (click for ${THEME_NEXT[theme]})`}
          >
            <ThemeIcon size={18} />
            <span className="navrail-label">{theme}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
