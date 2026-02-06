import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, formatAmount, getApiContext } from './api-client.js';

/**
 * Adjustment types for expense reconciliation
 */
const adjustmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reassign_item'),
    itemId: z.string().describe('ID of item to reassign'),
    assignedTo: z.string().describe('New assignee: @nickname or channel ID'),
  }),
  z.object({
    type: z.literal('update_item'),
    itemId: z.string().describe('ID of item to update'),
    quantity: z.number().optional().describe('New quantity'),
    unitPrice: z.number().optional().describe('New unit price'),
    name: z.string().optional().describe('New item name'),
  }),
  z.object({
    type: z.literal('add_item'),
    name: z.string().describe('Item name'),
    quantity: z.number().default(1).describe('Quantity'),
    unitPrice: z.number().describe('Unit price'),
    assignedTo: z.string().optional().describe('Assignee: @nickname or null for split'),
  }),
  z.object({
    type: z.literal('remove_item'),
    itemId: z.string().describe('ID of item to remove'),
  }),
  z.object({
    type: z.literal('remove_from_split'),
    target: z.string().describe('Person to remove: @nickname or channel ID'),
  }),
  z.object({
    type: z.literal('add_to_split'),
    target: z.string().describe('Person to add: @nickname or channel ID'),
  }),
  z.object({
    type: z.literal('update_amount'),
    amount: z.number().describe('New total amount'),
  }),
  z.object({
    type: z.literal('update_category'),
    categoryId: z.string().describe('New category ID'),
  }),
  z.object({
    type: z.literal('update_description'),
    description: z.string().describe('New description'),
  }),
]);

/**
 * Response types
 */
interface ReconcileResponse {
  expense: {
    id: string;
    description: string;
    amount: number;
    currency: string;
    items?: Array<{
      id: string;
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      assignedTo?: string;
    }>;
  };
  adjustments: Array<{
    userId: string;
    name: string;
    oldAmount: number;
    newAmount: number;
    delta: number;
  }>;
  transfers: Array<{
    id: string;
    type: string;
    from: string;
    to: string;
    amount: number;
  }>;
}

/**
 * Reconcile Expense Tool
 * Adjust an existing expense - reassign items, update prices, add/remove items
 */
export const reconcileExpenseTool = createTool({
  id: 'reconcile-expense',
  description: `Adjust/correct an existing expense. Use when user:
- Quotes an expense (EX:xxx) and wants to modify it
- Wants to reassign items to different people
- Needs to correct prices or quantities
- Wants to add or remove items
- Needs to remove/add someone from a split

Extract expense ID from quoted message (EX:xxx format).`,
  inputSchema: z.object({
    expenseId: z.string().describe('Expense ID (from EX:xxx in quoted message)'),
    adjustments: z.array(adjustmentSchema).describe('List of adjustments to make'),
    reason: z.string().optional().describe('Reason for adjustment'),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    expense: z.object({
      id: z.string(),
      description: z.string(),
      amount: z.number(),
      currency: z.string(),
    }).optional(),
    adjustments: z.array(z.object({
      name: z.string(),
      delta: z.number(),
    })).optional(),
  }),
  execute: async (input, ctx) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TOOL] 🔧 reconcile-expense CALLED`);
    console.log(`[TOOL] Expense ID: ${input.expenseId}`);
    console.log(`[TOOL] Adjustments: ${JSON.stringify(input.adjustments)}`);
    console.log(`${'='.repeat(60)}\n`);

    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    try {
      const response = await apiRequest<ReconcileResponse>(
        'POST',
        `/expenses/${input.expenseId}/reconcile`,
        context,
        {
          adjustments: input.adjustments,
          reason: input.reason,
        }
      );

      // Format success message
      const { expense, adjustments } = response;
      const formattedAmount = formatAmount(expense.amount, expense.currency);

      let message = `Updated ${expense.description} (EX:${expense.id})`;

      // Show what changed based on adjustment types
      for (const adj of input.adjustments) {
        switch (adj.type) {
          case 'reassign_item':
            message += `\n- Item reassigned to ${adj.assignedTo}`;
            break;
          case 'update_item':
            message += `\n- Item updated`;
            break;
          case 'add_item':
            message += `\n- Added: ${adj.name} ${formatAmount(adj.unitPrice * (adj.quantity || 1), expense.currency)}`;
            break;
          case 'remove_item':
            message += `\n- Item removed`;
            break;
          case 'remove_from_split':
            message += `\n- Removed ${adj.target} from split`;
            break;
          case 'add_to_split':
            message += `\n- Added ${adj.target} to split`;
            break;
          case 'update_amount':
            message += `\n- Amount updated to ${formatAmount(adj.amount, expense.currency)}`;
            break;
          case 'update_category':
            message += `\n- Category updated`;
            break;
          case 'update_description':
            message += `\n- Description: ${adj.description}`;
            break;
        }
      }

      message += `\nNew total: ${formattedAmount}`;

      // Show adjustments per person
      if (adjustments.length > 0) {
        message += '\n\nAdjustments:';
        for (const adj of adjustments) {
          const sign = adj.delta >= 0 ? '+' : '';
          message += `\n- ${adj.name}: ${sign}${formatAmount(adj.delta, expense.currency)}`;
        }
      }

      return {
        success: true,
        message,
        expense: {
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
        },
        adjustments: adjustments.map(a => ({
          name: a.name,
          delta: a.delta,
        })),
      };
    } catch (error) {
      console.error('[TOOL] reconcile-expense ERROR:', error);
      return {
        success: false,
        message: `Error: Failed to reconcile expense: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
