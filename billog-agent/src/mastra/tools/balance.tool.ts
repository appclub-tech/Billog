import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, formatAmount, getApiContext } from './api-client.js';

/**
 * Get Group Balances Tool
 * Shows who owes whom in a group
 */
export const getBalancesTool = createTool({
  id: 'get-balances',
  description: `Get group balances showing who owes whom. Use when user asks:
- "who owes what"
- "show balances"
- "check debts"
- "what do I owe"`,
  inputSchema: z.object({
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
    currency: z.string().default('THB').describe('Currency to show balances in'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    balances: z.array(z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number(),
    })).optional(),
    members: z.array(z.object({
      name: z.string(),
      net: z.number(),
    })).optional(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    try {
      const params = new URLSearchParams();
      params.set('channel', context.channel);
      params.set('sourceChannelId', context.sourceChannelId);
      params.set('currency', input.currency ?? 'THB');

      const response = await apiRequest<{
        balances: Array<{
          from: { userId: string; name: string };
          to: { userId: string; name: string };
          amount: number;
          currency: string;
        }>;
        members: Array<{
          userId: string;
          name: string;
          nickname: string | null;
          net: number;
        }>;
      }>('GET', `/balances?${params}`, context);

      if (response.balances.length === 0) {
        return {
          success: true,
          message: '✅ No outstanding balances - everyone is settled!',
          balances: [],
          members: [],
        };
      }

      // Format balances message
      let message = `💰 Group Balances (${input.currency})\n`;
      message += `─────────────────\n`;

      for (const balance of response.balances) {
        message += `@${balance.from.name} owes @${balance.to.name} ${formatAmount(balance.amount, balance.currency)}\n`;
      }

      message += `─────────────────\n`;
      message += `Net: `;
      message += response.members
        .map(m => `${m.nickname || m.name} ${m.net >= 0 ? '+' : ''}${formatAmount(m.net, input.currency)}`)
        .join(' | ');

      return {
        success: true,
        message,
        balances: response.balances.map(b => ({
          from: b.from.name,
          to: b.to.name,
          amount: b.amount,
        })),
        members: response.members.map(m => ({
          name: m.nickname || m.name,
          net: m.net,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});

/**
 * Get Spending Summary Tool
 * Shows spending breakdown by category and payer
 */
export const getSpendingSummaryTool = createTool({
  id: 'get-spending-summary',
  description: `Get spending summary for a period. Use when user asks:
- "how much did we spend this month"
- "spending summary"
- "what did tom spend"
- "show expenses by category"`,
  inputSchema: z.object({
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
    period: z.enum(['day', 'week', 'month', 'year']).default('month').describe('Time period'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    summary: z.object({
      total: z.number(),
      count: z.number(),
      byCategory: z.record(z.number()),
      byPayer: z.array(z.object({
        name: z.string(),
        total: z.number(),
      })),
    }).optional(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    try {
      const period = input.period ?? 'month';
      const params = new URLSearchParams();
      params.set('channel', context.channel);
      params.set('sourceChannelId', context.sourceChannelId);
      params.set('period', period);

      const response = await apiRequest<{
        period: string;
        startDate: string;
        endDate: string;
        total: number;
        count: number;
        currency: string;
        byCategory: Record<string, number>;
        byPayer: Array<{ userId: string; name: string; total: number }>;
      }>('GET', `/insights/summary?${params}`, context);

      if (response.count === 0) {
        return {
          success: true,
          message: `📊 No spending recorded for this ${period}.`,
        };
      }

      // Format period label
      const periodLabels: Record<string, string> = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        year: "This Year's",
      };

      let message = `📊 ${periodLabels[period]} Spending\n`;
      message += `─────────────────\n`;
      message += `Total: ${formatAmount(response.total, response.currency)} (${response.count} expenses)\n\n`;

      // By category
      if (Object.keys(response.byCategory).length > 0) {
        message += `By Category:\n`;
        const sortedCategories = Object.entries(response.byCategory)
          .sort(([, a], [, b]) => b - a);

        for (const [category, amount] of sortedCategories) {
          const percentage = Math.round((amount / response.total) * 100);
          message += `• ${category}: ${formatAmount(amount, response.currency)} (${percentage}%)\n`;
        }
      }

      // By payer
      if (response.byPayer.length > 0) {
        message += `\nBy Payer:\n`;
        for (const payer of response.byPayer) {
          message += `• ${payer.name}: ${formatAmount(payer.total, response.currency)}\n`;
        }
      }

      return {
        success: true,
        message,
        summary: {
          total: response.total,
          count: response.count,
          byCategory: response.byCategory,
          byPayer: response.byPayer.map(p => ({ name: p.name, total: p.total })),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});

/**
 * Get My Balance Tool
 * Shows current user's personal balance
 */
export const getMyBalanceTool = createTool({
  id: 'get-my-balance',
  description: `Get user's personal balance across all sources. Use when user asks:
- "my balance"
- "what do I owe"
- "how much do I owe"`,
  inputSchema: z.object({
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    try {
      const response = await apiRequest<{
        user: { id: string; name: string };
        sources: Array<{
          id: string;
          name: string;
          net: number;
          currency: string;
        }>;
      }>('GET', '/users/me', context);

      if (response.sources.length === 0) {
        return {
          success: true,
          message: `💰 @${response.user.name} - No active sources yet.`,
        };
      }

      let message = `💰 @${response.user.name}'s Balance\n`;
      message += `─────────────────\n`;

      for (const source of response.sources) {
        const status = source.net >= 0 ? 'owed to you' : 'you owe';
        message += `• ${source.name}: ${formatAmount(Math.abs(source.net), source.currency)} ${status}\n`;
      }

      // Calculate total
      const totalsByCurrency = response.sources.reduce((acc, s) => {
        acc[s.currency] = (acc[s.currency] || 0) + s.net;
        return acc;
      }, {} as Record<string, number>);

      message += `─────────────────\n`;
      message += `Net: `;
      message += Object.entries(totalsByCurrency)
        .map(([currency, net]) => `${net >= 0 ? '+' : ''}${formatAmount(net, currency)}`)
        .join(', ');

      return {
        success: true,
        message,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to get balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
