// Labeled sidebar with collapsible sections. Replaces the old icon-only rail.
// Sections are persistent in localStorage; sidebar can also collapse to a
// narrow icon-only mode via the chevron at the top.

import { useEffect, useState } from 'react';
import {
  Activity, BarChart3, Bot, CheckCircle2, ChevronLeft, ChevronRight,
  ChevronDown, Clock, FolderKanban, LayoutDashboard, Layers, ListChecks,
  MessageSquare, Monitor, Moon, Plug, Settings, Sparkles, Sun, Tag, Users, Zap,
} from 'lucide-react';
import { load, save } from '../../utils/storage.js';

// Sections + items. The order here is the order in the sidebar.
const SECTIONS = [
  {
    id: 'main',
    items: [
      { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
      { id: 'chat',      label: 'Chat',      icon: MessageSquare },
      { id: 'activity',  label: 'Activity',  icon: Activity },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    collapsible: true,
    items: [
      { id: 'workspace',     label: 'Boards',        icon: FolderKanban },
      { id: 'approvals',     label: 'Approvals',     icon: CheckCircle2 },
      { id: 'tags',          label: 'Tags',          icon: Tag          },
      // { id: 'custom-fields', label: 'Custom fields', icon: ListChecks   },
    ],
  },
  {
    id: 'fleet',
    label: 'Fleet',
    collapsible: true,
    items: [
      { id: 'agents',    label: 'Agents',    icon: Bot   },
      { id: 'sessions',  label: 'Sessions',  icon: Users },
      { id: 'usage',     label: 'Usage',     icon: BarChart3 },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    collapsible: true,
    items: [
      { id: 'skills',    label: 'Skills',    icon: Sparkles },
      { id: 'cron',      label: 'Cron',      icon: Clock    },
      { id: 'channels',  label: 'Channels',  icon: Plug     },
    ],
  },
];

export const VIEWS = SECTIONS.flatMap((s) => s.items);

const THEME_ICON = { dark: Moon, light: Sun, system: Monitor };
const THEME_NEXT = { dark: 'light', light: 'system', system: 'dark' };

const STORAGE_KEY = 'oc-nav-state';

export default function NavRail({ view, onChange, theme = 'dark', onCycleTheme }) {
  // Persisted UI state: collapsed (whole rail) + which sections are open
  const [state, setState] = useState(() => load(STORAGE_KEY, {
    collapsed: false,
    sections:  Object.fromEntries(SECTIONS.map((s) => [s.id, true])),
  }));

  useEffect(() => save(STORAGE_KEY, state), [state]);

  const toggleSection = (id) => setState((s) => ({
    ...s,
    sections: { ...s.sections, [id]: !s.sections[id] },
  }));
  const toggleCollapsed = () => setState((s) => ({ ...s, collapsed: !s.collapsed }));

  const ThemeIcon = THEME_ICON[theme] ?? Moon;
  const collapsed = state.collapsed;

  return (
    <nav className={`navrail2${collapsed ? ' navrail2--collapsed' : ''}`}>
      <div className="navrail2-head">
        <div className="navrail2-logo">
          <Zap size={18} />
          {!collapsed && <span className="navrail2-brand">Leonardo</span>}
        </div>
        <button className="navrail2-collapse" onClick={toggleCollapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="navrail2-scroll">
        {SECTIONS.map((sec) => (
          <NavSection
            key={sec.id}
            section={sec}
            open={state.sections[sec.id] !== false}
            onToggle={() => toggleSection(sec.id)}
            collapsed={collapsed}
            view={view}
            onChange={onChange}
          />
        ))}
      </div>

      <div className="navrail2-bottom">
        {onCycleTheme && (
          <button
            className={`navrail2-item${collapsed ? ' navrail2-item--collapsed' : ''}`}
            onClick={onCycleTheme}
            title={`Theme: ${theme} (click for ${THEME_NEXT[theme]})`}
          >
            <ThemeIcon size={16} />
            {!collapsed && <span>{theme}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}

function NavSection({ section, open, onToggle, collapsed, view, onChange }) {
  // In collapsed mode we never show section headers — items just stack.
  const showHeader = !collapsed && section.label && section.collapsible;
  const visible = collapsed || open || !section.collapsible;

  return (
    <div className="navrail2-section">
      {showHeader && (
        <button className="navrail2-sectionhead" onClick={onToggle}>
          <ChevronDown size={11} className={open ? '' : 'navrail2-rotate'} />
          <span>{section.label}</span>
        </button>
      )}
      {visible && section.items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`navrail2-item${view === id ? ' navrail2-item--active' : ''}${collapsed ? ' navrail2-item--collapsed' : ''}`}
          onClick={() => onChange(id)}
          title={label}
        >
          <Icon size={16} />
          {!collapsed && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
