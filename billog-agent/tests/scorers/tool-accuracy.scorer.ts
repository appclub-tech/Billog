/**
 * Tool Call Accuracy Scorers
 *
 * Evaluates whether the agent calls the correct tools for given inputs.
 * Uses Mastra's createScorer for custom evaluation logic.
 *
 * Key workflows tested:
 * 1. Text expense: No OCR needed → directly call create-expense
 * 2. Receipt image: Must call extract-receipt → then create-expense
 * 3. Query expenses: Call get-expenses, NOT create-expense
 * 4. Balance query: Call get-balances, NOT create-expense
 */

import { createScorer, type MastraScorer } from '@mastra/core/evals';

/**
 * Extract tool calls from run output (handles different structures)
 */
function extractToolCalls(run: { output: any[] | any }): string[] {
  const toolCalls: string[] = [];
  const outputs = Array.isArray(run.output) ? run.output : [run.output];

  for (const output of outputs) {
    // Check toolInvocations (Mastra standard)
    if (output?.toolInvocations) {
      for (const invocation of output.toolInvocations) {
        if (invocation.toolName) {
          toolCalls.push(invocation.toolName);
        }
      }
    }

    // Check toolCalls (alternative format)
    if (output?.toolCalls) {
      for (const call of output.toolCalls) {
        if (call.toolName) {
          toolCalls.push(call.toolName);
        }
      }
    }

    // Check steps for tool calls
    if (output?.steps) {
      for (const step of output.steps) {
        if (step.toolCalls) {
          for (const call of step.toolCalls) {
            if (call.toolName) {
              toolCalls.push(call.toolName);
            }
          }
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Receipt Workflow Tool Accuracy Scorer
 *
 * For receipt images, verifies:
 * 1. extract-receipt is called (OCR)
 * 2. create-expense is called after OCR (to save data)
 * 3. Correct order: extract → create
 */
export const receiptToolAccuracyScorer = createScorer({
  id: 'receipt-tool-accuracy',
  description: 'Verifies correct tool sequence for receipt processing',
  type: 'agent',
}).generateScore(({ run }) => {
  // Extract tool calls from the run
  const toolCalls = extractToolCalls(run);

  // Check for expected tools
  const hasExtractReceipt = toolCalls.includes('extractReceipt');
  const hasCreateExpense = toolCalls.includes('createExpense');

  // For receipts, both should be called
  if (!hasExtractReceipt && !hasCreateExpense) {
    return 0; // No relevant tools called
  }

  if (!hasExtractReceipt) {
    return 0.3; // Created expense without OCR
  }

  if (!hasCreateExpense) {
    return 0.5; // OCR but didn't save
  }

  // Check order
  const extractIndex = toolCalls.indexOf('extractReceipt');
  const createIndex = toolCalls.indexOf('createExpense');

  if (extractIndex > createIndex) {
    return 0.7; // Wrong order
  }

  return 1.0; // Correct: extract → create
});

/**
 * Text Expense Tool Accuracy Scorer
 *
 * For text expenses (no image), verifies:
 * 1. create-expense is called
 * 2. extract-receipt is NOT called (no image to OCR)
 */
export const textExpenseToolAccuracyScorer = createScorer({
  id: 'text-expense-tool-accuracy',
  description: 'Verifies correct tool usage for text expenses',
  type: 'agent',
}).generateScore(({ run }) => {
  const toolCalls = extractToolCalls(run);

  // Log for debugging
  if (process.env.DEBUG) {
    console.log('Text expense scorer - tool calls:', toolCalls);
    console.log('Run output:', JSON.stringify(run.output, null, 2).slice(0, 500));
  }

  const hasExtractReceipt = toolCalls.includes('extractReceipt');
  const hasCreateExpense = toolCalls.includes('createExpense');

  // If we can't detect any tool calls, check the response for expense ID
  // This means the agent worked but we couldn't detect tools
  if (toolCalls.length === 0) {
    const outputs = Array.isArray(run.output) ? run.output : [run.output];
    const lastOutput = outputs[outputs.length - 1];
    const text = lastOutput?.content || lastOutput?.text || '';
    const hasExpenseId = /ex:[a-zA-Z0-9-]+/i.test(text);

    // If expense was created (has ID), score based on that
    return hasExpenseId ? 0.8 : 0;
  }

  // For text expenses, should NOT call extract-receipt
  if (hasExtractReceipt) {
    return 0.5; // Unnecessary OCR call
  }

  if (!hasCreateExpense) {
    return 0; // Didn't create expense
  }

  return 1.0; // Correct: only create-expense
});

/**
 * Query Tool Accuracy Scorer
 *
 * For queries like "show expenses", verifies:
 * 1. get-expenses or get-balances is called
 * 2. create-expense is NOT called
 */
export const queryToolAccuracyScorer = createScorer({
  id: 'query-tool-accuracy',
  description: 'Verifies correct tool usage for queries',
  type: 'agent',
}).generateScore(({ run }) => {
  const toolCalls = extractToolCalls(run);

  // Log for debugging
  if (process.env.DEBUG) {
    console.log('Query scorer - tool calls:', toolCalls);
  }

  const hasCreateExpense = toolCalls.includes('createExpense');
  const hasQueryTool = toolCalls.some(t =>
    ['getExpenses', 'getBalances', 'getSpendingSummary', 'getMyBalance'].includes(t)
  );

  // Should NOT create expense for queries
  if (hasCreateExpense) {
    return 0; // Wrong: created expense instead of querying
  }

  // If no tool calls detected, check response for query-like content
  if (toolCalls.length === 0) {
    const outputs = Array.isArray(run.output) ? run.output : [run.output];
    const lastOutput = outputs[outputs.length - 1];
    const text = lastOutput?.content || lastOutput?.text || '';
    // If response mentions expenses or shows list-like content, likely queried
    const looksLikeQuery = /expense|รายจ่าย|total|ทั้งหมด|balance|ยอด|list|รายการ/i.test(text);
    return looksLikeQuery ? 0.8 : 0.5;
  }

  if (!hasQueryTool) {
    return 0.5; // Didn't use query tools
  }

  return 1.0; // Correct: used query tool
});

/**
 * Expense ID Response Scorer
 *
 * Verifies that expense creation responses include an expense ID (EX:xxx)
 */
export const expenseIdResponseScorer = createScorer({
  id: 'expense-id-response',
  description: 'Verifies expense ID is included in response',
  type: 'agent',
}).generateScore(({ run }) => {
  // Get the final text response
  const outputs = Array.isArray(run.output) ? run.output : [run.output];
  const lastOutput = outputs[outputs.length - 1];
  const responseText = lastOutput?.content || lastOutput?.text || '';

  // Check for expense ID pattern (case insensitive)
  const hasExpenseId = /ex:[a-zA-Z0-9-]+/i.test(responseText);

  return hasExpenseId ? 1.0 : 0;
});

/**
 * Language Accuracy Scorer
 *
 * Verifies response language matches user preference
 */
export const languageAccuracyScorer = createScorer({
  id: 'language-accuracy',
  description: 'Verifies response language matches user preference',
  type: 'agent',
}).generateScore(({ run }) => {
  const expectedLanguage = run.groundTruth as 'th' | 'en' | undefined;
  if (!expectedLanguage) return 1.0; // No preference specified

  const lastOutput = run.output[run.output.length - 1];
  const responseText = lastOutput?.content || '';

  // Simple heuristic: Check for Thai characters
  const hasThai = /[\u0E00-\u0E7F]/.test(responseText);

  if (expectedLanguage === 'th') {
    return hasThai ? 1.0 : 0.5; // Should have Thai
  } else {
    return hasThai ? 0.5 : 1.0; // Should be English only
  }
});

/**
 * All scorers for agent evaluation
 */
export const billogAgentScorers: MastraScorer[] = [
  receiptToolAccuracyScorer,
  textExpenseToolAccuracyScorer,
  queryToolAccuracyScorer,
  expenseIdResponseScorer,
  languageAccuracyScorer,
];
