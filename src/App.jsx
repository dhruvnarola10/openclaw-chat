// App shell. Handles auth gate, view routing, and wires together the
// shared hooks (config, threads, gateway, models). Each view receives
// only the slice of state it needs.

import { useRef, useState } from 'react';
import { useAuth }     from './hooks/useAuth.js';
import { useConfig }   from './hooks/useConfig.js';
import { useGateway }  from './hooks/useGateway.js';
import { useModels }   from './hooks/useModels.js';
import { useThreads }  from './hooks/useThreads.js';
import { useTheme }    from './hooks/useTheme.js';
import LoginScreen     from './components/auth/LoginScreen.jsx';
import NavRail         from './components/nav/NavRail.jsx';
import ChatView        from './views/ChatView.jsx';
import UsageView       from './components/usage/UsageView.jsx';
import OverviewView    from './components/overview/OverviewView.jsx';
import SessionsView    from './components/sessions/SessionsView.jsx';
import CronView        from './components/cron/CronView.jsx';
import SkillsView      from './components/skills/SkillsView.jsx';
import ChannelsView    from './components/channels/ChannelsView.jsx';
import AgentsView      from './components/agents/AgentsView.jsx';
import WorkspaceView    from './components/workspace/WorkspaceView.jsx';
import ApprovalsView    from './components/workspace/ApprovalsView.jsx';
import TagsView         from './components/workspace/TagsView.jsx';
import CustomFieldsView from './components/workspace/CustomFieldsView.jsx';
import ActivityView     from './components/workspace/ActivityView.jsx';
import ErrorBoundary   from './components/common/ErrorBoundary.jsx';

export default function App() {
  const auth = useAuth();
  // While we re-validate a saved token on boot, show nothing — avoids a
  // flash of the login screen for already-signed-in users.
  if (auth.authed && !auth.bootChecked) return <div className="login-screen" />;
  if (!auth.authed) {
    return <LoginScreen onLogin={auth.login} onRegister={auth.register} />;
  }
  return <Authed onLogout={auth.logout} user={auth.user} />;
}

function Authed({ onLogout, user }) {
  const [view, setView] = useState('overview');
  // When set, ChatView will join this session on next render and clear it.
  // Used by CronView's run-history "Open in chat" deep-link.
  const [pendingJoinKey, setPendingJoinKey] = useState(null);
  const openChatForSession = (sessionKey) => {
    setPendingJoinKey(sessionKey);
    setView('chat');
  };
  const { theme, cycleTheme } = useTheme();

  // agentId:  config.agentId,
  const config    = useConfig();
  const threadOps = useThreads({ agentId: config.agentId });
  const models    = useModels({
    model:    config.model,
    setModel: config.setModel,
  });

  // Token ref kept current for the WebSocket auth callback.
  const tokenRef = useRef(config.token);
  tokenRef.current = config.token;

  const gateway = useGateway({
    tokenRef,
    onModelsList: models.setModelsFromWs,
  });

  const configBundle = {
    ...config,
  };
  const modelsBundle = {
    list:     models.models,
    loading:  models.loading,
    error:    models.error,
    onRefresh: models.refresh,
  };

  return (
    <div className="app">
      <NavRail view={view} onChange={setView} />

      <ErrorBoundary key={view}>
        {view === 'overview' && <OverviewView config={configBundle} gateway={gateway}
                                              theme={theme} onCycleTheme={cycleTheme}
                                              user={user} onLogout={onLogout} />}
        {view === 'chat'     && <ChatView config={configBundle} models={modelsBundle} threadOps={threadOps} gateway={gateway}
                                          pendingJoinKey={pendingJoinKey} onPendingJoinHandled={() => setPendingJoinKey(null)} />}
        {view === 'usage'    && <UsageView config={configBundle} gateway={gateway} />}
        {view === 'sessions' && <SessionsView gateway={gateway} />}
        {view === 'cron'     && <CronView gateway={gateway} onOpenSession={openChatForSession} />}
        {view === 'skills'   && <SkillsView gateway={gateway} config={configBundle} />}
        {view === 'channels' && <ChannelsView gateway={gateway} />}
        {view === 'agents'   && <AgentsView gateway={gateway} config={configBundle} />}
        {view === 'workspace'     && <WorkspaceView onOpenSession={openChatForSession} />}
        {view === 'approvals'     && <ApprovalsView />}
        {view === 'tags'          && <TagsView />}
        {view === 'custom-fields' && <CustomFieldsView />}
        {view === 'activity'      && <ActivityView />}
      </ErrorBoundary>
    </div>
  );
}
