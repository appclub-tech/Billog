/**
 * Format Response Step (Shared)
 *
 * Formats the final response message based on the expense data.
 * Works for both DM and Group expenses.
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { formatAmount } from '../../../tools/api-client.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
  MessageOutputSchema,
} from '../../schemas.js';

const FormatResponseInputSchema = z.object({
  success: z.boolean(),
  expenseId: z.string().optional(),
  parsedExpense: ParsedExpenseSchema,
  splits: z.array(z.object({
    userId: z.string(),
    name: z.string().nullable(),
    amount: z.number(),
  })).optional(),
  error: z.string().optional(),
  userLanguage: z.enum(['th', 'en']).default('th'),
});

export const formatResponseStep = createStep({
  id: 'format-response',
  description: 'Format the final response message',
  inputSchema: FormatResponseInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] format-response`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Success: ${inputData.success}`);
    console.log(`  ExpenseId: ${inputData.expenseId || 'none'}`);
    console.log(`${'='.repeat(60)}\n`);

    const { parsedExpense, splits, userLanguage } = inputData;

    if (!inputData.success || !inputData.expenseId) {
      const errorMessage = userLanguage === 'th'
        ? `เกิดข้อผิดพลาด: ${inputData.error || 'ไม่สามารถบันทึกได้'}`
        : `Error: ${inputData.error || 'Could not save expense'}`;

      setState({
        ...state,
        responseMessage: errorMessage,
      });

      return {
        success: false,
        status: 'failed' as const,
        message: errorMessage,
      };
    }

    // Build success message
    const formattedAmount = formatAmount(parsedExpense.amount!, parsedExpense.currency);
    let message = `${parsedExpense.description} | ${formattedAmount}`;

    // Add category
    if (parsedExpense.category) {
      message += `\nCategory: ${parsedExpense.category}`;
    }

    // Show date if not today
    if (parsedExpense.date) {
      const dateObj = new Date(parsedExpense.date);
      const today = new Date();
      const isToday = dateObj.toDateString() === today.toDateString();
      if (!isToday) {
        const formattedDate = dateObj.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        message += `\nDate: ${formattedDate}`;
      }
    }

    // Show items if from receipt
    if (parsedExpense.items && parsedExpense.items.length > 0) {
      message += `\n───────────`;
      for (const item of parsedExpense.items) {
        const qty = item.quantity || 1;
        const unitPrice = item.unitPrice || 0;
        const lineTotal = qty * unitPrice;
        message += `\n- ${item.name} x${qty} @ ${formatAmount(unitPrice, parsedExpense.currency)} = ${formatAmount(lineTotal, parsedExpense.currency)}`;
      }
      message += `\n───────────`;
    }

    // Show payment info
    if (parsedExpense.payment?.method) {
      let paymentStr = `Paid: ${parsedExpense.payment.method}`;
      if (parsedExpense.payment.cardType && parsedExpense.payment.cardLast4) {
        paymentStr += ` (${parsedExpense.payment.cardType} **${parsedExpense.payment.cardLast4})`;
      } else if (parsedExpense.payment.cardLast4) {
        paymentStr += ` (**${parsedExpense.payment.cardLast4})`;
      }
      if (parsedExpense.payment.bankName) {
        paymentStr += ` - ${parsedExpense.payment.bankName}`;
      }
      message += `\n${paymentStr}`;
    }

    // Add expense ID
    message += `\nEX:${inputData.expenseId}`;

    // Add split info for group expenses
    if (splits && splits.length > 0) {
      message += '\n' + splits.map(s =>
        `   → @${s.name || 'Unknown'} owes ${formatAmount(s.amount, parsedExpense.currency)}`
      ).join('\n');
    }

    console.log(`[format-response] ✅ Message formatted`);

    setState({
      ...state,
      responseMessage: message,
    });

    return {
      success: true,
      status: 'completed' as const,
      message,
      expenseId: inputData.expenseId,
    };
  },
});
