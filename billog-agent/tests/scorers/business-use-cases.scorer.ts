/**
 * Business Use Case Scorers
 *
 * Evaluates the Billog agent against real business scenarios.
 * These scorers verify that the agent handles typical user interactions correctly.
 */

import { createScorer, type MastraScorer } from '@mastra/core/evals';

// ============================================
// Helper Functions
// ============================================

// Debug flag for logging (set to true when debugging scorer issues)
const DEBUG_RESPONSE = false;

// Helper for debug logging that works in Node.js test environment
function debugLog(message: string): void {
  if (DEBUG_RESPONSE && typeof console !== 'undefined') {
    console.error(message);
  }
}

/**
 * Extract the final text response from a Mastra agent run
 *
 * Mastra agent output structure:
 * run.output = [
 *   {
 *     role: "assistant",
 *     content: {
 *       format: 2,
 *       parts: [
 *         { type: "tool-invocation", toolInvocation: { result: { message: "..." } } },
 *         { type: "text", text: "..." }
 *       ]
 *     }
 *   }
 * ]
 */
function getResponseText(run: { output: any[] | any }): string {
  try {
    // Handle null/undefined
    if (!run || !run.output) {
      return '';
    }

    const outputs = Array.isArray(run.output) ? run.output : [run.output];
    const textParts: string[] = [];

    // Process each output message
    for (const output of outputs) {
      if (!output) continue;

      // Handle Mastra format: { role: "assistant", content: { format: 2, parts: [...] } }
      if (output.content && typeof output.content === 'object' && output.content.parts) {
        for (const part of output.content.parts) {
          // Extract text parts
          if (part.type === 'text' && typeof part.text === 'string') {
            textParts.push(part.text);
          }

          // Extract tool invocation results
          if (part.type === 'tool-invocation' && part.toolInvocation?.result) {
            const result = part.toolInvocation.result;
            // Check for message in tool result
            if (typeof result.message === 'string') {
              textParts.push(result.message);
            }
            // Check for content in tool result
            if (typeof result.content === 'string') {
              textParts.push(result.content);
            }
            // Check for text in tool result
            if (typeof result.text === 'string') {
              textParts.push(result.text);
            }
          }
        }
      }

      // Fallback: Direct string
      if (typeof output === 'string') {
        textParts.push(output);
      }

      // Fallback: Object with content property (string)
      if (typeof output.content === 'string') {
        textParts.push(output.content);
      }

      // Fallback: Object with text property
      if (typeof output.text === 'string') {
        textParts.push(output.text);
      }

      // Fallback: Handle array content with text items
      if (Array.isArray(output.content)) {
        for (const c of output.content) {
          if (c?.type === 'text' && typeof c?.text === 'string') {
            textParts.push(c.text);
          }
        }
      }
    }

    // Combine all extracted text
    if (textParts.length > 0) {
      const response = textParts.join('\n');
      debugLog('[Scorer] Extracted response: ' + response.slice(0, 500));
      return response;
    }

    // Last resort: stringify and extract text patterns
    const outputStr = JSON.stringify(run.output);
    if (outputStr.length > 0) {
      // Look for message in the stringified output
      const messageMatch = outputStr.match(/"message"\s*:\s*"([^"]+)"/);
      if (messageMatch && messageMatch[1]) {
        return messageMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }

      // Return stringified output if it contains expense ID pattern
      if (/EX:[a-zA-Z0-9-]+/i.test(outputStr)) {
        return outputStr;
      }
    }

    return '';
  } catch (e) {
    console.error('Error extracting response text:', e);
    return '';
  }
}

/**
 * Check if response contains an expense ID (EX:xxx format)
 */
function hasExpenseId(text: string): boolean {
  return /EX:[a-zA-Z0-9-]+/i.test(text);
}

/**
 * Check if response is in Thai
 */
function isThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

/**
 * Check if response mentions a specific amount
 * @internal Used for amount verification in scorers
 */
