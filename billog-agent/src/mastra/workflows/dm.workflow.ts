/**
 * DM Workflow
 *
 * Handles personal expense tracking in DM (Direct Message) context.
 * No split handling - all expenses are personal.
 *
 * Flow:
 * 1. Branch: Text or Image?
 * 2. Parse/OCR expense data
 * 3. Validate (HITL if missing fields)
 * 4. Create expense
 * 5. Format response
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { dmParseTextStep } from './steps/dm/parse-text.step.js';
import { dmProcessReceiptStep } from './steps/dm/process-receipt.step.js';
import { dmValidateStep } from './steps/dm/validate.step.js';
import { createExpenseStep } from './steps/shared/create-expense.step.js';
import { formatResponseStep } from './steps/shared/format-response.step.js';
import {
  MessageInputSchema,
  MessageOutputSchema,
  MessageWorkflowStateSchema,
  type MessageInput,
  type ParsedExpense,
} from './schemas.js';

// Input for DM sub-workflow (after source init)
const DmWorkflowInputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean(),
});

// ============================================
// DM Text Expense Workflow
// ============================================

const dmTextExpenseWorkflow = createWorkflow({
  id: 'dm-text-expense',
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // Parse text → Validate → Create → Format
  .map(async ({ getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      messageText: initData.messageText || '',
      userCurrency: initData.userCurrency,
      userLanguage: initData.userLanguage,
    };
  })
  .then(dmParseTextStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      parsedExpense: inputData.parsedExpense,
      isValid: inputData.isValid,
      missingFields: inputData.missingFields,
      userLanguage: initData.userLanguage,
      userCurrency: initData.userCurrency,
    };
  })
  .then(dmValidateStep)
  .map(async ({ inputData, getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      parsedExpense: inputData.parsedExpense,
      channel: initData.channel,
      senderChannelId: initData.senderChannelId,
      sourceChannelId: initData.sourceChannelId,
      isGroup: false,
    };
  })
  .then(createExpenseStep)
  .map(async ({ inputData, getStepResult, getInitData }) => {
    const initData = getInitData<MessageInput>();
    const validateResult = getStepResult('dm-validate') as { parsedExpense: ParsedExpense };
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
// DM Receipt Expense Workflow
// ============================================

const dmReceiptExpenseWorkflow = createWorkflow({
  id: 'dm-receipt-expense',
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  // OCR → Validate → Create → Format
  .map(async ({ getInitData }) => {
    const initData = getInitData<MessageInput>();
    return {
      imageUrl: initData.imageUrl,
      imageBase64: initData.imageBase64,
      userCurrency: initData.userCurrency,
    };
  })
  .then(dmProcessReceiptStep)
  .branch([
    // Not a receipt - return error
    [
      async ({ inputData }) => !inputData.isReceipt,
      createStep({
        id: 'not-a-receipt',
        inputSchema: z.any(),
        outputSchema: MessageOutputSchema,
        execute: async ({ inputData, getInitData }) => {
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
        id: 'dm-receipt-valid-path',
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
            userLanguage: initData.userLanguage,
            userCurrency: initData.userCurrency,
          };
        })
        .then(dmValidateStep)
        .map(async ({ inputData, getInitData }) => {
          const initData = getInitData<MessageInput>();
          return {
            parsedExpense: inputData.parsedExpense,
            channel: initData.channel,
            senderChannelId: initData.senderChannelId,
            sourceChannelId: initData.sourceChannelId,
            isGroup: false,
            imageUrl: initData.imageUrl,
          };
        })
        .then(createExpenseStep)
        .map(async ({ inputData, getStepResult, getInitData }) => {
          const initData = getInitData<MessageInput>();
          const validateResult = getStepResult('dm-validate') as { parsedExpense: ParsedExpense };
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
// Main DM Workflow (branches text/image)
// ============================================

export const dmWorkflow = createWorkflow({
  id: 'dm-workflow',
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
})
  .branch([
    // Text expense path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return !initData.imageUrl && !initData.imageBase64 && !!initData.messageText;
      },
      dmTextExpenseWorkflow,
    ],
    // Receipt expense path
    [
      async ({ getInitData }) => {
        const initData = getInitData<MessageInput>();
        return !!(initData.imageUrl || initData.imageBase64);
      },
      dmReceiptExpenseWorkflow,
    ],
    // No content - fallback
    [
      async () => true, // Default case
      createStep({
        id: 'dm-no-content',
        inputSchema: z.any(),
        outputSchema: MessageOutputSchema,
        execute: async ({ getInitData }) => {
          const initData = getInitData<MessageInput>();
          const lang = initData.userLanguage;
          return {
            success: false,
            status: 'fallback' as const,
            message: lang === 'th'
              ? 'ไม่เข้าใจข้อความ ลองพิมพ์ "กาแฟ 65" หรือส่งรูปใบเสร็จ'
              : 'I don\'t understand. Try "coffee 65" or send a receipt photo.',
            fallbackReason: 'no_content',
          };
        },
      }),
    ],
  ])
  .commit();
