/**
 * Export Utilities for Admin Panel
 * 
 * Provides CSV and PDF export functionality for analytics and audit data.
 */

import { formatDate, formatNumber, formatCurrency } from './utils';
import type { UsageAnalytics, AuditLog } from '@/types';

// ============================================
// CSV Export
// ============================================

/**
 * Convert data array to CSV string
 */
export function toCSV<T extends object>(
  data: T[],
  columns: { key: keyof T; header: string; format?: (value: T[keyof T]) => string }[]
): string {
  const headers = columns.map(col => col.header).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const value = row[col.key];
      const formatted = col.format ? col.format(value) : String(value ?? '');
      // Escape quotes and wrap in quotes if contains comma or quote
      if (formatted.includes(',') || formatted.includes('"') || formatted.includes('\n')) {
        return `"${formatted.replace(/"/g, '""')}"`;
      }
      return formatted;
    }).join(',')
  );
  return [headers, ...rows].join('\n');
}

/**
 * Download a file in the browser
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export analytics data to CSV
 */
export function exportAnalyticsCSV(analytics: UsageAnalytics, period: string): void {
  const modelData = Object.entries(analytics.byModel).map(([model, tokens]) => ({
    model,
    tokens,
    percentage: analytics.byModel[model] / Object.values(analytics.byModel).reduce((a, b) => a + b, 0) * 100,
  }));

  const agentData = Object.entries(analytics.byAgent).map(([agent, tokens]) => ({
    agent,
    tokens,
    percentage: analytics.byAgent[agent] / Object.values(analytics.byAgent).reduce((a, b) => a + b, 0) * 100,
  }));

  const userData = analytics.byUser.children?.map(user => ({
    user: user.name,
    tokens: user.value,
    percentage: user.value / analytics.byUser.value * 100,
  })) || [];

  // Combine all data into sections
  const csvParts: string[] = [];

  // Model usage section
  csvParts.push('Model Usage Report');
  csvParts.push(toCSV(modelData, [
    { key: 'model', header: 'Model' },
    { key: 'tokens', header: 'Tokens', format: v => formatNumber(v as number) },
    { key: 'percentage', header: 'Percentage', format: v => `${(v as number).toFixed(2)}%` },
  ]));
  csvParts.push('');

  // Agent usage section
  csvParts.push('Agent Usage Report');
  csvParts.push(toCSV(agentData, [
    { key: 'agent', header: 'Agent' },
    { key: 'tokens', header: 'Tokens', format: v => formatNumber(v as number) },
    { key: 'percentage', header: 'Percentage', format: v => `${(v as number).toFixed(2)}%` },
  ]));
  csvParts.push('');

  // User usage section
  csvParts.push('Top Users by Token Consumption');
  csvParts.push(toCSV(userData, [
    { key: 'user', header: 'User' },
    { key: 'tokens', header: 'Tokens', format: v => formatNumber(v as number) },
    { key: 'percentage', header: 'Percentage', format: v => `${(v as number).toFixed(2)}%` },
  ]));

  const filename = `analytics-report-${period}-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`;
  downloadFile(csvParts.join('\n'), filename, 'text/csv');
}

/**
 * Export audit logs to CSV
 */
export function exportAuditLogsCSV(logs: AuditLog[], filters?: { targetType?: string }): void {
  const csv = toCSV(logs, [
    { key: 'timestamp', header: 'Timestamp', format: v => formatDate(v as string, 'yyyy-MM-dd HH:mm:ss') },
    { key: 'adminEmail', header: 'Admin' },
    { key: 'action', header: 'Action' },
    { key: 'targetType', header: 'Target Type' },
    { key: 'targetId', header: 'Target ID' },
    { key: 'ipAddress', header: 'IP Address' },
    { key: 'details', header: 'Details', format: v => JSON.stringify(v) },
  ]);

  const filterSuffix = filters?.targetType ? `-${filters.targetType}` : '';
  const filename = `audit-logs${filterSuffix}-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`;
  downloadFile(csv, filename, 'text/csv');
}

