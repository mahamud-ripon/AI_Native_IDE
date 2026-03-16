import { prisma } from '@workspace/database';

const logger = {
  info: (msg: string) => console.log(`[AI Code Scanner] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[AI Code Scanner] ${msg}`, err),
  warn: (msg: string) => console.warn(`[AI Code Scanner] ${msg}`),
};

// Security patterns to detect
const SECURITY_PATTERNS = [
  // API Keys and secrets
  { pattern: /(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})/g, type: 'api_key', severity: 'critical' },
  { pattern: /(?:xox[baprs]-[a-zA-Z0-9-]{10,})/g, type: 'slack_token', severity: 'critical' },
  { pattern: /(?:eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)/g, type: 'jwt_token', severity: 'high' },
  
  // Dangerous functions
  { pattern: /eval\s*\(/g, type: 'eval_usage', severity: 'high' },
  { pattern: /Function\s*\(/g, type: 'function_constructor', severity: 'high' },
  { pattern: /exec\s*\(/g, type: 'exec_usage', severity: 'medium' },
  
  // SQL injection patterns
  { pattern: /(?:'\s*OR\s+'.*'\s*=\s*'|UNION\s+SELECT|DROP\s+TABLE)/gi, type: 'sql_injection', severity: 'critical' },
  
  // Hardcoded passwords
  { pattern: /(?:password\s*=\s*['"][^'"]+['"]|passwd\s*=\s*['"][^'"]+['"])/gi, type: 'hardcoded_password', severity: 'high' },
];

interface ScanResult {
  fileId: string;
  projectId: string;
  issues: Array<{
    type: string;
    severity: string;
    line?: number;
    match?: string;
  }>;
  passed: boolean;
}

export async function scanGeneratedCode(data: {
  fileId: string;
  projectId: string;
  content: string;
  language?: string;
}): Promise<ScanResult> {
  const { fileId, projectId, content, language } = data;

  logger.info(`Scanning file ${fileId} for security issues`);

  const issues: ScanResult['issues'] = [];
  const lines = content.split('\n');

  // Run all security patterns
  for (const { pattern, type, severity } of SECURITY_PATTERNS) {
    const matches = content.matchAll(pattern);

    for (const match of matches) {
      // Find line number
      const lineNum = content.substring(0, match.index).split('\n').length;

      // Mask sensitive matches
      const maskedMatch = maskSensitiveMatch(match[0], type);

      issues.push({
        type,
        severity,
        line: lineNum,
        match: maskedMatch,
      });
    }
  }

  const passed = issues.length === 0 || !issues.some(i => i.severity === 'critical');

  // Store scan result in database
  try {
    await prisma.auditLog.create({
      data: {
        action: 'ai_code_scan',
        resourceType: 'file',
        resourceId: fileId,
        userId: 'system',
        metadata: {
          projectId,
          language,
          issuesFound: issues.length,
          criticalIssues: issues.filter(i => i.severity === 'critical').length,
          passed,
          issues: issues.map(i => ({
            type: i.type,
            severity: i.severity,
            line: i.line,
          })),
        },
      },
    });
  } catch (error: any) {
    logger.error(`Failed to store scan result:`, error.message);
  }

  logger.info(`Scan complete for ${fileId}: ${issues.length} issues found, passed: ${passed}`);

  return {
    fileId,
    projectId,
    issues,
    passed,
  };
}

function maskSensitiveMatch(match: string, type: string): string {
  if (type === 'api_key' || type === 'slack_token' || type === 'jwt_token' || type === 'hardcoded_password') {
    if (match.length > 8) {
      return match.substring(0, 4) + '***' + match.substring(match.length - 4);
    }
    return '***';
  }
  return match;
}

export async function scanProjectFiles(data: {
  projectId: string;
  fileIds: string[];
}): Promise<ScanResult[]> {
  const { projectId, fileIds } = data;

  logger.info(`Scanning ${fileIds.length} files in project ${projectId}`);

  const results: ScanResult[] = [];

  for (const fileId of fileIds) {
    try {
      const file = await prisma.projectFile.findUnique({
        where: { id: fileId },
        select: { inlineContent: true, path: true },
      });

      if (file?.inlineContent) {
        const content = file.inlineContent.toString('utf-8');
        const result = await scanGeneratedCode({
          fileId,
          projectId,
          content,
          language: getLanguageFromPath(file.path),
        });
        results.push(result);
      }
    } catch (error: any) {
      logger.error(`Failed to scan file ${fileId}:`, error.message);
    }
  }

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const criticalIssues = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length, 0);

  logger.info(`Project scan complete: ${totalIssues} issues (${criticalIssues} critical)`);

  return results;
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
  };
  return langMap[ext || ''] || 'unknown';
}
