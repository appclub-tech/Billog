/**
 * Billog Agent Tools
 * Export all tools for the Billog AI Bookkeeper
 */

// Expense tools
export {
  createExpenseTool,
  getExpensesTool,
  getExpenseByIdTool,
  deleteExpenseTool,
} from './expense.tool.js';

// Balance tools
export {
  getBalancesTool,
  getSpendingSummaryTool,
  getMyBalanceTool,
} from './balance.tool.js';

// Settlement tools
export { recordSettlementTool } from './settle.tool.js';

// Reconciliation tools
export { reconcileExpenseTool } from './reconcile.tool.js';

// Source/initialization tools
export {
  initSourceTool,
  syncMembersTool,
  setNicknameTool,
} from './source.tool.js';

// Category tools
export {
  listCategoriesTool,
  getCategoryByNameTool,
} from './category.tool.js';

// OCR tools (legacy - prefer processReceiptTool)
export {
  extractReceiptTool,
  extractRawTextTool,
} from './ocr.tool.js';

// Receipt processing (combined OCR + create expense)
export { processReceiptTool } from './receipt.tool.js';

// Text expense processing (parse + validate + create)
export { processTextExpenseTool } from './text-expense.tool.js';

// ==================================================
// Pure tools for workflow-based processing
// ==================================================

// Pure OCR extraction (for workflow use)
export {
  ocrReceiptTool,
  OcrResultSchema,
  type OcrResult,
} from './ocr-receipt.tool.js';

// Pure text parsing (for workflow use)
export {
  parseTextTool,
  parseExpenseText,
  validateParsedExpense,
  generateMissingFieldsPrompt,
  ParseResultSchema,
  type ParseResult,
  type ParsedExpense,
} from './parse-text.tool.js';

// User tools
export {
  getUserPreferencesTool,
  setUserLanguageTool,
} from './user.tool.js';

// Re-export utilities
export { CATEGORIES, detectCategory, formatAmount } from './api-client.js';

// Re-export response builder
export { TEMPLATES, ResponseBuilder, responses } from './responses.js';
