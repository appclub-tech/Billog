/**
 * Group Parse Text Step
 *
 * Parses text-based expense messages for group expenses.
 * Handles @mentions, @all for split targets.
 *
 * Input: User message text
 * Output: Parsed expense data with split info
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { parseExpenseText, validateParsedExpense } from '../../../tools/parse-text.tool.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
} from '../../schemas.js';

const GroupParseTextInputSchema = z.object({
  messageText: z.string(),
  userCurrency: z.string().default('THB'),
  userLanguage: z.enum(['th', 'en']).default('th'),
  members: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable(),
    channelId: z.string(),
  })).default([]),
});

const GroupParseTextOutputSchema = z.object({
  success: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  needsSplitInfo: z.boolean(), // True if no @mentions found but might need split
});

export const groupParseTextStep = createStep({
  id: 'group-parse-text',
  description: 'Parse text message into expense data (Group - with splits)',
  inputSchema: GroupParseTextInputSchema,
  outputSchema: GroupParseTextOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] group-parse-text`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Text: "${inputData.messageText}"`);
    console.log(`  Members: ${inputData.members.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Parse the text
    const parsed = parseExpenseText(inputData.messageText);

    // Override currency with user preference if not explicitly specified
    if (parsed.currency === 'THB' && inputData.userCurrency !== 'THB') {
      const hasExplicitCurrency = /[฿$€¥]|\b(THB|USD|EUR|JPY|AUD)\b/i.test(inputData.messageText);
      if (!hasExplicitCurrency) {
        parsed.currency = inputData.userCurrency;
      }
    }

    // Validate @mentions against actual members
    const validatedTargets: string[] = [];
    const invalidTargets: string[] = [];

    for (const target of parsed.splitTargets) {
      if (target.toLowerCase() === 'all') {
        // @all is always valid
        validatedTargets.push('all');
      } else {
        // Check if target matches any member name or nickname
        const memberMatch = inputData.members.find(m =>
          m.name?.toLowerCase() === target.toLowerCase() ||
          m.nickname?.toLowerCase() === target.toLowerCase()
        );

        if (memberMatch) {
          validatedTargets.push(target);
        } else {
          invalidTargets.push(target);
        }
      }
    }

    if (invalidTargets.length > 0) {
      console.log(`[group-parse-text] Invalid targets: ${invalidTargets.join(', ')}`);
    }

    // Determine if we need to ask for split info
    // In groups, expenses without @mentions could be:
    // 1. Personal expense (payer only)
    // 2. Group expense that needs split info
    // For now, treat no @mentions as personal expense (payer only)
    const needsSplitInfo = false; // Could be enhanced to ask user

    // Update parsed with validated targets
    parsed.splitTargets = validatedTargets;
    if (validatedTargets.length === 0) {
      parsed.splitType = null;
    }

    // Validate required fields
    const { isValid, missingFields } = validateParsedExpense(parsed);

    console.log(`[group-parse-text] Parsed: ${JSON.stringify(parsed)}`);
    console.log(`[group-parse-text] Valid: ${isValid}, Missing: ${missingFields.join(', ') || 'none'}`);
    console.log(`[group-parse-text] Split targets: ${validatedTargets.join(', ') || 'none (personal)'}`);

    const parsedExpense = {
      description: parsed.description,
      amount: parsed.amount,
      currency: parsed.currency,
      category: parsed.category,
      date: parsed.date,
      splitType: parsed.splitType,
      splitTargets: parsed.splitTargets,
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
      needsSplitInfo,
    };
  },
});
