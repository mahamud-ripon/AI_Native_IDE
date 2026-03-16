/**
 * Diff Parser
 * 
 * Parses unified diff format (git-style) into structured representation.
 */

import {
  ParsedPatch,
  FilePatch,
  Hunk,
  PatchLine,
  PatchLineType,
  FileOperationType,
  PatchLimits,
  DEFAULT_PATCH_LIMITS,
  PatchParseError,
  PatchSafetyError,
} from './diff_types.js';

// Regex patterns for diff parsing
const PATTERNS = {
  // --- a/path or --- /dev/null
  oldFile: /^---\s+(?:a\/)?(.+)$/,
  // +++ b/path or +++ /dev/null
  newFileHeader: /^\+\+\+\s+(?:b\/)?(.+)$/,
  // @@ -start,count +start,count @@ header
  hunkHeader: /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/,
  // Context line (starts with space)
  context: /^ (.*)$/,
  // Added line (starts with +)
  add: /^\+(.*)$/,
  // Removed line (starts with -)
  remove: /^-(.*)$/,
  // No newline marker
  noNewline: /^\\ No newline at end of file$/,
  // Binary file marker
  binary: /^Binary files/,
  // Rename marker (git extended header)
  rename: /^rename from (.+)$/,
  renameTo: /^rename to (.+)$/,
  // Delete marker (git extended header)
  deleteFile: /^deleted file mode/,
  // New file marker (git extended header)
  newFileMode: /^new file mode/,
  // Index line
  index: /^index [a-f0-9]+/,
} as const;

/**
 * Parse unified diff content into structured format
 */
export function parsePatch(
  patchContent: string,
  limits: PatchLimits = DEFAULT_PATCH_LIMITS
): ParsedPatch {
  const lines = patchContent.split('\n');
  const files: FilePatch[] = [];
  
  let currentFile: FilePatch | null = null;
  let currentHunk: Hunk | null = null;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  let totalHunks = 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines at start
    if (!line && !currentFile) continue;

    // Check line length limit
    if (line.length > limits.maxLineLength) {
      throw new PatchSafetyError(
        `Line ${i + 1} exceeds maximum length (${line.length} > ${limits.maxLineLength})`,
        'maxLineLength',
        line.length,
        limits.maxLineLength
      );
    }

    // Check for file header (---)
    const oldFileMatch = line.match(PATTERNS.oldFile);
    if (oldFileMatch) {
      // Save previous file if exists
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
          currentHunk = null;
        }
        files.push(currentFile);
      }

      currentFile = {
        oldPath: oldFileMatch[1] === '/dev/null' ? null : oldFileMatch[1],
        newPath: null,
        operation: 'modify',
        hunks: [],
      };
      continue;
    }

    // Check for file header (+++)
    const newFileMatch = line.match(PATTERNS.newFileHeader);
    if (newFileMatch && currentFile) {
      currentFile.newPath = newFileMatch[1] === '/dev/null' ? null : newFileMatch[1];
      
      // Determine operation type
      if (currentFile.oldPath === null) {
        currentFile.operation = 'create';
      } else if (currentFile.newPath === null) {
        currentFile.operation = 'delete';
      }
      continue;
    }

    // Check for git extended headers
    if (currentFile && !currentHunk) {
      const renameMatch = line.match(PATTERNS.rename);
      if (renameMatch) {
        currentFile.oldPath = renameMatch[1];
        currentFile.operation = 'rename';
        continue;
      }

      const renameToMatch = line.match(PATTERNS.renameTo);
      if (renameToMatch) {
        currentFile.newPath = renameToMatch[1];
        continue;
      }

      if (PATTERNS.newFileMode.test(line)) {
        currentFile.operation = 'create';
        continue;
      }

      if (PATTERNS.deleteFile.test(line)) {
        currentFile.operation = 'delete';
        continue;
      }

      if (PATTERNS.binary.test(line)) {
        currentFile.binary = true;
        continue;
      }

      // Skip index lines
      if (PATTERNS.index.test(line)) {
        continue;
      }
    }

    // Check for hunk header
    const hunkMatch = line.match(PATTERNS.hunkHeader);
    if (hunkMatch && currentFile) {
      // Save previous hunk
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

      currentHunk = {
        oldStart,
        oldLines: oldCount,
        newStart,
        newLines: newCount,
        header: hunkMatch[5].trim(),
        lines: [],
      };

      oldLineNumber = oldStart;
      newLineNumber = newStart;
      totalHunks++;

      // Check hunks per file limit
      if (currentFile.hunks.length + 1 > limits.maxHunksPerFile) {
        throw new PatchSafetyError(
          `Too many hunks in file ${currentFile.newPath || currentFile.oldPath}`,
          'maxHunksPerFile',
          currentFile.hunks.length + 1,
          limits.maxHunksPerFile
        );
      }

      continue;
    }

    // Parse hunk lines
    if (currentHunk) {
      const patchLine = parseHunkLine(line, oldLineNumber, newLineNumber);
      
      if (patchLine) {
        currentHunk.lines.push(patchLine);
        
        if (patchLine.type === 'add') {
          newLineNumber++;
          totalLinesAdded++;
        } else if (patchLine.type === 'remove') {
          oldLineNumber++;
          totalLinesRemoved++;
        } else if (patchLine.type === 'context') {
          oldLineNumber++;
          newLineNumber++;
        }
      }
    }
  }

  // Save last file
  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    files.push(currentFile);
  }

  // Check limits
  if (files.length > limits.maxFilesPerPatch) {
    throw new PatchSafetyError(
      `Too many files in patch (${files.length} > ${limits.maxFilesPerPatch})`,
      'maxFilesPerPatch',
      files.length,
      limits.maxFilesPerPatch
    );
  }

  if (totalLinesAdded + totalLinesRemoved > limits.maxLinesPerPatch) {
    throw new PatchSafetyError(
      `Too many lines in patch (${totalLinesAdded + totalLinesRemoved} > ${limits.maxLinesPerPatch})`,
      'maxLinesPerPatch',
      totalLinesAdded + totalLinesRemoved,
      limits.maxLinesPerPatch
    );
  }

  return {
    files,
    totalLinesAdded,
    totalLinesRemoved,
    totalHunks,
  };
}

