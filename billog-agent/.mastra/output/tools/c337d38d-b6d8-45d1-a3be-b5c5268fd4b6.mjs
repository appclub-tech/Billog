import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, formatAmount } from './68251daa-bc82-4965-8592-33499397cad4.mjs';

const PAYMENT_METHODS = {
  1: "Cash",
  2: "Bank Transfer",
  3: "PromptPay",
  4: "Credit Card",
  5: "E-Wallet",
  99: "Other"
};
const recordSettlementTool = createTool({
  id: "record-settlement",
  description: `Record a payment/settlement between users. Use when:
- "tom paid me 350"
- "paid jerry 200 via promptpay"
- "received 500 from wife"
- "@tom \u0E08\u0E48\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27 350"

Direction:
- "X paid me" \u2192 from=X, to=me (I received)
- "I paid X" \u2192 from=me, to=X (I gave)
- "X paid Y" \u2192 from=X, to=Y (third-party)`,
  inputSchema: z.object({
    fromTarget: z.string().describe('Who paid: @nickname, channel ID, or "me"'),
    toTarget: z.string().describe('Who received: @nickname, channel ID, or "me"'),
    amount: z.number().min(0).describe("Amount paid"),
    currency: z.string().default("THB").describe("Currency code"),
    paymentMethod: z.number().optional().describe("Payment method: 1=Cash, 2=Bank, 3=PromptPay, 4=Card, 5=E-Wallet"),
    // Context
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe('User channel ID (used for "me")'),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    remainingBalance: z.number().optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    const fromChannelId = input.fromTarget === "me" ? input.senderChannelId : input.fromTarget;
    const toChannelId = input.toTarget === "me" ? input.senderChannelId : input.toTarget;
    try {
      const response = await apiRequest("POST", "/settlements", context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        senderChannelId: input.senderChannelId,
        fromChannelId,
        toChannelId,
        amount: input.amount,
        currency: input.currency,
        paymentMethod: input.paymentMethod
      });
      const { settlement, remainingBalance } = response;
      const methodName = input.paymentMethod ? PAYMENT_METHODS[input.paymentMethod] || "Other" : null;
      let message = `\u2705 Settlement recorded
`;
      message += `@${settlement.from.name} paid @${settlement.to.name} ${formatAmount(settlement.amount, settlement.currency)}`;
      if (methodName) {
        message += ` via ${methodName}`;
      }
      message += "\n";
      if (remainingBalance === 0) {
        message += `Remaining: ${formatAmount(0, settlement.currency)} \u2713 All settled!`;
      } else if (remainingBalance > 0) {
        message += `Remaining: ${formatAmount(remainingBalance, settlement.currency)} still owed`;
      } else {
        message += `Remaining: ${formatAmount(Math.abs(remainingBalance), settlement.currency)} overpaid (credit)`;
      }
      return {
        success: true,
        message,
        remainingBalance
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to record settlement: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

export { recordSettlementTool };
