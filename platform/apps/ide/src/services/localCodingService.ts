/**
 * Local AI Coding Service
 *
 * Client-side AI coding that uses Groq to generate code and applies
 * patches directly without needing a backend server.
 *
 * Workflow:
 * 1. Detect coding intent from user message
 * 2. Use Groq to generate structured patch format
 * 3. Parse AI response to extract file changes
 * 4. Apply changes via editorManager
 * 5. Track progress and show status
 *
 * Architecture:
 *   User Message
 *       ↓
 *   detectCodingIntent()
 *       ↓
 *   generateCodePatches() → Groq API
 *       ↓
 *   parsePatchResponse()
 *       ↓
 *   applyPatches() → editorManager
 *       ↓
 *   Update UI / Chat
 */

import { groqClient } from './groqClient';
import { editorContextService, EditorContext } from './editorContextService';
import { useIDEStore, ideEventBus, detectLanguage } from '../stores/ideStore';

// ========================================
// TYPES
// ========================================

export interface GeneratedPatch {
  filePath: string;
  content: string;
  isNewFile: boolean;
  explanation?: string;
}

export interface LocalCodingResult {
  success: boolean;
  patches: GeneratedPatch[];
  applied: string[];
  failed: string[];
  error?: string;
}

export interface LocalCodingOptions {
  projectId: string;
  workspaceId: string;
  instruction: string;
  context?: EditorContext;
  onProgress?: (stage: string, message: string) => void;
}

// ========================================
// SYSTEM PROMPT FOR PATCH GENERATION
// ========================================

const PATCH_GENERATION_PROMPT = `You are an AI coding assistant. Generate code files based on the user's request.

## CRITICAL INSTRUCTIONS
1. Respond ONLY with markdown code blocks
2. Each code block MUST start with a comment indicating the file path
3. Format: // FILE: path/to/file.ext
4. Then the code inside triple backticks

## REQUIRED FORMAT
For each file, write:

// FILE: src/example.ts
\`\`\`typescript
export function example() {
  return 'hello';
}
\`\`\`

## RULES
- You can create MULTIPLE files in one response
- Each file must have the // FILE: comment BEFORE the code block
- Write COMPLETE, WORKING code
- Include all necessary imports
- NEVER explain the code outside of code blocks
- NEVER ask users to copy/paste

Now generate the code files for the user's request:`;

// ========================================
// CODING INTENT DETECTION
// ========================================

const CODING_KEYWORDS = [
  'create', 'build', 'make', 'implement', 'generate',
  'add', 'fix', 'refactor', 'write', 'code',
  'app', 'application', 'function', 'component',
  'file', 'class', 'interface', 'module', 'api',
  'todo', 'list', 'server', 'client', 'page',
  'route', 'endpoint', 'database', 'model', 'test'
];

export function isCodingIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return CODING_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

// ========================================
// PATCH PARSING
// ========================================

/**
 * Parse AI response to extract file patches
 * Handles ANY format the AI might return:
 * - // FILE: path comments
 * - Standard markdown code blocks
 * - Plain code blocks without markers
 * - Mixed text and code
 */
