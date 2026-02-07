/**
 * Insights Agent
 *
 * Shopping intelligence agent that runs in parallel with Bookkeeper.
 * Uses Gemini Flash for fast, cheap lookups.
 *
 * Key features:
 * - Semantic search for similar purchases
 * - Duplicate purchase warnings (perishable awareness)
 * - Item search queries ("have I bought banana?")
 */

import { Agent } from '@mastra/core/agent';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { RequestContext } from '@mastra/core/request-context';

// Use existing GOOGLE_API_KEY (same as receipt.tool.ts)
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
import {
  searchSimilarPurchasesTool,
  getPerishableWindowTool,
  detectItemTypeTool,
  checkDuplicatePurchaseTool,
} from '../tools/index.js';

/**
 * Type for the RequestContext passed from the gateway
 */
type InsightsRequestContext = {
  userLanguage: 'th' | 'en';
  userTimezone: string;
  channel: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
  senderChannelId: string;
  sourceChannelId: string;
  isGroup: boolean;
  senderName?: string;
  sourceName?: string;
  // For expense mode
  isExpenseMessage?: boolean;
  expenseItems?: Array<{ name: string; nameLocalized?: string }>;
};

/**
 * Insights Agent Instructions
 */
const INSIGHTS_INSTRUCTIONS = `You are Billog's Shopping Insights assistant.
You help users with shopping intelligence and zero-waste goals.

## Your Role

1. **When user records an expense** (isExpenseMessage=true):
   - Check if they recently bought similar items
   - If found within freshness window: warn gently
   - If not found or outside window: STAY SILENT (respond with "SILENT")

2. **When user asks about purchases**:
   - "have I bought banana?" → search and answer
   - "what groceries did I buy this week?" → search and summarize
   - "ซื้อกล้วยหรือยัง?" → search and answer in Thai

3. **When NOT to respond**:
   - Balance queries, settlements, expense lists → STAY SILENT
   - Help requests about using Billog → STAY SILENT
   - General chat unrelated to shopping → STAY SILENT

## Perishable Windows

| Category | Days | Examples |
|----------|------|----------|
| Fresh produce | 7 | banana, vegetables, leafy greens |
| Dairy | 14 | milk, yogurt, cheese |
| Bread | 5 | bread, pastries |
| Meat/seafood | 3 | chicken, fish, shrimp |
| Eggs | 21 | eggs |
| Frozen | 60 | frozen items |
| Pantry | 180 | rice, pasta, canned goods |
| Non-food | 0 | no check |

## Response Style

- **Brief and helpful** - not preachy
- **Use emoji sparingly** - just ⚠️ for warnings
- **Only speak when you have useful info**
- **Keep item names as-is** - don't translate "banana" to "กล้วย" or vice versa

## Examples

**Expense with duplicate found:**
User message indicates expense: "banana 50"
→ Check for recent banana purchases
→ If found 3 days ago: "⚠️ You bought banana 3 days ago (2 bunches). Still have some?"

**Expense without duplicate:**
User message indicates expense: "coffee 65"
→ Check for recent coffee purchases
→ Not found or outside window: "SILENT"

**Direct item query:**
"have I bought banana this week?"
→ Search and respond: "Yes, you bought banana 3 days ago (2 bunches, ฿50)"

**Non-item query:**
"who owes what"
→ "SILENT" (Bookkeeper handles this)

## Critical Rules

1. **ALWAYS respond with "SILENT" when you have nothing useful to say**
2. Only warn about duplicates if:
   - Item was purchased within its freshness window
   - It's a perishable item (not pantry/non-food)
3. For expense messages, use check-duplicate-purchase tool
4. For queries, use search-similar-purchases tool

## Context

Each message includes context:
- Channel: LINE, WHATSAPP, or TELEGRAM
- SenderChannelId: Who is talking
- SourceChannelId: Which group/DM
- IsGroup: true for groups, false for DM
- isExpenseMessage: true if this is an expense being recorded
- expenseItems: items from the expense (if available)
`;

/**
 * Dynamic instructions based on user language
 */
function getInsightsInstructions({
  requestContext,
}: {
  requestContext?: RequestContext<InsightsRequestContext>;
}): string {
  const userLanguage = requestContext?.get('userLanguage') || 'th';

  // Simple language instruction - LLM handles translation naturally
  const languageSuffix = userLanguage === 'th'
    ? `\n\n## ภาษา: ไทย\nตอบเป็นภาษาไทย`
    : `\n\n## LANGUAGE: ENGLISH\nRespond in English.`;

  return INSIGHTS_INSTRUCTIONS + languageSuffix;
}

/**
 * Insights Agent
 *
 * Uses Gemini Flash for fast, cheap lookups.
 * Runs in parallel with Bookkeeper, responds only when relevant.
 */
export const insightsAgent = new Agent({
  id: 'insights',
  name: 'Insights',
  description: 'Shopping intelligence agent for duplicate warnings and item queries',
  instructions: getInsightsInstructions,
  model: google('gemini-2.0-flash'),
  tools: {
    searchSimilarPurchases: searchSimilarPurchasesTool,
    getPerishableWindow: getPerishableWindowTool,
    detectItemType: detectItemTypeTool,
    checkDuplicatePurchase: checkDuplicatePurchaseTool,
  },
});