/**
 * Parse a single line within a hunk
 */
function parseHunkLine(
  line: string,
  oldLineNumber: number,
  newLineNumber: number
): PatchLine | null {
  // Skip no-newline markers
  if (PATTERNS.noNewline.test(line)) {
    return null;
  }

  // Context line
  const contextMatch = line.match(PATTERNS.context);
  if (contextMatch) {
    return {
      type: 'context',
      content: contextMatch[1],
      oldLineNumber,
      newLineNumber,
    };
  }

  // Added line
  const addMatch = line.match(PATTERNS.add);
  if (addMatch) {
    return {
      type: 'add',
      content: addMatch[1],
      newLineNumber,
    };
  }

  // Removed line
  const removeMatch = line.match(PATTERNS.remove);
  if (removeMatch) {
    return {
      type: 'remove',
      content: removeMatch[1],
      oldLineNumber,
    };
  }

  // Unknown line format - treat as context if it doesn't start with special char
  if (line && !line.startsWith('@') && !line.startsWith('diff')) {
    return {
      type: 'context',
      content: line,
      oldLineNumber,
      newLineNumber,
    };
  }

  return null;
}

/**
 * Extract file paths from a patch
 */
export function extractFilePaths(patchContent: string): string[] {
  const paths = new Set<string>();
  const lines = patchContent.split('\n');

  for (const line of lines) {
    const oldMatch = line.match(PATTERNS.oldFile);
    if (oldMatch && oldMatch[1] !== '/dev/null') {
      paths.add(oldMatch[1]);
    }

    const newMatch = line.match(PATTERNS.newFileHeader);
    if (newMatch && newMatch[1] !== '/dev/null') {
      paths.add(newMatch[1]);
    }
  }

  return Array.from(paths);
}

/**
 * Check if patch creates new files
 */
export function hasNewFiles(patch: ParsedPatch): boolean {
  return patch.files.some(f => f.operation === 'create');
}

/**
 * Check if patch deletes files
 */
export function hasDeletedFiles(patch: ParsedPatch): boolean {
  return patch.files.some(f => f.operation === 'delete');
}

/**
 * Check if patch renames files
 */
export function hasRenamedFiles(patch: ParsedPatch): boolean {
  return patch.files.some(f => f.operation === 'rename');
}

/**
 * Get summary of patch
 */
export function getPatchSummary(patch: ParsedPatch): string {
  const parts: string[] = [];

  parts.push(`${patch.files.length} file${patch.files.length !== 1 ? 's' : ''} changed`);
  
  if (patch.totalLinesAdded > 0) {
    parts.push(`${patch.totalLinesAdded} insertion${patch.totalLinesAdded !== 1 ? 's' : ''}(+)`);
  }
  
  if (patch.totalLinesRemoved > 0) {
    parts.push(`${patch.totalLinesRemoved} deletion${patch.totalLinesRemoved !== 1 ? 's' : ''}(-)`);
  }

  return parts.join(', ');
}