function mentionsAmount(text: string, amount: number): boolean {
  const patterns = [
    new RegExp(`${amount}\\s*(บาท|THB|฿)?`, 'i'),
    new RegExp(`฿?\\s*${amount}`, 'i'),
  ];
  return patterns.some(p => p.test(text));
}

// Export for potential use in other scorers
export { mentionsAmount };

// ============================================
// Expense Recording Scorers
// ============================================

/**
 * Simple Text Expense Scorer
 * Tests: "coffee 65" → should create expense and return ID
 */
export const simpleExpenseScorer = createScorer({
  id: 'simple-expense',
  description: 'Verifies simple text expense recording works correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Must have expense ID
  if (!hasExpenseId(response)) {
    return 0;
  }

  // Check if response confirms the expense
  const confirmPatterns = [
    /recorded|บันทึก|saved|เรียบร้อย|noted|จด/i,
    /expense|รายจ่าย|ค่า/i,
  ];

  const hasConfirmation = confirmPatterns.some(p => p.test(response));

  return hasConfirmation ? 1.0 : 0.7;
});

/**
 * Thai Input Scorer
 * Tests: "กาแฟ 65" → should understand Thai and create expense
 */
export const thaiInputScorer = createScorer({
  id: 'thai-input',
  description: 'Verifies Thai language input is understood correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Must have expense ID
  if (!hasExpenseId(response)) {
    return 0;
  }

  // Response should be in Thai (for Thai input)
  if (!isThai(response)) {
    return 0.7; // Created but wrong language
  }

  return 1.0;
});

/**
 * Category Detection Scorer
 * Tests: "grab home 120" → should auto-detect Transport category
 */
export const categoryDetectionScorer = createScorer({
  id: 'category-detection',
  description: 'Verifies automatic category detection works',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  if (!hasExpenseId(response)) {
    return 0;
  }

  // Check if category is mentioned
  const categoryPatterns = [
    /transport|การเดินทาง|เดินทาง|travel/i,
    /food|อาหาร/i,
    /shopping|ซื้อของ/i,
    /entertainment|บันเทิง/i,
    /category|หมวด/i,
  ];

  const mentionsCategory = categoryPatterns.some(p => p.test(response));

  return mentionsCategory ? 1.0 : 0.8; // Category optional but nice to have
});

// ============================================
// Bill Splitting Scorers
// ============================================

/**
 * Split All Scorer
 * Tests: "lunch 600 @all" → should split with all group members
 */
export const splitAllScorer = createScorer({
  id: 'split-all',
  description: 'Verifies @all split works correctly in groups',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  if (!hasExpenseId(response)) {
    return 0;
  }

  // Should mention split/share
  const splitPatterns = [
    /split|แบ่ง|หาร|share|owe|เป็นหนี้/i,
    /each|คนละ|per person/i,
  ];

  const mentionsSplit = splitPatterns.some(p => p.test(response));

  return mentionsSplit ? 1.0 : 0.5;
});

/**
 * Specific Mention Split Scorer
 * Tests: "dinner 450 @tom @jerry" → should split between specific people
 */
export const mentionSplitScorer = createScorer({
  id: 'mention-split',
  description: 'Verifies @mention split works correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  if (!hasExpenseId(response)) {
    return 0;
  }

  // Check for split breakdown or mention of people
  const patterns = [
    /tom|jerry|@\w+/i, // Mentioned names
    /split|แบ่ง|หาร/i,
    /owes|เป็นหนี้/i,
  ];

  const matchCount = patterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.5;
});

// ============================================
// Query Scorers
// ============================================

/**
 * Balance Query Scorer
 * Tests: "who owes what" → should show balances, NOT create expense
 */
export const balanceQueryScorer = createScorer({
  id: 'balance-query',
  description: 'Verifies balance queries return correct information',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should NOT have expense ID (this is a query, not creation)
  if (hasExpenseId(response)) {
    return 0; // Wrong: created expense instead of querying
  }

  // Should mention balances or amounts
  const balancePatterns = [
    /balance|ยอด|owes|เป็นหนี้|owed/i,
    /\d+\s*(THB|บาท|฿)/i, // Amount mentioned
    /settled|เคลียร์|clear/i,
  ];

  const matchCount = balancePatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.8;
  return 0.5;
});

