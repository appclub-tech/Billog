import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import path from 'path';
import { billogAgent } from './agents/billog.agent.js';
import { insightsAgent } from './agents/insights.agent.js';
import { createGateway, type GatewayConfig } from './gateway/index.js';
import { messageWorkflow } from './workflows/index.js';

// Resolve data directory path
function getMastraDbUrl(): string {
  if (process.env.MASTRA_DATABASE_URL) {
    return process.env.MASTRA_DATABASE_URL;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'file:/app/data/mastra.db';
  }
  // In development, use process.cwd() which is where mastra dev was run from
  return `file:${path.join(process.cwd(), 'data', 'mastra.db')}`;
}

// ===========================================
// Configuration
// ===========================================

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ===========================================
// Gateway Configuration
// ===========================================

export const gatewayConfig: GatewayConfig = {
  billogApiUrl: process.env.BILLOG_API_URL || 'http://localhost:8000',

  // LINE configuration (optional)
  ...(process.env.LINE_CHANNEL_ACCESS_TOKEN && {
    line: {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET || '',
      uploadsDir: UPLOADS_DIR,
      baseUrl: BASE_URL,
    },
  }),

  // WhatsApp configuration (optional)
  ...(process.env.WHATSAPP_ENABLED === 'true' && {
    whatsapp: {
      sessionPath: process.env.WHATSAPP_SESSION_PATH || './data/whatsapp',
    },
  }),

  // Group activation settings
  groupActivation: {
    mode: (process.env.GROUP_ACTIVATION_MODE as 'mention' | 'always') || 'mention',
    mentionPatterns: process.env.GROUP_MENTION_PATTERNS?.split(',') || ['@billog', 'billog'],
  },
};

// ===========================================
// Create Gateway (initialized lazily)
// ===========================================

export const gateway = createGateway(gatewayConfig);
let gatewayInitialized = false;

export async function ensureGatewayInitialized(mastra: Mastra): Promise<void> {
  if (!gatewayInitialized) {
    await gateway.initialize(mastra);
    gatewayInitialized = true;
  }
}

// ===========================================
// Storage Configuration
// ===========================================

/**
 * Storage for Mastra core domains:
 * - workflows: suspended workflow state (HITL)
 * - scores: evaluation results
 * - observability: traces and spans
 *
 * Note: Agent memory uses separate storage (see billog.agent.ts)
 */
const mastraDbUrl = getMastraDbUrl();
console.log(`[Mastra] Database URL: ${mastraDbUrl}`);

const storage = new LibSQLStore({
  id: 'billog-mastra',
  url: mastraDbUrl,
});

// ===========================================
// Mastra Instance
// ===========================================

export const mastra = new Mastra({
  agents: {
    billog: billogAgent,
    insights: insightsAgent,
  },
  workflows: {
    messageWorkflow,
  },
  storage,
});

// ===========================================
// Exports
// ===========================================

export { billogAgent, insightsAgent };
export { UPLOADS_DIR, BASE_URL };
export * from './tools/index.js';
export { createGateway, GatewayRouter } from './gateway/index.js';
export type { GatewayConfig, InboundMessage, OutboundResponse, AgentContext } from './gateway/index.js';
export { messageWorkflow, dmWorkflow, groupWorkflow, shouldUseWorkflow } from './workflows/index.js';
export type { MessageInput, MessageOutput, MessageWorkflowState, ParsedExpense } from './workflows/index.js';
