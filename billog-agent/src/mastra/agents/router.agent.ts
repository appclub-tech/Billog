/**
 * Router Agent (Agent Network)
 *
 * Top-level routing agent that delegates to specialized agents:
 * - Bookkeeper Agent: Expense recording, balance queries, settlements
 * - Insights Agent: Item search, duplicate purchase warnings
 *
 * Uses Mastra Agent Networks for LLM-based routing decisions.
 */

import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import type { RequestContext } from '@mastra/core/request-context';
import path from 'path';

import { billogAgent } from './billog.agent.js';
import { insightsAgent } from './insights.agent.js';

/**
 * Get database path for router memory
 */
function getRouterDbUrl(): string {
  if (process.env.ROUTER_DATABASE_URL) {
    return process.env.ROUTER_DATABASE_URL;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'file:/app/data/router-memory.db';
  }
  return `file:${path.join(process.cwd(), 'data', 'router-memory.db')}`;
}

/**
 * Type for the RequestContext passed from the gateway
 */
type RouterRequestContext = {
  userLanguage: 'th' | 'en';
  userTimezone: string;
  channel: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
  senderChannelId: string;
  sourceChannelId: string;
  isGroup: boolean;
  senderName?: string;
  sourceName?: string;
};

/**
 * Router Agent Instructions
 */
const ROUTER_INSTRUCTIONS = `You are Billog's Router Agent. Your job is to understand the user's request and route it to the right specialist agent.

## Available Agents

### 1. Bookkeeper Agent (billog)
Handles ALL expense and financial operations:
- Recording expenses: "coffee 65", "lunch 300 @all", receipt images
- Balance queries: "who owes what", "ยอดเท่าไหร่"
- Settlements: "paid jerry 200", "จ่ายแล้ว"
- Expense history: "show expenses", "list my spending"
- Help requests about using Billog

### 2. Insights Agent (insights)
Handles shopping intelligence and item searches:
- Item queries: "have I bought banana?", "ซื้อกล้วยไปยัง", "did I buy milk?"
- Purchase history by item: "what groceries did I buy this week?"
- Duplicate purchase checks when recording expenses

## Routing Rules

1. **Expense Recording** (text like "coffee 65" or receipt images):
   - Route to: Bookkeeper FIRST to record
   - THEN route to: Insights to check for duplicates
   - Both agents should process

2. **Item Search Queries** ("have I bought X?", "ซื้อ X ไปยัง"):
   - Route to: Insights ONLY
   - Bookkeeper should NOT respond

3. **Balance/Settlement/History Queries**:
   - Route to: Bookkeeper ONLY
   - Insights should NOT respond

4. **Help Requests**:
   - Route to: Bookkeeper ONLY

## Context

Each message includes context about the channel, sender, and source.
Match the user's language (Thai or English) in your routing decisions.

## Important

- You are a ROUTER, not a responder. Do NOT answer questions yourself.
- Always delegate to the appropriate agent(s).
- For expense messages, use BOTH agents (Bookkeeper to record, Insights to check duplicates).
`;

/**
 * Dynamic instructions based on user language
 */
function getRouterInstructions({
  requestContext,
}: {
  requestContext?: RequestContext<RouterRequestContext>;
}): string {
  const userLanguage = requestContext?.get('userLanguage') || 'th';
  const languageSuffix = userLanguage === 'th'
    ? `\n\n## ภาษา\nผู้ใช้พูดภาษาไทย - route ไปยัง agent ที่เหมาะสม`
    : `\n\n## Language\nUser speaks English - route to the appropriate agent.`;

  return ROUTER_INSTRUCTIONS + languageSuffix;
}

/**
 * Memory for Router Agent
 * Required for Agent Networks to track task history
 */
const routerDbUrl = getRouterDbUrl();
console.log(`[Router] Database URL: ${routerDbUrl}`);

const routerMemory = new Memory({
  storage: new LibSQLStore({
    id: 'billog-router',
    url: routerDbUrl,
  }),
  options: {
    lastMessages: 5, // Keep recent context for routing decisions
  },
});

/**
 * Router Agent
 *
 * Uses Agent Network to route messages to specialized agents.
 * Fast model (gpt-4o-mini) for quick routing decisions.
 */
export const routerAgent = new Agent({
  id: 'router',
  name: 'Billog Router',
  description: 'Routes user requests to the appropriate specialist agent (Bookkeeper or Insights)',
  instructions: getRouterInstructions,
  model: 'openai/gpt-4o-mini', // Fast model for routing
  memory: routerMemory,
  // Agent Network: sub-agents that can be called
  agents: {
    billog: billogAgent,
    insights: insightsAgent,
  },
});
