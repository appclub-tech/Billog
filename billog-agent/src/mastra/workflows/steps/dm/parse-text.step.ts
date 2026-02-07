/**
 * DM Parse Text Step
 *
 * Parses text-based expense messages for personal (DM) expenses.
 * No split handling - DM expenses are always personal.
 *
 * Input: User message text
 * Output: Parsed expense data (description, amount, currency, category)
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { parseExpenseText, validateParsedExpense } from '../../../tools/parse-text.tool.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
  type MessageWorkflowState,
} from '../../schemas.js';

const DmParseTextInputSchema = z.object({
  messageText: z.string(),
  userCurrency: z.string().default('THB'),
  userLanguage: z.enum(['th', 'en']).default('th'),
});

const DmParseTextOutputSchema = z.object({
  success: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
});

export const dmParseTextStep = createStep({
  id: 'dm-parse-text',
  description: 'Parse text message into expense data (DM - no splits)',
  inputSchema: DmParseTextInputSchema,
  outputSchema: DmParseTextOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] dm-parse-text`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Text: "${inputData.messageText}"`);
    console.log(`${'='.repeat(60)}\n`);

    // Parse the text
    const parsed = parseExpenseText(inputData.messageText);

    // For DM, ignore any split targets (personal expense)
    parsed.splitType = null;
    parsed.splitTargets = [];

    // Override currency with user preference if not explicitly specified in text
    // (parseExpenseText defaults to THB if no currency symbol found)
    if (parsed.currency === 'THB' && inputData.userCurrency !== 'THB') {
      // Only override if no explicit currency was in the text
      const hasExplicitCurrency = /[฿$€¥]|\b(THB|USD|EUR|JPY|AUD)\b/i.test(inputData.messageText);
      if (!hasExplicitCurrency) {
        parsed.currency = inputData.userCurrency;
      }
    }

    // Validate
    const { isValid, missingFields } = validateParsedExpense(parsed);

    console.log(`[dm-parse-text] Parsed: ${JSON.stringify(parsed)}`);
    console.log(`[dm-parse-text] Valid: ${isValid}, Missing: ${missingFields.join(', ') || 'none'}`);

    const parsedExpense = {
      description: parsed.description,
      amount: parsed.amount,
      currency: parsed.currency,
      category: parsed.category,
      date: parsed.date,
      splitType: null,
      splitTargets: [],
      items: [],
      payment: null,
      metadata: undefined,
    };

    // Update workflow state
    setState({
      ...state,
      messageType: 'expense_text',
      parsedExpense,
      isValid,
      missingFields,
    });

    return {
      success: true,
      parsedExpense,
      isValid,
      missingFields,
    };
  },
});
