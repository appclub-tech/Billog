/**
 * Group Workflow
 *
 * Handles shared expense tracking in Group context.
 * Includes split handling (@all, @mentions).
 *
 * Flow:
 * 1. Sync group members (for @all resolution)
 * 2. Branch: Text or Image?
 * 3. Parse/OCR expense data with split info
 * 4. Validate (HITL if missing fields or split info)
 * 5. Create expense with splits
 * 6. Format response with split breakdown
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { syncMembersStep } from './steps/group/sync-members.step.js';
import { groupParseTextStep } from './steps/group/parse-text.step.js';
import { groupProcessReceiptStep } from './steps/group/process-receipt.step.js';
import { groupValidateStep } from './steps/group/validate.step.js';
import { createExpenseStep } from './steps/shared/create-expense.step.js';
import { formatResponseStep } from './steps/shared/format-response.step.js';
import {
  MessageInputSchema,
  MessageOutputSchema,
  MessageWorkflowStateSchema,
  type MessageInput,
  type ParsedExpense,
} from './schemas.js';

// Input for Group sub-workflow (after source init)
const GroupWorkflowInputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean(),
});

// ============================================
// Group Text Expense Workflow
// ============================================

const groupTextExpenseWorkflow = createWorkflow({
  id: 'group-text-expense',
  inputSchema: z.any(),
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // Parse text with members for @mention validation
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      messageText: initData.messageText || '',
      userCurrency: initData.userCurrency,
      userLanguage: initData.userLanguage,
      members: inputData.members || [],
    };
  })
  .then(groupParseTextStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      parsedExpense: inputData.parsedExpense,
      isValid: inputData.isValid,
      missingFields: inputData.missingFields,
      needsSplitInfo: inputData.needsSplitInfo,
      userLanguage: initData.userLanguage,
      userCurrency: initData.userCurrency,
    };
  })
  .then(groupValidateStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      parsedExpense: inputData.parsedExpense,
      channel: initData.channel,
      senderChannelId: initData.senderChannelId,
      sourceChannelId: initData.sourceChannelId,
      isGroup: true,
    };
  })
  .then(createExpenseStep)
  .map(async ({ inputData, getStepResult, getInitData }) => {
    const initData = getInitData<MessageInput>();
    const validateResult = getStepResult('group-validate') as { parsedExpense: ParsedExpense };
    return {
      success: inputData.success,
      expenseId: inputData.expenseId,
      parsedExpense: validateResult.parsedExpense,
      splits: inputData.splits,
      error: inputData.error,
      userLanguage: initData.userLanguage,
    };
  })
  .then(formatResponseStep)
  .commit();

// ============================================
// Group Receipt Expense Workflow
// ============================================

const groupReceiptExpenseWorkflow = createWorkflow({
  id: 'group-receipt-expense',
  inputSchema: z.any(),
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // OCR with optional split info from text
  .map(async ({ getInitData }) => {
    const initData = getInitData<MessageInput>();
    // Check if message text contains split info (e.g., "@all" in caption)
    const splitTargets: string[] = [];
    const text = initData.messageText || '';
    const splitMatches = text.match(/@(\w+)/g);
    if (splitMatches) {
      for (const m of splitMatches) {
        splitTargets.push(m.slice(1));
      }
    }
    // Thai split keywords
    if (/หารกัน|แบ่งกัน|ทุกคน/i.test(text) && !splitTargets.includes('all')) {
      splitTargets.push('all');
    }

    return {
      imageUrl: initData.imageUrl,
      imageBase64: initData.imageBase64,
      userCurrency: initData.userCurrency,
      splitType: splitTargets.length > 0 ? ('equal' as const) : null,
      splitTargets,
    };
  })
  .then(groupProcessReceiptStep)
  .branch([
    // Not a receipt - return error
    [
      async ({ inputData }) => !inputData.isReceipt,
      createStep({
        id: 'group-not-a-receipt',
        inputSchema: z.any(),
        outputSchema: MessageOutputSchema,
        execute: async ({ getInitData }) => {
          const initData = getInitData<MessageInput>();
          const lang = initData.userLanguage;
          return {
            success: false,
            status: 'failed' as const,
            message: lang === 'th'
              ? 'ไม่พบใบเสร็จในรูป กรุณาส่งรูปใบเสร็จที่ชัดเจน'
              : 'This does not appear to be a receipt. Please send a clear photo of a receipt.',
          };
        },
      }),
    ],
    // Is a receipt - continue with validation
    [
      async ({ inputData }) => inputData.isReceipt,
      createWorkflow({
        id: 'group-receipt-valid-path',
        inputSchema: z.any(),
        outputSchema: MessageOutputSchema,
        stateSchema: MessageWorkflowStateSchema,
      })
        .map(async ({ inputData, getInitData }) => {
          const initData = getInitData<MessageInput>();
          return {
            parsedExpense: inputData.parsedExpense,
            isValid: inputData.isValid,
            missingFields: inputData.missingFields,
            needsSplitInfo: inputData.needsSplitInfo,
            userLanguage: initData.userLanguage,
            userCurrency: initData.userCurrency,
          };
        })
        .then(groupValidateStep)
        .map(async ({ inputData, getInitData }) => {
          const initData = getInitData<MessageInput>();
          return {
            parsedExpense: inputData.parsedExpense,
            channel: initData.channel,
            senderChannelId: initData.senderChannelId,
            sourceChannelId: initData.sourceChannelId,
            isGroup: true,
            imageUrl: initData.imageUrl,
          };
        })
        .then(createExpenseStep)
        .map(async ({ inputData, getStepResult, getInitData }) => {
          const initData = getInitData<MessageInput>();
          const validateResult = getStepResult('group-validate') as { parsedExpense: ParsedExpense };
          return {
            success: inputData.success,
            expenseId: inputData.expenseId,
            parsedExpense: validateResult.parsedExpense,
            splits: inputData.splits,
            error: inputData.error,
            userLanguage: initData.userLanguage,
          };
        })
        .then(formatResponseStep)
        .commit(),
    ],
  ])
  .commit();

// ============================================
// Main Group Workflow
// ============================================

export const groupWorkflow = createWorkflow({
  id: 'group-workflow',
  inputSchema: GroupWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // Step 1: Sync group members for @all resolution
  .map(async ({ getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      channel: initData.channel,
      sourceChannelId: initData.sourceChannelId,
      senderChannelId: initData.senderChannelId,
    };
  })
  .then(syncMembersStep)
  // Step 2: Branch based on content type
  .branch([
    // Text expense path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return !initData.imageUrl && !initData.imageBase64 && !!initData.messageText;
      },
      groupTextExpenseWorkflow,
    ],
    // Receipt expense path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return !!(initData.imageUrl || initData.imageBase64);
      },
      groupReceiptExpenseWorkflow,
    ],
    // No content - fallback
    [
      async () => true,
      createStep({
        id: 'group-no-content',
        inputSchema: z.any(),
        outputSchema: MessageOutputSchema,
        execute: async ({ getInitData }) => {
          const initData = getInitData<MessageInput>();
          const lang = initData.userLanguage;
          return {
            success: false,
            status: 'fallback' as const,
            message: lang === 'th'
              ? 'ไม่เข้าใจข้อความ ลองพิมพ์ "กาแฟ 65 @all" หรือส่งรูปใบเสร็จ'
              : 'I don\'t understand. Try "coffee 65 @all" or send a receipt photo.',
            fallbackReason: 'no_content',
          };
        },
      }),
    ],
  ])
  .commit();
