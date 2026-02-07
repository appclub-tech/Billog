/**
 * Workflow Schemas
 *
 * Shared schemas for workflow state, input, and output.
 * These define the data structures that flow through the workflow.
 */

import { z } from 'zod';

// ============================================
// Channel Types
// ============================================

export const ChannelSchema = z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']);
export type Channel = z.infer<typeof ChannelSchema>;

export const LanguageSchema = z.enum(['th', 'en']);
export type Language = z.infer<typeof LanguageSchema>;

// ============================================
// Message Workflow Input
// ============================================

export const MessageInputSchema = z.object({
  // Channel context
  channel: ChannelSchema,
  senderChannelId: z.string(),
  sourceChannelId: z.string(),
  isGroup: z.boolean(),
  senderName: z.string().optional(),
  sourceName: z.string().optional(),

  // User preferences
  userLanguage: LanguageSchema.default('th'),
  userCurrency: z.string().default('THB'),
  userTimezone: z.string().default('Asia/Bangkok'),

  // Message content
  messageText: z.string().optional(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),

  // Quote context (for expense lookup)
  quotedMessageId: z.string().optional(),
  quotedMessageText: z.string().optional(),
});

export type MessageInput = z.infer<typeof MessageInputSchema>;

// ============================================
// Parsed Expense Data
// ============================================

export const ParsedExpenseItemSchema = z.object({
  name: z.string(),
  nameLocalized: z.string().nullable(),
  quantity: z.number().default(1),
  unitPrice: z.number(),
  ingredientType: z.string().nullable().optional(),
  assignedTo: z.string().optional(), // For item-based splits
});

export type ParsedExpenseItem = z.infer<typeof ParsedExpenseItemSchema>;

export const ParsedExpenseSchema = z.object({
  description: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().default('THB'),
  category: z.string().nullable(),
  date: z.string().nullable(), // YYYY-MM-DD

  // Split info (group only)
  splitType: z.enum(['equal', 'exact', 'percentage', 'item']).nullable(),
  splitTargets: z.array(z.string()).default([]), // @all, @name

  // Items (from receipt OCR)
  items: z.array(ParsedExpenseItemSchema).default([]),

  // Payment info (from receipt OCR)
  payment: z.object({
    method: z.string().nullable(),
    cardType: z.string().nullable(),
    cardLast4: z.string().nullable(),
    bankName: z.string().nullable(),
  }).nullable().optional(),

  // Metadata
  metadata: z.record(z.unknown()).optional(),
});

export type ParsedExpense = z.infer<typeof ParsedExpenseSchema>;

// ============================================
// Workflow State
// ============================================

export const MessageWorkflowStateSchema = z.object({
  // Source initialization
  sourceInitialized: z.boolean().default(false),
  isNewSource: z.boolean().default(false),
  isNewUser: z.boolean().default(false),

  // Message type detection (nullable with default)
  messageType: z.enum(['expense_text', 'expense_receipt', 'query', 'settlement', 'help', 'other']).nullable().default(null),

  // Parsed expense (accumulated from parse/OCR steps)
  parsedExpense: ParsedExpenseSchema.nullable().default(null),

  // OCR specific
  isReceipt: z.boolean().default(false),

  // Validation
  isValid: z.boolean().default(false),
  missingFields: z.array(z.string()).default([]),

  // Group-specific
  groupMembers: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable(),
  })).default([]),

  // Result (nullable with default)
  expenseId: z.string().nullable().default(null),
  responseMessage: z.string().nullable().default(null),

  // Error handling (nullable with default)
  error: z.string().nullable().default(null),
});

export type MessageWorkflowState = z.infer<typeof MessageWorkflowStateSchema>;

// Initial state
export const initialMessageWorkflowState: MessageWorkflowState = {
  sourceInitialized: false,
  isNewSource: false,
  isNewUser: false,
  messageType: null,
  parsedExpense: null,
  isReceipt: false,
  isValid: false,
  missingFields: [],
  groupMembers: [],
  expenseId: null,
  responseMessage: null,
  error: null,
};

// ============================================
// Workflow Output
// ============================================

export const MessageOutputSchema = z.object({
  success: z.boolean(),
  status: z.enum(['completed', 'suspended', 'failed', 'fallback']),
  message: z.string(),
  expenseId: z.string().optional(),

  // For suspend/resume
  suspendReason: z.string().optional(),
  missingFields: z.array(z.string()).optional(),

  // For fallback (agent handling)
  fallbackReason: z.string().optional(),
});

export type MessageOutput = z.infer<typeof MessageOutputSchema>;

// ============================================
// Resume Schemas
// ============================================

export const ExpenseResumeSchema = z.object({
  description: z.string().optional(),
  amount: z.number().optional(),
  splitTargets: z.array(z.string()).optional(),
});

export type ExpenseResume = z.infer<typeof ExpenseResumeSchema>;

// ============================================
// API Context
// ============================================

export interface ApiContext {
  channel: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
  senderChannelId: string;
  sourceChannelId: string;
  sourceType: 'GROUP' | 'DM';
}

export function buildApiContext(input: MessageInput): ApiContext {
  return {
    channel: input.channel,
    senderChannelId: input.senderChannelId,
    sourceChannelId: input.sourceChannelId,
    sourceType: input.isGroup ? 'GROUP' : 'DM',
  };
}
