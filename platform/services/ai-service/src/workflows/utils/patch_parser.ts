/**
 * Patch Parser
 * 
 * Parses LLM output to extract code blocks and create patches.
 * Supports multiple formats:
 * - Markdown code blocks: ```typescript ... ```
 * - File markers: // File: path/to/file.ts
 * - Unified diff format
 */

export interface ParsedPatch {
  path: string;
  oldText?: string;
  newText: string;
  operation: 'create' | 'update' | 'delete';
}

/**
 * Parse LLM output to extract file patches
 */
export function parseLLMOutput(output: string): ParsedPatch[] {
  const patches: ParsedPatch[] = [];
  
  // Try to extract files from markdown code blocks with file markers
  const fileBlockRegex = /```(\w+)?\s*(?:\/\/\s*File:\s*([^\n]+)|([^\n]+))?[\n]([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  
  while ((match = fileBlockRegex.exec(output)) !== null) {
    const [, , pathFromComment, pathFromLine, code] = match;
    const path = (pathFromComment || pathFromLine || '').trim();
    
    if (path && code) {
      patches.push({
        path,
        newText: code.trim(),
        operation: 'create',
      });
    }
  }
  
  // If no file markers found, try to extract code blocks with common file patterns
  if (patches.length === 0) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    
    while ((match = codeBlockRegex.exec(output)) !== null) {
      const [, language, code] = match;
      
      // Try to infer file path from language and content
      const path = inferFilePath(language || '', code);
      
      if (path && code) {
        patches.push({
          path,
          newText: code.trim(),
          operation: 'create',
        });
      }
    }
  }
  
  // If still no patches, check for unified diff format
  if (patches.length === 0) {
    const diffPatches = parseUnifiedDiff(output);
    patches.push(...diffPatches);
  }
  
  return patches;
}

/**
 * Infer file path from language and code content
 */
function inferFilePath(language: string, code: string): string | null {
  // Check for common patterns in code
  const importMatch = code.match(/import.*from\s+['"]([^'\/]+)[^'"]*['"]/);
  const componentMatch = code.match(/(?:function|class|const)\s+([A-Z]\w*)/);
  
  // Map language to extension
  const extMap: Record<string, string> = {
    'typescript': 'ts',
    'tsx': 'tsx',
    'javascript': 'js',
    'jsx': 'jsx',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'python': 'py',
    'java': 'java',
    'go': 'go',
    'rust': 'rs',
  };
  
  const ext = extMap[language] || 'ts';
  
  // Infer path from content
  if (importMatch) {
    const componentName = importMatch[1].split('/').pop();
    if (componentName) {
      return `src/${componentName}.${ext}`;
    }
  }
  
  if (componentMatch) {
    const componentName = componentMatch[1];
    const fileName = componentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    return `src/${fileName}.${ext}`;
  }
  
  // Default paths based on language
  const defaults: Record<string, string> = {
    'typescript': 'src/index.ts',
    'tsx': 'src/App.tsx',
    'javascript': 'src/index.js',
    'jsx': 'src/App.jsx',
    'html': 'index.html',
    'css': 'src/styles.css',
    'json': 'package.json',
  };
  
  return defaults[language] || defaults['typescript'];
}

/**
 * Parse unified diff format
 */
function parseUnifiedDiff(diff: string): ParsedPatch[] {
  const patches: ParsedPatch[] = [];
  const lines = diff.split('\n');
  
  let currentFile: string | null = null;
  let addedLines: string[] = [];
  let removedLines: string[] = [];
  
  for (const line of lines) {
    // Match file header: +++ b/path/to/file.ts
    if (line.startsWith('+++ b/')) {
      // Save previous file if exists
      if (currentFile && addedLines.length > 0) {
        patches.push({
          path: currentFile,
          oldText: removedLines.join('\n'),
          newText: addedLines.join('\n'),
          operation: 'update',
        });
      }
      
      currentFile = line.substring(6);
      addedLines = [];
      removedLines = [];
    }
    
    // Match added lines
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push(line.substring(1));
    }
    
    // Match removed lines
    if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines.push(line.substring(1));
    }
  }
  
  // Save last file
  if (currentFile && (addedLines.length > 0 || removedLines.length > 0)) {
    patches.push({
      path: currentFile,
      oldText: removedLines.join('\n'),
      newText: addedLines.join('\n'),
      operation: removedLines.length > 0 ? 'update' : 'create',
    });
  }
  
  return patches;
}

/**
 * Validate patch
 */
export function validatePatch(patch: ParsedPatch): boolean {
  if (!patch.path || !patch.newText) {
    return false;
  }
  
  // Check for valid file extension - be more permissive
  const validExts = ['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.json', '.md', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.vue', '.svelte', '.scss', '.less', '.yaml', '.yml', '.toml', '.xml', '.txt'];
  const hasValidExt = validExts.some(ext => {
    const lowerPath = patch.path.toLowerCase();
    return lowerPath.endsWith(ext) || lowerPath.includes(`${ext}/`);
  });
  
  // If no valid extension, try to infer from path
  if (!hasValidExt) {
    // Allow paths that look like source files
    const srcPatterns = ['src/', 'app/', 'lib/', 'components/', 'pages/', 'api/', 'utils/', 'hooks/'];
    const hasSrcPattern = srcPatterns.some(pattern => patch.path.toLowerCase().includes(pattern));
    
    if (hasSrcPattern) {
      return patch.newText.length > 0 && patch.newText.length <= 1024 * 1024; // 1MB max
    }
    
    return false;
  }
  
  // Check for reasonable file size (max 1MB)
  if (patch.newText.length > 1024 * 1024) {
    return false;
  }
  
  // Check that content is not empty
  if (patch.newText.trim().length === 0) {
    return false;
  }
  
  return true;
}

/**
 * Format patches for frontend consumption
 */
export function formatPatchesForFrontend(patches: ParsedPatch[]): any[] {
  return patches.map((patch, index) => ({
    id: `patch_${Date.now()}_${index}`,
    path: patch.path,
    operation: patch.operation,
    oldText: patch.oldText,
    newText: patch.newText,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }));
}
