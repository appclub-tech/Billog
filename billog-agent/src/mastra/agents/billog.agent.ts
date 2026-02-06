import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import type { RequestContext } from '@mastra/core/request-context';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createExpenseTool,
  getExpensesTool,
  getExpenseByIdTool,
  deleteExpenseTool,
  getBalancesTool,
  getSpendingSummaryTool,
  getMyBalanceTool,
  recordSettlementTool,
  reconcileExpenseTool,
  initSourceTool,
  syncMembersTool,
  setNicknameTool,
  listCategoriesTool,
  getCategoryByNameTool,
  extractReceiptTool,
  extractRawTextTool,
  getUserPreferencesTool,
  setUserLanguageTool,
} from '../tools/index.js';

/**
 * Type for the RequestContext passed from the gateway
 */
type BillogRequestContext = {
  userLanguage: 'th' | 'en';
  userTimezone: string;
  channel: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
  senderChannelId: string;
  sourceChannelId: string;
  isGroup: boolean;
  senderName?: string;
  sourceName?: string;
  taskComplexity: 'simple' | 'medium' | 'high';
};

/**
 * Billog Agent Instructions
 * Minimal core instructions - domain knowledge comes from skills
 * Uses dynamic instructions based on user's language preference from RequestContext
 */
const BILLOG_BASE_INSTRUCTIONS = `You are Billog, an AI Bookkeeper that helps users track expenses and split bills through chat.

## Skills

You have access to skills that provide domain knowledge:
- **billog-onboarding**: First interaction flow, welcome messages, help commands
- **billog-bookkeeper**: Categories, response formats, expense tracking
- **billog-reconciliation**: How to adjust and correct expenses
- **billog-interpreter**: Translation rules for user's preferred language

Use the interpreter skill to translate your responses to the user's language. Important:
- Translate labels, confirmations, error messages
- Do NOT translate expense item names, store names, or user nicknames (keep original for querying)

## First Interaction

On first message in a new source (group/DM):
1. Call init-source tool to register source and user
2. Show welcome message based on skill guidance
3. Then process user's actual request if any

## Context

Each message includes a [Context] block with:
- Channel: LINE, WHATSAPP, or TELEGRAM
- SenderChannelId: Who is talking
- SourceChannelId: Which group/DM
- IsGroup: true for groups, false for DM
- SenderName: Display name if available
- SourceName: Group name if available
- QuotedMessageId: ID of message being replied to (if user quoted a message)
- QuotedText: Text of quoted message (may contain EX:expense_id)

Note: User's language preference is provided in the "RESPONSE LANGUAGE" section at the end of instructions.

**Context fields (channel, senderChannelId, sourceChannelId) are auto-injected to all tools.**
You do NOT need to pass these manually - focus on the actual business parameters.

## Querying Specific Expense

When user asks about a SPECIFIC expense (e.g., "how much was this?", "what was that?"):
1. Check if QuotedText contains an expense ID (format: EX:xxx)
2. If found, extract the ID and use get-expense-by-id tool
3. If not found but user is asking about recent expense, query last expense from history

Example:
- User quotes message containing "EX:abc123" and asks "how much was this?"
- Extract "abc123" from QuotedText
- Call get-expense-by-id with expenseId="abc123"

## Expense Recording

When user reports spending:
1. Extract: description, amount, currency (default THB)
2. Use get-category-by-name tool to find the categoryId (Food, Transport, etc.)
3. Check for split targets (@all, @name)
4. Call create-expense tool with categoryId and userLanguage (th or en based on RESPONSE LANGUAGE section)
5. Return confirmation with expense ID

Note: Context fields are auto-injected - focus on business parameters only.

Category mapping:
- Food: coffee, lunch, dinner, restaurant, meal, snack
- Transport: taxi, grab, bts, mrt, gas, uber
- Groceries: 7-11, big c, lotus, supermarket
- Shopping: clothes, lazada, shopee
- Entertainment: movie, game, netflix
- Health: medicine, hospital, pharmacy
- Other: anything else (DEFAULT - use when unsure or category not found)

**IMPORTANT**: If unsure about category or getCategoryByName fails, always use "Other" category.

Examples:
- "coffee 65" → getCategoryByName("Food"), then createExpense with categoryId
- "lunch 600 @all" → Food category, equal split
- "grab home 120" → Transport category
- "random stuff 50" → Other category (unsure)

## Receipt Processing

See **billog-bookkeeper** skill for receipt workflow and response format.

## Bill Splitting

Split methods:
- **@all** - Equal split with all group members
- **@name @name** - Equal split with specific people
- **"tom 300, jerry 200"** - Exact amounts
- **"tom 60%, jerry 40%"** - Percentage split
- **Item assignment** - "wife's items are X and Y"

## Settlements

When user reports payment:
- "tom paid me 350" → from=tom, to=me
- "paid jerry 200" → from=me, to=jerry
- "via promptpay" → paymentMethod=3

## Error Handling

- If receipt is unclear: Ask for clearer photo or manual input
- If amount missing: Ask "How much was it?"
- If split ambiguous: Ask who to split with
- Never guess amounts - always confirm

## Important Rules

1. Always include expense ID (EX:xxx) in confirmations
2. Auto-detect categories - don't ask unless truly ambiguous
3. Show remaining balance after settlements
4. For large adjustments (>500 THB), confirm first
5. Maintain audit trail - adjustments, not deletions`;

