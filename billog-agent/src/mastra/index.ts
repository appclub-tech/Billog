import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { billogAgent } from './agents/billog.agent.js';
import { createGateway, type GatewayConfig } from './gateway/index.js';
import { messageWorkflow } from './workflows/index.js';

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
const storage = new LibSQLStore({
  id: 'billog-mastra',
  url: process.env.MASTRA_DATABASE_URL || 'file:./data/mastra.db',
});

// ===========================================
// Mastra Instance
// ===========================================

export const mastra = new Mastra({
  agents: {
    billog: billogAgent,
  },
  workflows: {
    messageWorkflow,
  },
  storage,
});

// ===========================================
// Exports
// ===========================================

export { billogAgent };
export { UPLOADS_DIR, BASE_URL };
export * from './tools/index.js';
export { createGateway, GatewayRouter } from './gateway/index.js';
export type { GatewayConfig, InboundMessage, OutboundResponse, AgentContext } from './gateway/index.js';
export { messageWorkflow, dmWorkflow, groupWorkflow, shouldUseWorkflow } from './workflows/index.js';
export type { MessageInput, MessageOutput, MessageWorkflowState, ParsedExpense } from './workflows/index.js';
