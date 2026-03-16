/**
 * VM Instances Table (Client Component)
 * 
 * Displays VM instances with bulk selection and actions.
 */

'use client';

import { useState, useTransition, useEffect } from 'react';
import { cn, formatDate } from '@/lib/utils';
import { Button, Badge, Card, Spinner, EmptyState } from '@/components/ui';
import { BulkActionBar, type BulkAction } from '@/components/ui/BulkActionBar';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { 
  BulkSelectionProvider, 
  useBulkSelection, 
} from '@/contexts/BulkSelectionContext';
import { bulkStopVms, bulkRestartVms, getVmInstances, stopVm, restartVm } from '@/lib/api/admin';
import type { VmInstance } from '@/types';

interface VmInstancesTableProps {
  initialVms?: VmInstance[];
  canWrite: boolean;
}

function VmInstancesTableInner({ initialVms = [], canWrite }: VmInstancesTableProps) {
  const [isPending, startTransition] = useTransition();
  const [vms, setVms] = useState<VmInstance[]>(initialVms);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped' | 'error'>('all');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const {
    selectedIds,
    hasSelection,
    isAllSelected,
    toggleItem,
    toggleAll,
    clearSelection,
    setAllItems,
  } = useBulkSelection<VmInstance>();

  // Update all items when VMs change
  useEffect(() => {
    setAllItems(vms);
  }, [vms, setAllItems]);

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Fetch VMs when filter changes
  useEffect(() => {
    const fetchVms = async () => {
      const result = await getVmInstances(statusFilter === 'all' ? undefined : statusFilter);
      if (result.success && result.data) {
        setVms(result.data.vms);
      }
    };
    fetchVms();
  }, [statusFilter]);

  const handleSingleAction = async (vmId: string, action: 'stop' | 'restart') => {
    startTransition(async () => {
      const result = action === 'stop' 
        ? await stopVm(vmId)
        : await restartVm(vmId);
      
      if (result.success) {
        setNotification({
          type: 'success',
          message: `VM ${action} initiated successfully`,
        });
        // Refresh VM list
        const refreshResult = await getVmInstances(statusFilter === 'all' ? undefined : statusFilter);
        if (refreshResult.success && refreshResult.data) {
          setVms(refreshResult.data.vms);
        }
      } else {
        setNotification({
          type: 'error',
          message: result.error?.message || `Failed to ${action} VM`,
        });
      }
    });
  };

  // Bulk actions
  const bulkActions: BulkAction[] = [
    {
      id: 'stop',
      label: 'Stop Selected',
      variant: 'danger',
      isDestructive: true,
      confirmation: {
        title: 'Stop VMs',
        message: 'Are you sure you want to stop the selected VMs? Users may lose access to their projects.',
        variant: 'warning',
      },
      onExecute: async (ids) => {
        const result = await bulkStopVms(ids);
        if (result.success && result.data) {
          const { succeeded, failed } = result.data;
          if (failed.length > 0) {
            setNotification({
              type: 'error',
              message: `Stopped ${succeeded.length} VMs. Failed: ${failed.length}`,
            });
          } else {
            setNotification({
              type: 'success',
              message: `Successfully stopped ${succeeded.length} VMs`,
            });
          }
          // Refresh VM list
          const refreshResult = await getVmInstances(statusFilter === 'all' ? undefined : statusFilter);
          if (refreshResult.success && refreshResult.data) {
            setVms(refreshResult.data.vms);
          }
          return { success: true };
        }
        return { success: false, error: result.error?.message };
      },
    },
    {
      id: 'restart',
      label: 'Restart Selected',
      variant: 'secondary',
      confirmation: {
        title: 'Restart VMs',
        message: 'Are you sure you want to restart the selected VMs? They will be temporarily unavailable.',
        variant: 'info',
      },
      onExecute: async (ids) => {
        const result = await bulkRestartVms(ids);
        if (result.success && result.data) {
          const { succeeded, failed } = result.data;
          if (failed.length > 0) {
            setNotification({
              type: 'error',
              message: `Restarted ${succeeded.length} VMs. Failed: ${failed.length}`,
            });
          } else {
            setNotification({
              type: 'success',
              message: `Successfully restarted ${succeeded.length} VMs`,
            });
          }
          // Refresh VM list
          const refreshResult = await getVmInstances(statusFilter === 'all' ? undefined : statusFilter);
          if (refreshResult.success && refreshResult.data) {
            setVms(refreshResult.data.vms);
          }
          return { success: true };
        }
        return { success: false, error: result.error?.message };
      },
    },
  ];

  const getStatusBadge = (status: VmInstance['status']) => {
    const variants: Record<VmInstance['status'], 'success' | 'warning' | 'danger' | 'default'> = {
      running: 'success',
      starting: 'warning',
      stopped: 'default',
      error: 'danger',
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Notification */}
      {notification && (
        <div
          className={cn(
            "fixed top-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg animate-slide-down",
            notification.type === 'success'
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          )}
        >
          {notification.message}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
        </select>

        <span className="text-sm text-gray-500">
          {vms.length} VM{vms.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden relative">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
            <Spinner size="lg" />
          </div>
        )}

        {vms.length === 0 ? (
          <EmptyState
            title="No VMs found"
            description={statusFilter === 'all' ? 'No VM instances available' : `No ${statusFilter} VMs`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      aria-label="Select all VMs"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">VM ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">CPU</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Memory</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Disk</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Started</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Last Heartbeat</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vms.map((vm) => (
                  <VmRow
                    key={vm.id}
                    vm={vm}
                    isSelected={selectedIds.has(vm.id)}
                    onToggleSelect={() => toggleItem(vm.id)}
                    canWrite={canWrite}
                    onStop={() => handleSingleAction(vm.id, 'stop')}
                    onRestart={() => handleSingleAction(vm.id, 'restart')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Bulk Action Bar */}
      {hasSelection && (
        <BulkActionBar
          selectionType="vm"
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          actions={canWrite ? bulkActions : []}
          onClearSelection={clearSelection}
        />
      )}
    </div>
  );
}

// Separate row component for better performance
interface VmRowProps {
  vm: VmInstance;
  isSelected: boolean;
  onToggleSelect: () => void;
  canWrite: boolean;
  onStop: () => void;
  onRestart: () => void;
}

function VmRow({
  vm,
  isSelected,
  onToggleSelect,
  canWrite,
  onStop,
  onRestart,
}: VmRowProps) {
  const getStatusBadge = (status: VmInstance['status']) => {
    const variants: Record<VmInstance['status'], 'success' | 'warning' | 'danger' | 'default'> = {
      running: 'success',
      starting: 'warning',
      stopped: 'default',
      error: 'danger',
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  return (
    <tr className={cn("hover:bg-gray-50", isSelected && "bg-primary-50")}>
      <td className="w-12 px-4 py-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          aria-label={`Select VM ${vm.id}`}
        />
      </td>
      <td className="px-4 py-3 font-mono text-xs text-gray-600">
        {vm.id.slice(0, 8)}...
      </td>
      <td className="px-4 py-3">
        {getStatusBadge(vm.status)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                vm.cpuPercent > 80 ? "bg-danger-500" : vm.cpuPercent > 50 ? "bg-yellow-500" : "bg-success-500"
              )}
              style={{ width: `${vm.cpuPercent}%` }}
            />
          </div>
          <span className="text-xs text-gray-600">{vm.cpuPercent}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600">
        {(vm.memoryMb / 1024).toFixed(1)} GB
      </td>
      <td className="px-4 py-3 text-gray-600">
        {(vm.diskMb / 1024).toFixed(1)} GB
      </td>
      <td className="px-4 py-3 text-gray-600">
        {formatDate(vm.startedAt, 'relative')}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {formatDate(vm.lastHeartbeat, 'relative')}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          {canWrite && vm.status === 'running' && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger-600"
              onClick={onStop}
            >
              Stop
            </Button>
          )}
          {canWrite && (vm.status === 'stopped' || vm.status === 'error') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRestart}
            >
              Restart
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Wrapper component with provider
export function VmInstancesTable(props: VmInstancesTableProps) {
  return (
    <BulkSelectionProvider selectionType="vm" getKey={(vm) => (vm as VmInstance).id}>
      <VmInstancesTableInner {...props} />
    </BulkSelectionProvider>
  );
}
