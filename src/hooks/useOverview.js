// Polls the gateway for the Overview snapshot. Each section is fetched
// independently so a single failing method doesn't break the whole page.
//
// • Loads once when the gateway becomes ready
// • Refreshes every 30 s (configurable)
// • Exposes a manual `refresh()` for the toolbar refresh button

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchOverview,
  pickNode, pickUsage, pickSessions, pickModels,
  pickSkills, pickCron, pickChannels, pickUsageStatus,
} from '../api/overview.js';

const REFRESH_MS = 30_000;

export function useOverview({ gateway, autoRefresh = true }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [lastAt,  setLastAt]  = useState(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (gateway?.status !== 'on' || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');

    try {
      const raw = await fetchOverview({
        request: gateway.request,
        status:  gateway.status,
      });
      setData({
        node:        pickNode(raw.node?.payload),
        usage:       pickUsage(raw.usage?.payload),
        usageStatus: pickUsageStatus(raw.usageStatus?.payload),
        sessions:    pickSessions(raw.sessions?.payload),
        models:      pickModels(raw.models?.payload),
        skills:      pickSkills(raw.skills?.payload),
        cron:        pickCron(raw.cron?.payload),
        channels:    pickChannels(raw.channels?.payload),
        sources: {
          node:        raw.node?.method,
          usage:       raw.usage?.method,
          usageStatus: raw.usageStatus?.method,
          sessions:    raw.sessions?.method,
          models:      raw.models?.method,
          skills:      raw.skills?.method,
          cron:        raw.cron?.method,
          channels:    raw.channels?.method,
        },
        errors: raw.errors,
      });
      setLastAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [gateway]);

  // Fetch when the gateway connects.
  useEffect(() => {
    if (gateway?.status === 'on') refresh();
  }, [gateway?.status, refresh]);

  // Auto-refresh while connected.
  useEffect(() => {
    if (!autoRefresh) return;
    if (gateway?.status !== 'on') return;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, gateway?.status, refresh]);

  return { data, loading, error, lastAt, refresh };
}
