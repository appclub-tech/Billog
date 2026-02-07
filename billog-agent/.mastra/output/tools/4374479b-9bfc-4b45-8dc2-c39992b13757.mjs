import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getApiContext, apiRequest, formatAmount } from './5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import 'jsonwebtoken';

const getBalancesTool = createTool({
  id: "get-balances",
  description: `Get group balances showing who owes whom. Use when user asks:
- "who owes what"
- "show balances"
- "check debts"
- "what do I owe"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)"),
    currency: z.string().default("THB").describe("Currency to show balances in")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    balances: z.array(z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number()
    })).optional(),
    members: z.array(z.object({
      name: z.string(),
      net: z.number()
    })).optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const params = new URLSearchParams();
      params.set("channel", context.channel);
      params.set("sourceChannelId", context.sourceChannelId);
      params.set("currency", input.currency ?? "THB");
      const response = await apiRequest("GET", `/balances?${params}`, context);
      if (response.balances.length === 0) {
        return {
          success: true,
          message: "\u2705 No outstanding balances - everyone is settled!",
          balances: [],
          members: []
        };
      }
      let message = `\u{1F4B0} Group Balances (${input.currency})
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const balance of response.balances) {
        message += `@${balance.from.name} owes @${balance.to.name} ${formatAmount(balance.amount, balance.currency)}
`;
      }
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += response.members.map((m) => `${m.nickname || m.name} ${m.net >= 0 ? "+" : ""}${formatAmount(m.net, input.currency)}`).join(" | ");
      return {
        success: true,
        message,
        balances: response.balances.map((b) => ({
          from: b.from.name,
          to: b.to.name,
          amount: b.amount
        })),
        members: response.members.map((m) => ({
          name: m.nickname || m.name,
          net: m.net
        }))
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balances: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getSpendingSummaryTool = createTool({
  id: "get-spending-summary",
  description: `Get spending summary for a period. Use when user asks:
- "how much did we spend this month"
- "spending summary"
- "what did tom spend"
- "show expenses by category"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)"),
    period: z.enum(["day", "week", "month", "year"]).default("month").describe("Time period")
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
        total: z.number()
      }))
    }).optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const period = input.period ?? "month";
      const params = new URLSearchParams();
      params.set("channel", context.channel);
      params.set("sourceChannelId", context.sourceChannelId);
      params.set("period", period);
      const response = await apiRequest("GET", `/insights/summary?${params}`, context);
      if (response.count === 0) {
        return {
          success: true,
          message: `\u{1F4CA} No spending recorded for this ${period}.`
        };
      }
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        year: "This Year's"
      };
      let message = `\u{1F4CA} ${periodLabels[period]} Spending
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Total: ${formatAmount(response.total, response.currency)} (${response.count} expenses)

`;
      if (Object.keys(response.byCategory).length > 0) {
        message += `By Category:
`;
        const sortedCategories = Object.entries(response.byCategory).sort(([, a], [, b]) => b - a);
        for (const [category, amount] of sortedCategories) {
          const percentage = Math.round(amount / response.total * 100);
          message += `\u2022 ${category}: ${formatAmount(amount, response.currency)} (${percentage}%)
`;
        }
      }
      if (response.byPayer.length > 0) {
        message += `
By Payer:
`;
        for (const payer of response.byPayer) {
          message += `\u2022 ${payer.name}: ${formatAmount(payer.total, response.currency)}
`;
        }
      }
      return {
        success: true,
        message,
        summary: {
          total: response.total,
          count: response.count,
          byCategory: response.byCategory,
          byPayer: response.byPayer.map((p) => ({ name: p.name, total: p.total }))
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get summary: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getMyBalanceTool = createTool({
  id: "get-my-balance",
  description: `Get user's personal balance across all sources. Use when user asks:
- "my balance"
- "what do I owe"
- "how much do I owe"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const response = await apiRequest("GET", "/users/me", context);
      if (response.sources.length === 0) {
        return {
          success: true,
          message: `\u{1F4B0} @${response.user.name} - No active sources yet.`
        };
      }
      let message = `\u{1F4B0} @${response.user.name}'s Balance
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const source of response.sources) {
        const status = source.net >= 0 ? "owed to you" : "you owe";
        message += `\u2022 ${source.name}: ${formatAmount(Math.abs(source.net), source.currency)} ${status}
`;
      }
      const totalsByCurrency = response.sources.reduce((acc, s) => {
        acc[s.currency] = (acc[s.currency] || 0) + s.net;
        return acc;
      }, {});
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += Object.entries(totalsByCurrency).map(([currency, net]) => `${net >= 0 ? "+" : ""}${formatAmount(net, currency)}`).join(", ");
      return {
        success: true,
        message
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

export { getBalancesTool, getMyBalanceTool, getSpendingSummaryTool };
