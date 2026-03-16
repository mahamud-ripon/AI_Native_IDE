/**
 * Infrastructure Page
 * 
 * Displays VM pool metrics, cold start analytics, and resource utilization.
 * Uses D3.js heatmap for visualization.
 * Includes bulk VM operations.
 */

import { cookies } from 'next/headers';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { getVmPoolStats, getVmHeatmap, getVmInstances } from '@/lib/api/admin';
import { MetricCard, Card, Badge, EmptyState } from '@/components/ui';
import { VmHeatmap } from '@/components/visualizations/VmHeatmap';
import { VmInstancesTable } from './VmInstancesTable';
import { Header } from '@/components/layout';
import type { VmPoolStats, HeatmapCell, VmInstance } from '@/types';

export const dynamic = 'force-dynamic';

// Default empty stats
const emptyStats: VmPoolStats = {
  total: 0,
  running: 0,
  stopped: 0,
  error: 0,
  avgCpu: 0,
  avgMemory: 0,
  coldStartAvgMs: 0,
};

export default async function InfrastructurePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;
  const payload = await verifyAdminToken(token!);

  if (!payload || !hasPermission(payload, 'infrastructure:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // Fetch infrastructure data from API
  const [vmStatsResult, heatmapResult, vmInstancesResult] = await Promise.all([
    getVmPoolStats(),
    getVmHeatmap(),
    getVmInstances(),
  ]);

  const vmStats = vmStatsResult.success ? vmStatsResult.data! : emptyStats;
  const heatmapData = heatmapResult.success ? heatmapResult.data!.heatmap : [];
  const vmInstances = vmInstancesResult.success ? vmInstancesResult.data!.vms : [];
  
  const apiErrors = [
    !vmStatsResult.success && 'VM pool stats',
    !heatmapResult.success && 'VM heatmap',
    !vmInstancesResult.success && 'VM instances',
  ].filter(Boolean) as string[];

  const canWrite = hasPermission(payload, 'infrastructure:write');

  return (
    <div className="space-y-6">
      <Header 
        title="Infrastructure" 
        actions={
          <div className="flex items-center gap-4">
            <Badge variant={vmStats.running > 400 ? 'success' : 'warning'}>
              {vmStats.running} / {vmStats.total} VMs Running
            </Badge>
          </div>
        }
      />

      {apiErrors.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-yellow-800">
              Some data sources unavailable: {apiErrors.join(', ')}
            </span>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Running VMs"
          value={vmStats.running}
          change={vmStats.running - (vmStats.total - vmStats.running)}
        />
        <MetricCard
          title="Avg CPU"
          value={vmStats.avgCpu}
          unit="%"
        />
        <MetricCard
          title="Avg Memory"
          value={vmStats.avgMemory}
          unit="%"
        />
        <MetricCard
          title="Cold Start Avg"
          value={vmStats.coldStartAvgMs}
          unit="ms"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* VM Load Heatmap */}
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">VM Load by Hour</h3>
          {heatmapData.length > 0 ? (
            <VmHeatmap
              data={heatmapData}
              width={600}
              height={300}
              xLabels={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
              yLabels={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
            />
          ) : (
            <EmptyState title="No heatmap data" description="VM load data unavailable" />
          )}
        </Card>

        {/* Cold Start Analytics */}
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Cold Start Performance</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Average Delay</span>
              <span className="font-semibold">{vmStats.coldStartAvgMs}ms</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Stopped VMs</span>
              <span className="font-semibold">{vmStats.stopped}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-600">Error VMs</span>
              <span className="font-semibold text-danger-600">{vmStats.error}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* VM Instances Table with Bulk Operations */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">VM Instances</h3>
        <VmInstancesTable initialVms={vmInstances} canWrite={canWrite} />
      </Card>
    </div>
  );
}
