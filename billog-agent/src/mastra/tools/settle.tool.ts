import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, formatAmount, getApiContext } from './api-client.js';

/**
 * Payment method codes
 */
const PAYMENT_METHODS = {
  1: 'Cash',
  2: 'Bank Transfer',
  3: 'PromptPay',
  4: 'Credit Card',
  5: 'E-Wallet',
  99: 'Other',
} as const;

/**
 * Record Settlement Tool
 * Records a payment between users to settle debts
 */
export const recordSettlementTool = createTool({
  id: 'record-settlement',
  description: `Record a payment/settlement between users. Use when:
- "tom paid me 350"
- "paid jerry 200 via promptpay"
- "received 500 from wife"
- "settled with tom"

Direction:
- "X paid me" → from=X, to=me (I received)
- "I paid X" → from=me, to=X (I gave)
- "X paid Y" → from=X, to=Y (third-party)`,
  inputSchema: z.object({
    fromTarget: z.string().describe('Who paid: @nickname, channel ID, or "me"'),
    toTarget: z.string().describe('Who received: @nickname, channel ID, or "me"'),
    amount: z.number().min(0).describe('Amount paid'),
    currency: z.string().default('THB').describe('Currency code'),
    paymentMethod: z.number().optional().describe('Payment method: 1=Cash, 2=Bank, 3=PromptPay, 4=Card, 5=E-Wallet'),
    // Context (optional - auto-injected)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    remainingBalance: z.number().optional(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    // Resolve "me" to sender channel ID
    const fromChannelId = input.fromTarget === 'me' ? context.senderChannelId : input.fromTarget;
    const toChannelId = input.toTarget === 'me' ? context.senderChannelId : input.toTarget;

    try {
      const response = await apiRequest<{
        settlement: {
          id: string;
          amount: number;
          currency: string;
          from: { userId: string; name: string };
          to: { userId: string; name: string };
          paymentMethod: number;
        };
        remainingBalance: number;
      }>('POST', '/settlements', context, {
        channel: context.channel,
        sourceChannelId: context.sourceChannelId,
        senderChannelId: context.senderChannelId,
        fromChannelId,
        toChannelId,
        amount: input.amount,
        currency: input.currency,
        paymentMethod: input.paymentMethod,
      });

      const { settlement, remainingBalance } = response;
      const methodName = input.paymentMethod
        ? PAYMENT_METHODS[input.paymentMethod as keyof typeof PAYMENT_METHODS] || 'Other'
        : null;

      let message = `✅ Settlement recorded\n`;
      message += `@${settlement.from.name} paid @${settlement.to.name} ${formatAmount(settlement.amount, settlement.currency)}`;

      if (methodName) {
        message += ` via ${methodName}`;
      }

      message += '\n';

      if (remainingBalance === 0) {
        message += `Remaining: ${formatAmount(0, settlement.currency)} ✓ All settled!`;
      } else if (remainingBalance > 0) {
        message += `Remaining: ${formatAmount(remainingBalance, settlement.currency)} still owed`;
      } else {
        message += `Remaining: ${formatAmount(Math.abs(remainingBalance), settlement.currency)} overpaid (credit)`;
      }

      return {
        success: true,
        message,
        remainingBalance,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to record settlement: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