export function parsePatchResponse(response: string): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];
  
  console.log('[LocalCodingService] Full AI response:', response);

  // Normalize CRLF (Windows) and bare CR (old Mac) to LF to prevent regex mismatches
  const normalized = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Strategy 1: Look for // FILE: comments followed by code blocks
  const fileCommentRegex = /(?:\/\/\s*FILE:\s*(.+?)\s*\n|\/\*\s*FILE:\s*(.+?)\s*\*\/\s*\n)?```(\w*)\n([\s\S]*?)\n```/g;
  
  let match;
  let fileIndex = 0;
  
  while ((match = fileCommentRegex.exec(normalized)) !== null) {
    const filePathFromComment = (match[1] || match[2] || '').trim();
    const language = match[3] || 'typescript';
    const content = match[4].trim();
    
    // Skip empty code blocks
    if (!content || content.length < 5) continue;
    
    // Determine file path
    let filePath = filePathFromComment;
    if (!filePath) {
      // Infer from content or use default
      if (content.includes('export class') || content.includes('export interface')) {
        filePath = `src/module${fileIndex}.ts`;
      } else if (content.includes('export function') || content.includes('export const')) {
        filePath = `src/index${fileIndex > 0 ? fileIndex : ''}.ts`;
      } else if (content.includes('import React') || content.includes('React.FC')) {
        filePath = `src/Component${fileIndex}.tsx`;
      } else if (language === 'html' || content.includes('<!DOCTYPE') || content.includes('<html')) {
        filePath = 'index.html';
      } else if (language === 'css' || content.includes('@media') || content.includes(':root')) {
        filePath = 'src/styles.css';
      } else if (language === 'json' || content.startsWith('{')) {
        filePath = 'package.json';
      } else {
        // Default extension based on language
        const ext = language === 'typescript' ? 'ts' : 
                    language === 'javascript' ? 'js' :
                    language === 'python' ? 'py' :
                    language === 'rust' ? 'rs' :
                    language === 'go' ? 'go' : language;
        filePath = `src/file${fileIndex > 0 ? fileIndex : ''}.${ext}`;
      }
    }
    
    console.log(`[LocalCodingService] Extracted: ${filePath} (${content.length} chars)`);
    
    patches.push({
      filePath,
      content,
      isNewFile: true
    });
    
    fileIndex++;
  }
  
  // Strategy 2: If no code blocks found, try to extract ANY code-like content
  if (patches.length === 0) {
    console.log('[LocalCodingService] No code blocks found, trying alternative extraction...');
    
    // Look for indented code sections
    const lines = normalized.split('\n');
    let codeBuffer: string[] = [];
    let inCode = false;
    
    for (const line of lines) {
      // Detect code patterns
      const isCodeLine = line.match(/^(\s{2,}|\t)/) || 
                         line.includes('function ') ||
                         line.includes('const ') ||
                         line.includes('let ') ||
                         line.includes('export ') ||
                         line.includes('import ') ||
                         line.includes('class ') ||
                         line.includes('interface ') ||
                         line.includes('return ');
      
      if (isCodeLine) {
        codeBuffer.push(line);
        inCode = true;
      } else if (inCode && line.trim() === '') {
        codeBuffer.push('');
      } else if (inCode && !isCodeLine && codeBuffer.length > 3) {
        // End of code section
        const content = codeBuffer.join('\n').trim();
        if (content.length > 20) {
          patches.push({
            filePath: 'src/generated.ts',
            content,
            isNewFile: true
          });
          console.log('[LocalCodingService] Extracted indented code section');
        }
        codeBuffer = [];
        inCode = false;
      }
    }
    
    // Handle remaining buffer
    if (codeBuffer.length > 3) {
      const content = codeBuffer.join('\n').trim();
      if (content.length > 20) {
        patches.push({
          filePath: 'src/generated.ts',
          content,
          isNewFile: true
        });
      }
    }
  }
  
  console.log(`[LocalCodingService] Total patches extracted: ${patches.length}`);
  return patches;
}

// ========================================
// PATCH APPLICATION
// ========================================

/**
 * Apply generated patches to the IDE store and file system.
 * Updates the IDE's file content cache, opens files in editor tabs,
 * and emits events so the file tree refreshes.
 */
