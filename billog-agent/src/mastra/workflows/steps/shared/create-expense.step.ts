/**
 * Create Expense Step (Shared)
 *
 * Creates an expense record via the API.
 * Works for both DM (personal) and Group (shared) expenses.
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { apiRequest, type ApiContext } from '../../../tools/api-client.js';
import { saveExpenseItemEmbeddings, isVectorStoreConfigured } from '../../../vector/index.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
  ChannelSchema,
} from '../../schemas.js';

const CreateExpenseInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema,
  channel: ChannelSchema,
  senderChannelId: z.string(),
  sourceChannelId: z.string(),
  isGroup: z.boolean(),
  imageUrl: z.string().optional(), // For receipt data
});

const CreateExpenseOutputSchema = z.object({
  success: z.boolean(),
  expenseId: z.string().optional(),
  splits: z.array(z.object({
    userId: z.string(),
    name: z.string().nullable(),
    amount: z.number(),
  })).optional(),
  error: z.string().optional(),
});

export const createExpenseStep = createStep({
  id: 'create-expense',
  description: 'Create expense record via API',
  inputSchema: CreateExpenseInputSchema,
  outputSchema: CreateExpenseOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    const { parsedExpense, channel, senderChannelId, sourceChannelId, isGroup } = inputData;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] create-expense`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Description: ${parsedExpense.description}`);
    console.log(`  Amount:      ${parsedExpense.amount} ${parsedExpense.currency}`);
    console.log(`  IsGroup:     ${isGroup}`);
    if (parsedExpense.splitTargets.length > 0) {
      console.log(`  Splits:      ${parsedExpense.splitTargets.join(', ')}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    const context: ApiContext = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? 'GROUP' : 'DM',
    };

    try {
      // Build API request body
      const requestBody: Record<string, unknown> = {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? 'GROUP' : 'DM',
        description: parsedExpense.description,
        amount: parsedExpense.amount,
        currency: parsedExpense.currency,
        date: parsedExpense.date,
      };

      // Add split info if group expense
      if (isGroup && parsedExpense.splitType && parsedExpense.splitTargets.length > 0) {
        requestBody.splitType = parsedExpense.splitType;
        requestBody.splits = parsedExpense.splitTargets.map(target => ({ target }));
      }

      // Add items if from receipt
      if (parsedExpense.items && parsedExpense.items.length > 0) {
        requestBody.items = parsedExpense.items.map(item => ({
          name: item.name,
          nameLocalized: item.nameLocalized,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          ingredientType: item.ingredientType,
        }));
      }

      // Add receipt data if available
      if (inputData.imageUrl && parsedExpense.metadata) {
        requestBody.receiptData = {
          imageUrl: inputData.imageUrl,
          storeName: parsedExpense.description,
          subtotal: parsedExpense.metadata.subtotal,
          tax: parsedExpense.metadata.tax,
          total: parsedExpense.amount,
        };
      }

      // Add metadata if available
      if (parsedExpense.metadata) {
        requestBody.metadata = parsedExpense.metadata;
      }

      // Call API
      const response = await apiRequest<{
        expense: { id: string; description: string; amount: number; currency: string; date: string };
        splits: Array<{ userId: string; name: string | null; amount: number }>;
      }>('POST', '/expenses', context, requestBody);

      // Verify expense was created
      if (!response.expense?.id) {
        console.error(`[create-expense] ❌ No expenseId in response`);

        setState({
          ...state,
          expenseId: null,
          error: 'Expense was not saved',
        });

        return {
          success: false,
          error: 'Expense was not saved. Please try again.',
        };
      }

      console.log(`[create-expense] ✅ SUCCESS: EX:${response.expense.id}`);

      // Save embeddings for Insights Agent (non-blocking)
      if (isVectorStoreConfigured()) {
        const embeddingDate = response.expense.date || new Date().toISOString();
        const items = parsedExpense.items && parsedExpense.items.length > 0
          ? parsedExpense.items.map(item => ({
              name: item.name,
              nameLocalized: item.nameLocalized || undefined,
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice,
              totalPrice: (item.quantity || 1) * item.unitPrice,
            }))
          : [{
              // Use response data which is guaranteed to exist
              name: response.expense.description,
              quantity: 1,
              unitPrice: response.expense.amount,
              totalPrice: response.expense.amount,
            }];

        saveExpenseItemEmbeddings(
          response.expense.id,
          items,
          sourceChannelId,
          embeddingDate,
          senderChannelId // Who paid
        ).catch((err) => console.error('[Vector] Embedding save error:', err));
      }

      setState({
        ...state,
        expenseId: response.expense.id,
      });

      return {
        success: true,
        expenseId: response.expense.id,
        splits: response.splits,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[create-expense] ❌ Error: ${errorMsg}`);

      setState({
        ...state,
        expenseId: null,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});
