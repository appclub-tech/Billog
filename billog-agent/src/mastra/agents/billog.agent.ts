import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import type { RequestContext } from '@mastra/core/request-context';
import { UnicodeNormalizer, TokenLimiterProcessor } from '@mastra/core/processors';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
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
  processReceiptTool,
  processTextExpenseTool,
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

When user sends a TEXT message to record spending:
1. Call process-text-expense tool with the text
2. The tool parses, validates, and creates the expense in one step
3. If missing info (e.g., no amount), tool will return questions to ask user
4. Return the confirmation with EX:{expenseId}

Examples:
- "coffee 65" → process-text-expense → EX:xxx
- "lunch 600 @all" → process-text-expense (handles split) → EX:xxx
- "fuel $80 today" → process-text-expense (detects USD, date) → EX:xxx
- "50" → process-text-expense → asks "What did you buy?"

⚠️ Use process-text-expense for TEXT messages.
⚠️ Use process-receipt for RECEIPT IMAGES.

## Receipt Processing

When user sends a receipt image:
1. Call process-receipt tool with the imageUrl
2. The tool does OCR + creates expense in ONE step
3. Only respond AFTER getting expenseId from the tool
4. Include EX:{expenseId} in your response

⚠️ CRITICAL: Use process-receipt (not extract-receipt) for receipts.
process-receipt handles everything - OCR, expense creation, payment method linking.

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
 * Memory configuration for Billog
 *
 * Optimized for expense tracking workflow:
 * - Users send quick messages ("coffee 65") or receipts, then go
 * - Minimal message history needed (3 messages = expense + confirmation + follow-up)
 * - Semantic recall for "same as last time" or "lunch again" patterns
 * - Working memory for persistent user preferences
 *
 * LibSQLStore is a MastraCompositeStore with domains:
 * - memory: threads, messages, resources, working memory
 * - workflows: suspended workflow state (for HITL)
 */
const billogMemory = new Memory({
  // Composite storage for memory domain
  storage: new LibSQLStore({
    id: 'billog-memory',
    url: process.env.MEMORY_DATABASE_URL || 'file:./data/agent-memory.db',
  }),
  // Vector store for semantic recall (same DB, different tables)
  vector: new LibSQLVector({
    id: 'billog-vector',
    url: process.env.MEMORY_DATABASE_URL || 'file:./data/agent-memory.db',
  }),
  // Embedder for semantic search (uses OPENAI_API_KEY)
  embedder: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'),
  options: {
    // Minimal history - expense tracking is quick in/out
    lastMessages: 3,

    // Semantic recall - for "same as yesterday" or "lunch again"
    semanticRecall: {
      topK: 2,           // 2 similar past expenses is enough
      messageRange: 1,   // Minimal context around match
      scope: 'resource', // Search across all threads for this source
    },

    // Working memory - persistent user context (compact template)
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `# User Profile
- **Language**:
- **Currency**:
- **Common Categories**:
- **Frequent Stores**:

# Group (if applicable)
- **Usual Payer**:
- **Split Method**:
- **Members**:
`,
    },
  },
});

// ============================================
// Processors Configuration
// ============================================

/**
 * UnicodeNormalizer - Critical for Thai text
 * Normalizes Unicode representations for consistent parsing.
 * Thai text can have multiple Unicode forms that look identical.
 */
const unicodeNormalizer = new UnicodeNormalizer({
  stripControlChars: true,    // Remove control chars (keep newlines, tabs)
  preserveEmojis: true,       // Keep 📸 🍕 💰 etc for receipts
  collapseWhitespace: true,   // Normalize spaces
  trim: true,                 // Trim leading/trailing whitespace
});

/**
 * TokenLimiter - Cost optimization
 * Prevents context window overflow by limiting token count.
 * Uses o200k_base encoding (GPT-4o compatible).
 */
const tokenLimiter = new TokenLimiterProcessor({
  limit: 8000,  // Conservative limit for cost control
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
 *
 * Processors:
 * - UnicodeNormalizer: Normalizes Thai text for consistent parsing (critical for Thai)
 * - TokenLimiter: Controls context size for cost optimization
 *
 * Note: Memory class handles message history automatically.
 * WorkingMemory/SemanticRecall can be added later with proper vector store.
 */
export const billogAgent = new Agent({
  id: 'billog',
  name: 'Billog',
  description: 'AI Bookkeeper for expense tracking, bill splitting, and group finances',
  instructions: getBillogInstructions,
  model: getBillogModel,
  memory: billogMemory,
  workspace: billogWorkspace,
  // Input processors run before messages reach the LLM
  // Order matters: normalize first, then limit tokens after all context is loaded
  inputProcessors: [
    unicodeNormalizer,    // 1. Normalize Thai text first
    tokenLimiter,         // 2. Limit tokens (runs after Memory adds history)
  ],
  tools: {
    // Primary expense tools (use these for recording)
    processTextExpense: processTextExpenseTool,  // For text messages
    processReceipt: processReceiptTool,          // For receipt images
    // Query/manage expense tools
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
    // Category tools (for queries)
    listCategories: listCategoriesTool,
    getCategoryByName: getCategoryByNameTool,
    // User preference tools
    getUserPreferences: getUserPreferencesTool,
    setUserLanguage: setUserLanguageTool,
    // Legacy (kept for compatibility)
    createExpense: createExpenseTool,
  },
});