export async function applyGeneratedPatches(
  projectId: string,
  patches: GeneratedPatch[]
): Promise<{ applied: string[]; failed: string[] }> {
  const applied: string[] = [];
  const failed: string[] = [];
  
  const store = useIDEStore.getState();

  // Also open files in tabsStore, which IdeShell uses to render the tab bar (Bug 11 fix)
  const { useTabsStore } = await import('../state/tabsStore');
  const tabsStore = useTabsStore.getState();

  for (const patch of patches) {
    try {
      // Update file content in the IDE store
      store.setFileContent(patch.filePath, patch.content);
      
      // Open the file as a tab in the editor (ideStore)
      store.openTab(patch.filePath, patch.content);

      // Also register in tabsStore so IdeShell's tab bar shows it (Bug 11 fix)
      tabsStore.openTab(projectId, patch.filePath);
      
      // Add file to the tree if it's a new file
      if (patch.isNewFile) {
        // Determine parent directory
        const segments = patch.filePath.split('/');
        const fileName = segments[segments.length - 1];
        const parentPath = segments.slice(0, -1).join('/') || '/';

        // Try to add to file tree
        try {
          store.addFileNode(parentPath, {
            id: `gen-${patch.filePath}-${Date.now()}`,
            name: fileName,
            type: 'file',
            path: patch.filePath,
          });
        } catch {
          // Parent may not exist in tree yet; the file:created event will trigger a refresh
        }

        // Emit file:created event so file tree components re-fetch
        ideEventBus.emit('file:created', { path: patch.filePath });
      } else {
        // For existing files, emit file:changed
        ideEventBus.emit('file:changed', { path: patch.filePath, content: patch.content });
      }

      // Attempt to persist via filesystem API (upsert — works for new AND existing files)
      try {
        const { fileSystemClient } = await import('../api/fileSystemClient');
        await fileSystemClient.applyAiPatches(projectId, [{ path: patch.filePath, content: patch.content }]);
      } catch {
        // Filesystem API not available (offline mode) — content is in store
        console.warn(`[LocalCodingService] Could not persist ${patch.filePath} to filesystem (offline mode)`);
      }

      applied.push(patch.filePath);
      console.log(`[LocalCodingService] Applied: ${patch.filePath}`);
      
    } catch (error) {
      console.error(`[LocalCodingService] Failed to apply patch to ${patch.filePath}:`, error);
      failed.push(patch.filePath);
    }
  }
  
  return { applied, failed };
}

// ========================================
// MAIN SERVICE
// ========================================

class LocalCodingService {
  /**
   * Generate and apply code patches from user instruction
   */
  async generateAndApply(options: LocalCodingOptions): Promise<LocalCodingResult> {
    const { projectId, workspaceId, instruction, context, onProgress } = options;
    
    try {
      // 1. Get editor context if not provided
      const editorContext = context ?? editorContextService.getContext();
      
      // 2. Build the prompt with context
      let fullPrompt = PATCH_GENERATION_PROMPT + '\n\n';
      
      // Add IDE context
      const ideContext = editorContextService.getIDEContextBlock();
      if (ideContext.systemContext) {
        fullPrompt += `## CURRENT WORKSPACE\n${ideContext.systemContext}\n\n`;
      }
      
      // Add current file content if available
      if (editorContext.code && editorContext.filePath) {
        fullPrompt += `## CURRENT FILE: ${editorContext.filePath}\n\`\`\`${editorContext.language ?? ''}\n${editorContext.code}\n\`\`\`\n\n`;
      }
      
      fullPrompt += `## USER REQUEST\n${instruction}\n\n## GENERATE PATCHES NOW:`;
      
      onProgress?.('generating', 'AI is generating code...');
      
      // 3. Call Groq to generate patches
      const response = await groqClient.complete(
        fullPrompt,
        'You are a precise coding assistant. Generate only the requested code in the specified PATCH FORMAT.'
      );
      
      onProgress?.('parsing', 'Parsing generated code...');
      
      // 4. Parse the response
      const patches = parsePatchResponse(response);
      
      if (patches.length === 0) {
        return {
          success: false,
          patches: [],
          applied: [],
          failed: [],
          error: 'No code patches were generated. The AI response did not contain valid patch blocks.'
        };
      }
      
      onProgress?.('applying', `Applying ${patches.length} file changes...`);
      
      // 5. Apply the patches
      const result = await applyGeneratedPatches(projectId, patches);
      
      onProgress?.('complete', `Applied ${result.applied.length} files`);
      
      return {
        success: result.failed.length === 0,
        patches,
        applied: result.applied,
        failed: result.failed,
        error: result.failed.length > 0 ? `Failed to apply: ${result.failed.join(', ')}` : undefined
      };
      
    } catch (error) {
      console.error('[LocalCodingService] Error:', error);
      return {
        success: false,
        patches: [],
        applied: [],
        failed: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Check if a message should trigger coding
   */
  isCodingRequest(message: string): boolean {
    return isCodingIntent(message);
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const localCodingService = new LocalCodingService();

export default localCodingService;
