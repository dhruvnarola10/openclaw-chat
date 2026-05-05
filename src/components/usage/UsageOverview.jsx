// Card grid that renders the parsed usage payload.

import { compactNumber, formatCost, formatPct } from '../../utils/format.js';
import { RankCard, StatCard } from './UsageCard.jsx';

export default function UsageOverview({ data }) {
  if (!data) return null;
  return (
    <div className="usage-overview">
      <h2 className="usage-section">Usage Overview</h2>

      <div className="usage-grid">
        <StatCard
          title="MESSAGES"
          value={compactNumber(data.messages)}
          hint={`${compactNumber(data.userMessages)} user · ${compactNumber(data.assistantMessages)} assistant`}
        />
        <StatCard
          title="THROUGHPUT"
          value={`${compactNumber(data.tokensPerMin)} tok/min`}
          hint={`${formatCost(data.costPerMin)} / min`}
        />
        <StatCard
          title="TOOL CALLS"
          value={compactNumber(data.toolCalls)}
          hint={`${data.uniqueTools ?? 0} tools used`}
        />
        <StatCard
          title="AVG TOKENS / MSG"
          value={compactNumber(data.avgTokensPerMsg)}
          hint={`Across ${compactNumber(data.messages)} messages`}
        />

        <RankCard
          title="TOP MODELS"
          rows={data.topModels ?? []}
          valueFormat={formatCost}
        />
        <RankCard
          title="TOP PROVIDERS"
          rows={data.topProviders ?? []}
          valueFormat={formatCost}
        />
        <RankCard
          title="TOP TOOLS"
          rows={(data.topTools ?? []).map((r) => ({ ...r, value: r.count }))}
          valueFormat={(v) => v == null ? '' : compactNumber(v)}
        />

        <StatCard
          title="CACHE HIT RATE"
          value={formatPct(data.cacheHitRate)}
          hint={`${compactNumber(data.cachedTokens)} cached · ${compactNumber(data.promptTokens)} prompt`}
          accent={data.cacheHitRate > 0 ? 'good' : 'warn'}
        />
        <StatCard
          title="ERROR RATE"
          value={formatPct(data.errorRate)}
          hint={`${compactNumber(data.errors)} errors`}
          accent={data.errorRate > 0.05 ? 'bad' : 'good'}
        />
        <StatCard
          title="AVG COST / MSG"
          value={formatCost(data.avgCostPerMsg)}
          hint={`${formatCost(data.totalCost)} total`}
        />
        <StatCard
          title="SESSIONS"
          value={compactNumber(data.sessions)}
          hint={`${data.activeSessions ?? 0} active`}
        />
        <StatCard
          title="ERRORS"
          value={compactNumber(data.errors)}
          hint={`${compactNumber(data.toolErrors)} tool errors`}
          accent={data.errors > 0 ? 'bad' : undefined}
        />

        <RankCard
          title="TOP AGENTS"
          rows={data.topAgents ?? []}
          valueFormat={formatCost}
        />
        <RankCard
          title="TOP CHANNELS"
          rows={data.topChannels ?? []}
          valueFormat={formatCost}
        />
        <RankCard
          title="PEAK ERROR DAYS"
          rows={data.peakErrorDays ?? []}
          valueFormat={formatPct}
        />
      </div>
    </div>
  );
}