/**
 * Expense List Query Scorer
 * Tests: "list expenses" → should show expense history
 */
export const expenseListScorer = createScorer({
  id: 'expense-list',
  description: 'Verifies expense listing works correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should NOT create new expense
  if (/created|บันทึกแล้ว|recorded/i.test(response) && hasExpenseId(response)) {
    // Check if it's listing with an ID format (EX:xxx in list is OK)
    const idMatches = response.match(/EX:[a-zA-Z0-9-]+/gi);
    if (idMatches && idMatches.length === 1) {
      return 0.3; // Likely created instead of listed
    }
  }

  // Should show list-like content
  const listPatterns = [
    /expense|รายจ่าย|รายการ/i,
    /total|รวม|ทั้งหมด/i,
    /\d+\.\s/i, // Numbered list
    /•|–|−|-/i, // Bullet points
  ];

  const matchCount = listPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.5;
});

/**
 * Recent Purchase Query Scorer
 * Tests: "have I bought banana today?" → should check recent purchases
 * This supports the zero-waste feature - checking if user already bought something
 */
export const recentPurchaseScorer = createScorer({
  id: 'recent-purchase-query',
  description: 'Verifies recent purchase queries work for zero-waste feature',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should NOT create expense (this is a query)
  if (hasExpenseId(response) && /created|บันทึก|recorded/i.test(response)) {
    return 0; // Wrong: created instead of querying
  }

  // Should indicate yes/no or show recent purchases
  const queryPatterns = [
    /yes|no|ใช่|ไม่|found|พบ|didn't|ไม่พบ/i,
    /bought|ซื้อ|purchased/i,
    /last|ล่าสุด|recent|เมื่อ/i,
    /banana|กล้วย/i, // The item being asked about
  ];

  const matchCount = queryPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.5;
});

/**
 * Summary Query Scorer
 * Tests: "summary" / "สรุป" → should show spending summary
 */
export const summaryQueryScorer = createScorer({
  id: 'summary-query',
  description: 'Verifies spending summary queries work correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should show summary-like content
  const summaryPatterns = [
    /total|รวม|ทั้งหมด/i,
    /summary|สรุป/i,
    /spent|ใช้จ่าย/i,
    /category|หมวด/i,
    /\d+\s*(THB|บาท|฿)/i, // Amount
  ];

  const matchCount = summaryPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 3) return 1.0;
  if (matchCount >= 2) return 0.8;
  if (matchCount >= 1) return 0.6;
  return 0.3;
});

// ============================================
// Settlement Scorers
// ============================================

/**
 * Settlement Recording Scorer
 * Tests: "paid jerry 200" → should record settlement
 */
export const settlementScorer = createScorer({
  id: 'settlement',
  description: 'Verifies settlement recording works correctly',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should confirm settlement
  const settlementPatterns = [
    /settled|เคลียร์|paid|จ่าย|recorded|บันทึก/i,
    /transfer|โอน|payment/i,
    /balance|ยอด|remaining|เหลือ/i,
  ];

  const matchCount = settlementPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.3;
});

// ============================================
// Error Handling Scorers
// ============================================

/**
 * Missing Amount Scorer
 * Tests: "coffee" (no amount) → should ask for amount
 */
export const missingAmountScorer = createScorer({
  id: 'missing-amount',
  description: 'Verifies agent asks for missing amount',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should ask for amount, NOT create expense
  if (hasExpenseId(response)) {
    return 0; // Wrong: created without amount
  }

  // Should ask about amount/price
  const askPatterns = [
    /how much|เท่าไหร่|เท่าไร|price|ราคา/i,
    /amount|จำนวน|cost|ค่า/i,
    /\?|？/i, // Question mark indicates asking
  ];

  const matchCount = askPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.3;
});

/**
 * Missing Description Scorer
 * Tests: "150" (no description) → should ask what was bought
 */
