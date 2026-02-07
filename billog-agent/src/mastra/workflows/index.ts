/**
 * Billog Workflows
 *
 * Export all workflows for registration with Mastra.
 */

// Main message workflow
export { messageWorkflow, shouldUseWorkflow } from './message.workflow.js';

// DM workflow
export { dmWorkflow } from './dm.workflow.js';

// Group workflow
export { groupWorkflow } from './group.workflow.js';

// Schemas
export * from './schemas.js';

// Steps (for resume operations)
export { ensureSourceInitStep } from './steps/ensure-source-init.step.js';

// DM steps
export { dmParseTextStep } from './steps/dm/parse-text.step.js';
export { dmProcessReceiptStep } from './steps/dm/process-receipt.step.js';
export { dmValidateStep } from './steps/dm/validate.step.js';

// Group steps
export { syncMembersStep } from './steps/group/sync-members.step.js';
export { groupParseTextStep } from './steps/group/parse-text.step.js';
export { groupProcessReceiptStep } from './steps/group/process-receipt.step.js';
export { groupValidateStep } from './steps/group/validate.step.js';

// Shared steps
export { createExpenseStep } from './steps/shared/create-expense.step.js';
export { formatResponseStep } from './steps/shared/format-response.step.js';
