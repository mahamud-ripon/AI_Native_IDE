/**
 * Analytics Page
 * 
 * Usage analytics with token consumption, trends, and insights.
 */

import { cookies } from 'next/headers';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { getUsageAnalytics } from '@/lib/api/admin';
import { MetricCard, Card, Badge, EmptyState } from '@/components/ui';
import { TokenTree } from '@/components/visualizations/TokenTree';
import { Header } from '@/components/layout';
import { AnalyticsExport } from '@/components/export/ExportButtons';
import type { UsageAnalytics, TreemapNode } from '@/types';

export const dynamic = 'force-dynamic';

// Empty analytics for error state
const emptyAnalytics: UsageAnalytics = {
  hourly: [],
  daily: [],
  byAgent: {},
  byModel: {},
  byUser: { name: 'No Data', value: 0 },
};

interface AnalyticsPageProps {
  searchParams: Promise<{
    period?: '7d' | '30d' | '90d';
  }>;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const { period = '7d' } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;

  if (!token) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Authentication required. Please log in.</p>
      </div>
    );
  }

  const payload = await verifyAdminToken(token);

  if (!payload || !hasPermission(payload, 'analytics:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // Fetch analytics data from API
  const response = await getUsageAnalytics(period);
  const analytics = response.success && response.data ? response.data : emptyAnalytics;
  const apiError = !response.success ? response.error?.message : null;

  // Calculate total tokens
  const totalTokens = Object.values(analytics.byModel).reduce((a, b) => a + b, 0);

  // Build treemap data from analytics
  const treemapData: TreemapNode = {
    name: 'Token Usage',
    value: totalTokens,
    children: Object.entries(analytics.byModel).map(([model, tokens]) => ({
      name: model,
      value: tokens,
    })),
  };

  return (
    <div className="space-y-6">
      <Header 
        title="Usage Analytics" 
        actions={
          <div className="flex items-center gap-4">
            <AnalyticsExport analytics={analytics} period={period} disabled={totalTokens === 0} />
            <div className="flex items-center gap-2">
              {(['7d', '30d', '90d'] as const).map((p) => (
                <a
                  key={p}
                  href={`/analytics?period=${p}`}
                  className={`px-3 py-1 rounded-lg text-sm ${
                    period === p
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p}
                </a>
              ))}
            </div>
          </div>
        }
      />

      {apiError && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-yellow-800">{apiError}</span>
          </div>
        </div>
      )}

      {/* Token Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Tokens"
          value={(totalTokens / 1000000).toFixed(1)}
          unit="M"
          change={5.2}
        />
        <MetricCard
          title="GPT-4 Usage"
          value={((analytics.byModel['gpt-4'] || 0) / 1000000).toFixed(1)}
          unit="M"
          change={3.1}
        />
        <MetricCard
          title="Claude-3 Usage"
          value={((analytics.byModel['claude-3'] || 0) / 1000000).toFixed(1)}
          unit="M"
          change={8.5}
        />
        <MetricCard
          title="Total Models"
          value={Object.keys(analytics.byModel).length}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Usage Treemap */}
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Token Distribution by Model</h3>
          <TokenTree
            data={treemapData}
            width={600}
            height={400}
          />
        </Card>

        {/* Model Breakdown */}
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Usage by Model</h3>
          <div className="space-y-4">
            {Object.entries(analytics.byModel).map(([model, tokens]) => {
              const percentage = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
              
              return (
                <div key={model} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{model}</span>
                    <span className="text-gray-600">
                      {(tokens / 1000000).toFixed(1)}M ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Top Users */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">Top Token Consumers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tokens Used</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Share</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {analytics.byUser.children?.map((user, i) => {
                const percentage = totalTokens > 0 ? (user.value / totalTokens) * 100 : 0;
                
                return (
                  <tr key={user.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                          {i + 1}
                        </span>
                        {user.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(user.value / 1000000).toFixed(1)}M
                    </td>
                    <td className="px-4 py-3">
                      {percentage.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${i < 3 ? 'bg-primary-500' : 'bg-gray-400'}`}
                          style={{ width: `${Math.min(percentage * 2, 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Agent Usage */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">Usage by Agent</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(analytics.byAgent).map(([agent, tokens]) => (
            <div key={agent} className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">{agent}</p>
              <p className="text-xl font-bold">{(tokens / 1000000).toFixed(1)}M</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
