import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getApiContext, apiRequest, formatAmount } from './c6e0983a-3be3-4b60-875a-a96a14c18c25.mjs';
import 'jsonwebtoken';

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
- "settled with tom"

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
    // Context (optional - auto-injected)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    remainingBalance: z.number().optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    const fromChannelId = input.fromTarget === "me" ? context.senderChannelId : input.fromTarget;
    const toChannelId = input.toTarget === "me" ? context.senderChannelId : input.toTarget;
    try {
      const response = await apiRequest("POST", "/settlements", context, {
        channel: context.channel,
        sourceChannelId: context.sourceChannelId,
        senderChannelId: context.senderChannelId,
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