export const missingDescriptionScorer = createScorer({
  id: 'missing-description',
  description: 'Verifies agent asks for missing description',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Should ask for description, NOT create expense
  if (hasExpenseId(response)) {
    return 0; // Wrong: created without description
  }

  // Should ask about what was bought
  const askPatterns = [
    /what|อะไร|which|ไหน/i,
    /bought|ซื้อ|for|สำหรับ/i,
    /\?|？/i, // Question mark
  ];

  const matchCount = askPatterns.filter(p => p.test(response)).length;

  if (matchCount >= 2) return 1.0;
  if (matchCount >= 1) return 0.7;
  return 0.3;
});

// ============================================
// Language Handling Scorers
// ============================================

/**
 * Thai Response Scorer
 * Tests: Thai user should get Thai response
 */
export const thaiResponseScorer = createScorer({
  id: 'thai-response',
  description: 'Verifies Thai users get Thai responses',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Response should be in Thai
  if (!isThai(response)) {
    return 0;
  }

  // Thai response with expense ID or meaningful content
  if (hasExpenseId(response) || response.length > 20) {
    return 1.0;
  }

  return 0.7;
});

/**
 * English Response Scorer
 * Tests: English user should get English response
 */
export const englishResponseScorer = createScorer({
  id: 'english-response',
  description: 'Verifies English users get English responses',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  // Handle empty response
  if (!response || typeof response !== 'string' || response.length === 0) {
    return 0;
  }

  // Response should be in English (no Thai characters except item names)
  const thaiMatches = response.match(/[\u0E00-\u0E7F]/g);
  const thaiCharCount = thaiMatches ? thaiMatches.length : 0;
  const totalCharCount = response.length;

  // Avoid division by zero
  if (totalCharCount === 0) {
    return 0.5;
  }

  // Allow up to 20% Thai (for item names that should stay in original)
  const thaiRatio = thaiCharCount / totalCharCount;

  if (thaiRatio > 0.3) {
    return 0.5; // Too much Thai
  }

  if (thaiRatio > 0.2) {
    return 0.7;
  }

  return 1.0;
});

/**
 * Item Name Preservation Scorer
 * Tests: Item names should NOT be translated
 * e.g., "ข้าวมันไก่" should stay as "ข้าวมันไก่", not "chicken rice"
 *
 * This scorer checks that when Thai input is given, Thai text
 * appears in the response (indicating item names were preserved).
 */
export const itemNamePreservationScorer = createScorer({
  id: 'item-name-preservation',
  description: 'Verifies expense item names are preserved in original language',
  type: 'agent',
}).generateScore(({ run }) => {
  const response = getResponseText(run);

  if (!response || response.length === 0) {
    return 0.5; // Can't evaluate without response
  }

  // Check if response contains Thai characters (indicating Thai item names preserved)
  const hasThai = /[\u0E00-\u0E7F]/.test(response);

  // Check if response has expense ID (indicating successful recording)
  const hasExpenseId = /EX:[a-zA-Z0-9-]+/i.test(response);

  // If we have Thai text and expense ID, item names are likely preserved
  if (hasThai && hasExpenseId) {
    return 1.0;
  }

  // Has expense ID but no Thai - might have translated
  if (hasExpenseId && !hasThai) {
    return 0.7;
  }

  // Has Thai but no expense ID - partial success
  if (hasThai && !hasExpenseId) {
    return 0.5;
  }

  return 0.3;
});

// ============================================
// Export All Scorers
// ============================================

export const businessUseCaseScorers: MastraScorer[] = [
  // Expense Recording
  simpleExpenseScorer,
  thaiInputScorer,
  categoryDetectionScorer,

  // Bill Splitting
  splitAllScorer,
  mentionSplitScorer,

  // Queries
  balanceQueryScorer,
  expenseListScorer,
  recentPurchaseScorer,
  summaryQueryScorer,

  // Settlements
  settlementScorer,

  // Error Handling
  missingAmountScorer,
  missingDescriptionScorer,

  // Language Handling
  thaiResponseScorer,
  englishResponseScorer,
  itemNamePreservationScorer,
];
