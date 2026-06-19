// App shell. Handles auth gate, view routing, and wires together the
// shared hooks (config, threads, gateway, models). Each view receives
// only the slice of state it needs.

import { useEffect, useRef, useState } from 'react';
import { useAuth }     from './hooks/useAuth.js';
import { voiceSettings } from './utils/voiceSettings.js';
import { load, save }  from './utils/storage.js';
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
  // Persist the current view so a browser refresh keeps the user on the same
  // page instead of bouncing back to Overview.
  const [view, setViewRaw] = useState(() => load('oc-view', 'overview'));
  const setView = (v) => { setViewRaw(v); save('oc-view', v); };

  // Pull the user's saved voice settings from the backend so the same
  // account has the same ElevenLabs config on every device they log into.
  useEffect(() => { voiceSettings.hydrateFromServer(); }, []);

  // When set, ChatView will join this session on next render and clear it.
  // Used by CronView's run-history "Open in chat" deep-link.
  const [pendingJoinKey, setPendingJoinKey] = useState(null);
  const openChatForSession = (sessionKey) => {
    setPendingJoinKey(sessionKey);
    setView('chat');
  };

  // When set, WorkspaceView will push a task frame on its nav stack so we
  // deep-link straight to the TaskDetail panel. Used by ApprovalsView's
  // row click — clicking an approval opens the task it's about.
  const [pendingTask, setPendingTask] = useState(null);   // { id, title } | null
  const openTask = (task) => {
    setPendingTask(task);
    setView('workspace');
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
                                              user={user} onLogout={onLogout}
                                              threadOps={threadOps} />}
        {view === 'chat'     && <ChatView config={configBundle} models={modelsBundle} threadOps={threadOps} gateway={gateway}
                                          pendingJoinKey={pendingJoinKey} onPendingJoinHandled={() => setPendingJoinKey(null)} />}
        {view === 'usage'    && <UsageView config={configBundle} gateway={gateway} />}
        {view === 'sessions' && <SessionsView gateway={gateway} />}
        {view === 'cron'     && <CronView gateway={gateway} onOpenSession={openChatForSession} />}
        {view === 'skills'   && <SkillsView gateway={gateway} config={configBundle} />}
        {view === 'channels' && <ChannelsView gateway={gateway} />}
        {view === 'agents'   && <AgentsView gateway={gateway} config={configBundle} />}
        {view === 'workspace'     && <WorkspaceView onOpenSession={openChatForSession}
                                                    pendingTask={pendingTask}
                                                    onPendingTaskHandled={() => setPendingTask(null)} />}
        {view === 'approvals'     && <ApprovalsView onOpenTask={openTask} />}
        {view === 'tags'          && <TagsView />}
        {view === 'custom-fields' && <CustomFieldsView />}
        {view === 'activity'      && <ActivityView />}
      </ErrorBoundary>
    </div>
  );
}
