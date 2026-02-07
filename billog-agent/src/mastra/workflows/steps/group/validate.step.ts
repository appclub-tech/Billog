/**
 * Group Validate Step
 *
 * Validates parsed expense data for group context.
 * Suspends for missing info (HITL): amount, description, split targets.
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { parseExpenseText } from '../../../tools/parse-text.tool.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
  ExpenseResumeSchema,
  type Language,
} from '../../schemas.js';

const GroupValidateInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  needsSplitInfo: z.boolean().default(false),
  userLanguage: z.enum(['th', 'en']).default('th'),
  userCurrency: z.string().default('THB'),
});

const GroupValidateOutputSchema = z.object({
  isValid: z.boolean(),
  parsedExpense: ParsedExpenseSchema,
});

const GroupValidateSuspendSchema = z.object({
  prompt: z.string(),
  missingFields: z.array(z.string()),
});

/**
 * Generate prompt for missing fields (group context)
 */
function generateGroupMissingPrompt(
  parsedExpense: { description: string | null; amount: number | null; currency: string },
  missingFields: string[],
  needsSplitInfo: boolean,
  language: Language
): string {
  const prompts: string[] = [];

  if (language === 'th') {
    if (missingFields.includes('amount') && missingFields.includes('description')) {
      prompts.push('บอกว่าซื้ออะไร ราคาเท่าไหร่? เช่น "กาแฟ 65"');
    } else if (missingFields.includes('amount')) {
      prompts.push(`"${parsedExpense.description}" ราคาเท่าไหร่?`);
    } else if (missingFields.includes('description')) {
      prompts.push(`${parsedExpense.amount} ${parsedExpense.currency} - จ่ายค่าอะไร?`);
    }

    if (needsSplitInfo) {
      prompts.push('หารกับใคร? ใช้ @all หรือ @ชื่อ');
    }
  } else {
    if (missingFields.includes('amount') && missingFields.includes('description')) {
      prompts.push('What did you buy and how much? Example: "coffee 65"');
    } else if (missingFields.includes('amount')) {
      prompts.push(`How much was "${parsedExpense.description}"?`);
    } else if (missingFields.includes('description')) {
      prompts.push(`What did you spend ${parsedExpense.amount} ${parsedExpense.currency} on?`);
    }

    if (needsSplitInfo) {
      prompts.push('Split with whom? Use @all or @name');
    }
  }

  return prompts.join('\n');
}

export const groupValidateStep = createStep({
  id: 'group-validate',
  description: 'Validate group expense and suspend for missing info (HITL)',
  inputSchema: GroupValidateInputSchema,
  outputSchema: GroupValidateOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  resumeSchema: ExpenseResumeSchema,
  suspendSchema: GroupValidateSuspendSchema,
  execute: async ({ inputData, resumeData, suspend, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] group-validate`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  IsValid: ${inputData.isValid}`);
    console.log(`  Missing: ${inputData.missingFields.join(', ') || 'none'}`);
    console.log(`  NeedsSplitInfo: ${inputData.needsSplitInfo}`);
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
      console.log(`[group-validate] Processing resume data...`);

      if (resumeData.description) {
        parsedExpense = { ...parsedExpense, description: resumeData.description };
      }
      if (resumeData.amount) {
        parsedExpense = { ...parsedExpense, amount: resumeData.amount };
      }
      if (resumeData.splitTargets && resumeData.splitTargets.length > 0) {
        parsedExpense = {
          ...parsedExpense,
          splitType: 'equal' as const,
          splitTargets: resumeData.splitTargets,
        };
      }

      console.log(`[group-validate] After merge: ${JSON.stringify(parsedExpense)}`);
    }

    // Validate
    const missingFields: string[] = [];
    if (!parsedExpense.amount) missingFields.push('amount');
    if (!parsedExpense.description) missingFields.push('description');
    const isValid = missingFields.length === 0;

    // Check if we still need split info
    const needsSplitInfo = inputData.needsSplitInfo && parsedExpense.splitTargets.length === 0;

    if (!isValid || needsSplitInfo) {
      // Generate prompt
      const prompt = generateGroupMissingPrompt(
        {
          description: parsedExpense.description,
          amount: parsedExpense.amount,
          currency: parsedExpense.currency,
        },
        missingFields,
        needsSplitInfo,
        inputData.userLanguage as Language
      );

      console.log(`[group-validate] Suspending for: ${missingFields.join(', ')}${needsSplitInfo ? ', splitInfo' : ''}`);
      console.log(`[group-validate] Prompt: "${prompt}"`);

      // Update state before suspend
      setState({
        ...state,
        parsedExpense,
        isValid: false,
        missingFields,
      });

      // Suspend workflow
      return await suspend({
        prompt,
        missingFields: needsSplitInfo ? [...missingFields, 'splitInfo'] : missingFields,
      });
    }

    console.log(`[group-validate] ✅ Validation passed`);

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