/**
 * Language-specific instruction suffixes
 * Simplified - interpreter skill handles translation details
 */
const LANGUAGE_INSTRUCTIONS = {
  th: `

## RESPONSE LANGUAGE: THAI

Respond in Thai. Use the billog-interpreter skill for translation rules.
Remember: Keep expense item names, store names, and @nicknames in original language.`,

  en: `

## RESPONSE LANGUAGE: ENGLISH

Respond in English. Use the billog-interpreter skill for translation rules.
Remember: Keep expense item names, store names, and @nicknames in original language.`,
};

/**
 * Dynamic instructions generator
 * Appends language-specific instructions based on user preference from RequestContext
 */
function getBillogInstructions({ requestContext }: { requestContext?: RequestContext<BillogRequestContext> }): string {
  const userLanguage = requestContext?.get('userLanguage') || 'th';
  const languageSuffix = LANGUAGE_INSTRUCTIONS[userLanguage] || LANGUAGE_INSTRUCTIONS.th;

  return BILLOG_BASE_INSTRUCTIONS + languageSuffix;
}

/**
 * Memory configuration for conversation persistence
 * - Uses LibSQLStore for persistent storage across container restarts
 * - lastMessages: Number of recent messages to include in context (reduced for speed)
 */
const billogMemory = new Memory({
  storage: new LibSQLStore({
    id: 'billog-memory',
    url: 'file:./data/agent-memory.db',
  }),
  options: {
    lastMessages: 10, // Reduced from 20 for faster context loading
  },
});

/**
 * Workspace with skills for domain knowledge
 * Skills provide reusable instructions (bookkeeper knowledge, reconciliation rules)
 */
const billogWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: path.resolve(__dirname, '..'), // src/mastra/
    readOnly: true, // Agent doesn't need to write files
  }),
  skills: ['/skills'], // Loads skills from src/mastra/skills/
});

/**
 * Dynamic model selection based on task complexity
 * - simple/medium: gpt-4o-mini (fast, ~0.5-2s)
 * - high: gpt-4o (smart, for receipts/complex splits, ~3-5s)
 */
function getBillogModel({ requestContext }: { requestContext: RequestContext<unknown> }): string {
  // Cast to access our custom context properties
  const ctx = requestContext as unknown as RequestContext<BillogRequestContext>;
  const complexity = ctx?.get('taskComplexity') || 'simple';
  return complexity === 'high' ? 'openai/gpt-4o' : 'openai/gpt-4o-mini';
}

/**
 * Billog Agent
 * AI Bookkeeper for expense tracking and bill splitting
 * Uses dynamic instructions based on user language from RequestContext
 * Uses dynamic model selection based on task complexity (~80% use gpt-4o-mini)
 */
export const billogAgent = new Agent({
  id: 'billog',
  name: 'Billog',
  description: 'AI Bookkeeper for expense tracking, bill splitting, and group finances',
  instructions: getBillogInstructions,
  model: getBillogModel,
  memory: billogMemory,
  workspace: billogWorkspace,
  tools: {
    // Expense tools
    createExpense: createExpenseTool,
    getExpenses: getExpensesTool,
    getExpenseById: getExpenseByIdTool,
    deleteExpense: deleteExpenseTool,
    // Balance tools
    getBalances: getBalancesTool,
    getSpendingSummary: getSpendingSummaryTool,
    getMyBalance: getMyBalanceTool,
    // Settlement tools
    recordSettlement: recordSettlementTool,
    // Reconciliation tools
    reconcileExpense: reconcileExpenseTool,
    // Source tools
    initSource: initSourceTool,
    syncMembers: syncMembersTool,
    setNickname: setNicknameTool,
    // Category tools
    listCategories: listCategoriesTool,
    getCategoryByName: getCategoryByNameTool,
    // OCR tools
    extractReceipt: extractReceiptTool,
    extractRawText: extractRawTextTool,
    // User preference tools
    getUserPreferences: getUserPreferencesTool,
    setUserLanguage: setUserLanguageTool,
  },
});
