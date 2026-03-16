/**
 * Users Export Component
 * 
 * Wrapper for exporting users data to CSV/JSON format.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import type { User } from '@/types';

interface UsersExportProps {
  users: User[];
  disabled?: boolean;
}

export function UsersExport({ users, disabled }: UsersExportProps) {
  const [isExporting, setIsExporting] = useState<'csv' | 'json' | null>(null);

  const exportToCSV = () => {
    const headers = [
      'ID',
      'Email',
      'Name',
      'Status',
      'Plan',
      'Created At',
      'Last Active',
      'Projects',
      'Tokens Used',
      'Tokens Limit',
    ];

    const rows = users.map(user => [
      user.id,
      user.email,
      user.name,
      user.status,
      user.plan,
      user.createdAt,
      user.lastActiveAt,
      user.projectsCount.toString(),
      user.tokensUsed.toString(),
      user.tokensLimit.toString(),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    downloadFile(csv, 'users-export.csv', 'text/csv');
  };

  const exportToJSON = () => {
    const data = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      plan: user.plan,
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
      projectsCount: user.projectsCount,
      tokensUsed: user.tokensUsed,
      tokensLimit: user.tokensLimit,
    }));

    downloadFile(JSON.stringify(data, null, 2), 'users-export.json', 'application/json');
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setIsExporting(format);
    try {
      if (format === 'csv') {
        exportToCSV();
      } else {
        exportToJSON();
      }
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
        disabled={disabled || isExporting !== null || users.length === 0}
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
        onClick={() => handleExport('json')}
        disabled={disabled || isExporting !== null || users.length === 0}
        className="text-xs"
      >
        {isExporting === 'json' ? (
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
            JSON
          </>
        )}
      </Button>
    </div>
  );
}
