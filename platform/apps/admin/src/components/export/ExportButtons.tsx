/**
 * Export Buttons Component
 * 
 * Client component for triggering CSV and PDF exports.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import {
  exportAnalyticsCSV,
  exportAnalyticsPDF,
  exportAuditLogsCSV,
  exportAuditLogsPDF,
} from '@/lib/export';
import type { UsageAnalytics, AuditLog } from '@/types';

interface ExportButtonsProps {
  onExport: (format: 'csv' | 'pdf') => void;
  entityName: string;
  disabled?: boolean;
}

export function ExportButtons({ onExport, entityName, disabled }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState<'csv' | 'pdf' | null>(null);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setIsExporting(format);
    try {
      onExport(format);
    } finally {
      setTimeout(() => setIsExporting(null), 500);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => handleExport('csv')}
        disabled={disabled || isExporting !== null}
        className="text-xs"
      >
        {isExporting === 'csv' ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Exporting...
          </>
        ) : (
          <>
            <svg className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            CSV
          </>
        )}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => handleExport('pdf')}
        disabled={disabled || isExporting !== null}
        className="text-xs"
      >
        {isExporting === 'pdf' ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Exporting...
          </>
        ) : (
          <>
            <svg className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
            PDF
          </>
        )}
      </Button>
    </div>
  );
}

// ============================================
// Analytics Export Wrapper
// ============================================

interface AnalyticsExportProps {
  analytics: UsageAnalytics;
  period: string;
  disabled?: boolean;
}

export function AnalyticsExport({ analytics, period, disabled }: AnalyticsExportProps) {
  const handleExport = (format: 'csv' | 'pdf') => {
    if (format === 'csv') {
      exportAnalyticsCSV(analytics, period);
    } else {
      exportAnalyticsPDF(analytics, period);
    }
  };

  return (
    <ExportButtons
      onExport={handleExport}
      entityName="Analytics"
      disabled={disabled}
    />
  );
}

// ============================================
// Audit Logs Export Wrapper
// ============================================

interface AuditLogsExportProps {
  logs: AuditLog[];
  filters?: { targetType?: string };
  disabled?: boolean;
}

export function AuditLogsExport({ logs, filters, disabled }: AuditLogsExportProps) {
  const handleExport = (format: 'csv' | 'pdf') => {
    if (format === 'csv') {
      exportAuditLogsCSV(logs, filters);
    } else {
      exportAuditLogsPDF(logs, filters);
    }
  };

  return (
    <ExportButtons
      onExport={handleExport}
      entityName="Audit Logs"
      disabled={disabled || logs.length === 0}
    />
  );
}
