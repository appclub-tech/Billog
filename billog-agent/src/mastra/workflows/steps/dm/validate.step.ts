/**
 * DM Validate Step
 *
 * Validates parsed expense data and suspends for missing info (HITL).
 * For DM, we only need: amount, description.
 *
 * If missing fields:
 * - Suspend workflow with prompt for user
 * - On resume, merge user's reply with existing data
 * - Re-validate and continue or suspend again
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { parseExpenseText } from '../../../tools/parse-text.tool.js';
import { generateMissingFieldsPrompt } from '../../../tools/parse-text.tool.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
  ExpenseResumeSchema,
  type Language,
} from '../../schemas.js';

const DmValidateInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  userLanguage: z.enum(['th', 'en']).default('th'),
  userCurrency: z.string().default('THB'),
});

const DmValidateOutputSchema = z.object({
  isValid: z.boolean(),
  parsedExpense: ParsedExpenseSchema,
});

const DmValidateSuspendSchema = z.object({
  prompt: z.string(),
  missingFields: z.array(z.string()),
});

export const dmValidateStep = createStep({
  id: 'dm-validate',
  description: 'Validate DM expense and suspend for missing info (HITL)',
  inputSchema: DmValidateInputSchema,
  outputSchema: DmValidateOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  resumeSchema: ExpenseResumeSchema,
  suspendSchema: DmValidateSuspendSchema,
  execute: async ({ inputData, resumeData, suspend, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] dm-validate`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  IsValid: ${inputData.isValid}`);
    console.log(`  Missing: ${inputData.missingFields.join(', ') || 'none'}`);
    if (resumeData) {
      console.log(`  ResumeData: ${JSON.stringify(resumeData)}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    // Start with existing parsed expense or empty
    let parsedExpense = inputData.parsedExpense || {
      description: null,
      amount: null,
      currency: inputData.userCurrency,
      category: 'Other',
      date: null,
      splitType: null,
      splitTargets: [],
      items: [],
      payment: null,
      metadata: undefined,
    };

    // If we have resume data, merge it with existing
    if (resumeData) {
      console.log(`[dm-validate] Processing resume data...`);

      // If user provided text, parse it
      if (resumeData.description || resumeData.amount) {
        // Direct values from resume
        if (resumeData.description) {
          parsedExpense = { ...parsedExpense, description: resumeData.description };
        }
        if (resumeData.amount) {
          parsedExpense = { ...parsedExpense, amount: resumeData.amount };
        }
      }

      console.log(`[dm-validate] After merge: ${JSON.stringify(parsedExpense)}`);
    }

    // Validate
    const missingFields: string[] = [];
    if (!parsedExpense.amount) missingFields.push('amount');
    if (!parsedExpense.description) missingFields.push('description');
    const isValid = missingFields.length === 0;

    if (!isValid) {
      // Generate prompt based on what's missing
      const prompt = generateMissingFieldsPrompt(
        {
          description: parsedExpense.description,
          amount: parsedExpense.amount,
          currency: parsedExpense.currency,
          category: parsedExpense.category || 'Other',
          splitType: null,
          splitTargets: [],
          date: null,
        },
        missingFields,
        inputData.userLanguage as Language
      );

      console.log(`[dm-validate] Suspending for: ${missingFields.join(', ')}`);
      console.log(`[dm-validate] Prompt: "${prompt}"`);

      // Update state before suspend
      setState({
        ...state,
        parsedExpense,
        isValid: false,
        missingFields,
      });

      // Suspend workflow - will resume when user replies
      return await suspend({
        prompt,
        missingFields,
      });
    }

    console.log(`[dm-validate] ✅ Validation passed`);

    // Update state with validated expense
    setState({
      ...state,
      parsedExpense,
      isValid: true,
      missingFields: [],
    });

    return {
      isValid: true,
      parsedExpense,
    };
  },
});
