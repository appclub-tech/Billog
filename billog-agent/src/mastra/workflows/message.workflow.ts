/**
 * Message Workflow
 *
 * Main entry point for processing messages.
 * Handles both DM and Group contexts.
 *
 * Flow:
 * 1. Ensure source is initialized (always first)
 * 2. Branch: DM or Group?
 * 3. Route to appropriate sub-workflow
 */

import { createWorkflow } from '@mastra/core/workflows';
import { ensureSourceInitStep } from './steps/ensure-source-init.step.js';
import { dmWorkflow } from './dm.workflow.js';
import { groupWorkflow } from './group.workflow.js';
import {
  MessageInputSchema,
  MessageOutputSchema,
  MessageWorkflowStateSchema,
  type MessageInput,
} from './schemas.js';

// ============================================
// Main Message Workflow
// ============================================

export const messageWorkflow = createWorkflow({
  id: 'message-workflow',
  inputSchema: MessageInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // Step 0: Always ensure source is initialized first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .then(ensureSourceInitStep as any)
  // Branch: DM or Group?
  .branch([
    // DM path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return !initData.isGroup;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dmWorkflow as any,
    ],
    // Group path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return initData.isGroup;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      groupWorkflow as any,
    ],
  ])
  .commit();

// ============================================
// Helper: Detect if message should use workflow
// ============================================

/**
 * Determine if a message should be handled by the workflow.
 * Returns false for queries, settlements, help, etc. (fallback to agent)
 */
export function shouldUseWorkflow(message: {
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
}): boolean {
  // Always use workflow for images (receipts)
  if (message.imageUrl || message.imageBase64) {
    return true;
  }

  const text = message.text?.toLowerCase() || '';

  // Fallback to agent for these patterns:
  // - Queries: "ใครเป็นหนี้", "who owes", "summary", "balance"
  // - Settlements: "จ่ายแล้ว", "paid", "settle"
  // - Help: "help", "ช่วย", "วิธีใช้"
  // - Status: "status", "สถานะ"

  const agentPatterns = [
    // Balance queries
    /ใครเป็นหนี้|who\s+owes|balance|ยอด|เท่าไหร่/i,
    // Summary queries
    /summary|สรุป|รายงาน|report/i,
    // Settlement
    /จ่ายแล้ว|paid|settle|โอน|transfer/i,
    // Help
    /^help$|^ช่วย|วิธีใช้|how\s+to/i,
    // Status
    /status|สถานะ/i,
    // List/history
    /list|รายการ|history|ประวัติ/i,
    // Delete/cancel
    /delete|ลบ|cancel|ยกเลิก/i,
    // Reconcile/adjust
    /adjust|แก้|reconcile|ปรับ/i,
  ];

  for (const pattern of agentPatterns) {
    if (pattern.test(text)) {
      return false; // Fallback to agent
    }
  }

  // Use workflow for expense-like messages
  return true;
}
