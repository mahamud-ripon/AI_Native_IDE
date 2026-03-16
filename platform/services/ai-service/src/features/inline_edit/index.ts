/**
 * Inline Edit Feature Module
 * 
 * Inline code editing on selected code ranges.
 */

// Service
export {
  InlineEditService,
  getInlineEditService,
  createInlineEditService,
  performInlineEdit,
  previewInlineEdit,
} from './inline_edit_service.js';

// Types
export {
  InlineEditOperation,
  InlineEditStatus,
  CodeSelection,
  InlineEditRequest,
  InlineEditOptions,
  InlineEditResult,
  CodeDiff,
  DiffLine,
  InlineEditMetrics,
  EditPreview,
  EditHistoryEntry,
  InlineEditConfig,
  INLINE_EDIT_DEFAULTS,
  OPERATION_PROMPTS,
} from './inline_edit_types.js';