// ============================================
// PDF Export (HTML-based, browser-native)
// ============================================

/**
 * Generate HTML content for PDF export
 */
function generatePDFHtml(
  title: string,
  content: string,
  metadata: { generated: string; period?: string }
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #333;
      margin: 40px;
    }
    h1 {
      font-size: 24px;
      color: #1a1a1a;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    h2 {
      font-size: 16px;
      color: #374151;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background-color: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    tr:nth-child(even) {
      background-color: #f9fafb;
    }
    .metadata {
      font-size: 10px;
      color: #6b7280;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .metric-card {
      display: inline-block;
      padding: 15px 20px;
      background: #f9fafb;
      border-radius: 8px;
      margin-right: 15px;
      margin-bottom: 15px;
    }
    .metric-label {
      font-size: 10px;
      color: #6b7280;
      text-transform: uppercase;
    }
    .metric-value {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
    }
    .progress-bar {
      background: #e5e7eb;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      background: #3b82f6;
      height: 100%;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${content}
  <div class="metadata">
    <p>Generated: ${metadata.generated}</p>
    ${metadata.period ? `<p>Period: ${metadata.period}</p>` : ''}
    <p>Admin Dashboard - AI-Native-IDE Platform</p>
  </div>
</body>
</html>`;
}

/**
 * Export analytics data to PDF
 */
export function exportAnalyticsPDF(analytics: UsageAnalytics, period: string): void {
  const totalTokens = Object.values(analytics.byModel).reduce((a, b) => a + b, 0);
  const totalAgents = Object.values(analytics.byAgent).reduce((a, b) => a + b, 0);

  const modelRows = Object.entries(analytics.byModel)
    .map(([model, tokens]) => {
      const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
      return `
        <tr>
          <td>${model}</td>
          <td>${formatNumber(tokens)}</td>
          <td>${pct.toFixed(1)}%</td>
          <td>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(pct * 2, 100)}%"></div>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  const agentRows = Object.entries(analytics.byAgent)
    .map(([agent, tokens]) => {
      const pct = totalAgents > 0 ? (tokens / totalAgents) * 100 : 0;
      return `
        <tr>
          <td>${agent}</td>
          <td>${formatNumber(tokens)}</td>
          <td>${pct.toFixed(1)}%</td>
        </tr>`;
    })
    .join('');

  const userRows = analytics.byUser.children?.slice(0, 10)
    .map(user => {
      const pct = analytics.byUser.value > 0 ? (user.value / analytics.byUser.value) * 100 : 0;
      return `
        <tr>
          <td>${user.name}</td>
          <td>${formatNumber(user.value)}</td>
          <td>${pct.toFixed(1)}%</td>
        </tr>`;
    })
    .join('') || '';

  const content = `
    <div style="margin-bottom: 30px;">
      <div class="metric-card">
        <div class="metric-label">Total Tokens</div>
        <div class="metric-value">${formatNumber(totalTokens)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Models Used</div>
        <div class="metric-value">${Object.keys(analytics.byModel).length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Agents Active</div>
        <div class="metric-value">${Object.keys(analytics.byAgent).length}</div>
      </div>
    </div>

    <h2>Token Usage by Model</h2>
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Tokens</th>
          <th>Share</th>
          <th>Distribution</th>
        </tr>
      </thead>
      <tbody>
        ${modelRows}
      </tbody>
    </table>

    <h2>Token Usage by Agent</h2>
    <table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Tokens</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        ${agentRows}
      </tbody>
    </table>

    <h2>Top Token Consumers</h2>
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Tokens</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        ${userRows}
      </tbody>
    </table>
  `;

  const html = generatePDFHtml(
    'Usage Analytics Report',
    content,
    {
      generated: formatDate(new Date(), 'MMMM d, yyyy h:mm a'),
      period: period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : 'Last 90 days',
    }
  );

  const filename = `analytics-report-${period}-${formatDate(new Date(), 'yyyy-MM-dd')}.html`;
  downloadFile(html, filename, 'text/html');
}

/**
 * Export audit logs to PDF
 */
export function exportAuditLogsPDF(logs: AuditLog[], filters?: { targetType?: string }): void {
  const logRows = logs.slice(0, 100).map(log => `
    <tr>
      <td>${formatDate(log.timestamp, 'yyyy-MM-dd HH:mm')}</td>
      <td>${log.adminEmail}</td>
      <td>${log.action}</td>
      <td>${log.targetType}</td>
      <td>${log.targetId}</td>
      <td>${log.ipAddress || '-'}</td>
    </tr>
  `).join('');

  const content = `
    <h2>Audit Log Entries</h2>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Total records: ${logs.length}${filters?.targetType ? ` (filtered by: ${filters.targetType})` : ''}
    </p>
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Admin</th>
          <th>Action</th>
          <th>Target Type</th>
          <th>Target ID</th>
          <th>IP Address</th>
        </tr>
      </thead>
      <tbody>
        ${logRows}
      </tbody>
    </table>
  `;

  const filterSuffix = filters?.targetType ? ` (${filters.targetType})` : '';
  const html = generatePDFHtml(
    'Audit Logs Report',
    content,
    {
      generated: formatDate(new Date(), 'MMMM d, yyyy h:mm a'),
    }
  );

  const filename = `audit-logs-${formatDate(new Date(), 'yyyy-MM-dd')}.html`;
  downloadFile(html, filename, 'text/html');
}

// ============================================
// Billing Report Export
// ============================================

interface BillingData {
  period: string;
  totalCost: number;
  tokensUsed: number;
  tokensCached: number;
  cacheSavings: number;
  breakdown: {
    model: string;
    tokens: number;
    cost: number;
  }[];
}

/**
 * Export billing report to CSV
 */
export function exportBillingCSV(data: BillingData): void {
  const csv = toCSV(data.breakdown, [
    { key: 'model', header: 'Model' },
    { key: 'tokens', header: 'Tokens', format: v => formatNumber(v as number) },
    { key: 'cost', header: 'Cost (USD)', format: v => formatCurrency(v as number) },
  ]);

  const summary = `
Billing Summary
Period,${data.period}
Total Cost,${formatCurrency(data.totalCost)}
Total Tokens,${formatNumber(data.tokensUsed)}
Cached Tokens,${formatNumber(data.tokensCached)}
Cache Savings,${formatCurrency(data.cacheSavings)}

Breakdown by Model
${csv}`;

  const filename = `billing-report-${data.period.replace(/\s+/g, '-')}-${formatDate(new Date(), 'yyyy-MM-dd')}.csv`;
  downloadFile(summary, filename, 'text/csv');
}

/**
 * Export billing report to PDF
 */
export function exportBillingPDF(data: BillingData): void {
  const breakdownRows = data.breakdown.map(item => `
    <tr>
      <td>${item.model}</td>
      <td>${formatNumber(item.tokens)}</td>
      <td>${formatCurrency(item.cost)}</td>
    </tr>
  `).join('');

  const content = `
    <div style="margin-bottom: 30px;">
      <div class="metric-card">
        <div class="metric-label">Total Cost</div>
        <div class="metric-value">${formatCurrency(data.totalCost)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Tokens Used</div>
        <div class="metric-value">${formatNumber(data.tokensUsed)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Cache Savings</div>
        <div class="metric-value" style="color: #059669;">${formatCurrency(data.cacheSavings)}</div>
      </div>
    </div>

    <h2>Cost Breakdown by Model</h2>
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${breakdownRows}
      </tbody>
    </table>
  `;

  const html = generatePDFHtml(
    'Billing Report',
    content,
    {
      generated: formatDate(new Date(), 'MMMM d, yyyy h:mm a'),
      period: data.period,
    }
  );

  const filename = `billing-report-${data.period.replace(/\s+/g, '-')}-${formatDate(new Date(), 'yyyy-MM-dd')}.html`;
  downloadFile(html, filename, 'text/html');
}
