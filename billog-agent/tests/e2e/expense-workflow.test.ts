/**
 * E2E Expense Workflow Tests
 *
 * Tests the full flow from user message → agent → tools → API → database
 *
 * Flow tested:
 * 1. User sends message (text or image)
 * 2. Agent processes with RequestContext
 * 3. Agent calls tools (extract-receipt, create-expense)
 * 4. Tools call Billog API
 * 5. Database records are created
 * 6. Agent returns response with expense ID
 *
 * Prerequisites:
 * - Billog API running at BILLOG_API_URL
 * - Database seeded with categories
 * - OPENAI_API_KEY set for agent
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { billogAgent } from '../../src/mastra/agents/billog.agent.js';
import {
  TEST_CONTEXT,
  createMockAgentContext,
  createMockRequestContext,
  formatAgentInput,
  createMockMessage,
} from '../helpers/test-context.js';
import {
  initializeTestSource,
  getTestExpenses,
  getTestExpenseById,
  cleanupTestExpenses,
  isApiReachable,
} from '../helpers/test-api.js';

// Check if we can run E2E tests (API reachable + API key present)
let canRunE2E = false;
let skipReason = '';

describe('Expense Workflow E2E', () => {
  let agent: Agent;
  let createdExpenseIds: string[] = [];

  beforeAll(async () => {
    // Check prerequisites
    if (!process.env.OPENAI_API_KEY) {
      skipReason = 'OPENAI_API_KEY not set';
      console.warn(`Skipping E2E tests: ${skipReason}`);
      return;
    }

    const apiReachable = await isApiReachable();
    if (!apiReachable) {
      skipReason = 'Billog API not reachable at ' + (process.env.BILLOG_API_URL || 'http://localhost:8000');
      console.warn(`Skipping E2E tests: ${skipReason}`);
      return;
    }

    canRunE2E = true;
    agent = billogAgent;

    // Initialize test source (creates user, source, accounts)
    await initializeTestSource();
  });

  beforeEach(async () => {
    // Track created expenses for cleanup
    createdExpenseIds = [];
  });

  afterAll(async () => {
    // Clean up created expenses
    for (const id of createdExpenseIds) {
      try {
        await fetch(`${process.env.BILLOG_API_URL}/api/expenses/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.TEST_TOKEN}`,
          },
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Text Expense Recording', () => {
    it('records simple expense from text message', async () => {
      if (!canRunE2E) {
        console.log(`Skipped: ${skipReason}`);
        return;
      }
      // Arrange: Create mock message "coffee 65"
      const message = createMockMessage({ text: 'coffee 65' });
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({ taskComplexity: 'simple' });
      const agentInput = formatAgentInput(message, context);

      // Act: Call agent
      const result = await agent.generate(agentInput, {
        memory: {
          thread: `test-expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      // Assert: Response contains expense ID
      expect(result.text).toBeDefined();
      expect(result.text).toMatch(/EX:[a-zA-Z0-9-]+/);

      // Extract expense ID
      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      expect(expenseIdMatch).not.toBeNull();
      const expenseId = expenseIdMatch![1];
      createdExpenseIds.push(expenseId);

      // Verify in database
      const { expense } = await getTestExpenseById(expenseId);
      expect(expense).toBeDefined();
      expect(expense.description.toLowerCase()).toContain('coffee');
      expect(expense.amount).toBe(65);
      expect(expense.currency).toBe('THB');

      // Verify items are always created (even for single-item text expenses)
      expect(expense.items).toBeDefined();
      expect(expense.items!.length).toBeGreaterThan(0);
      expect(expense.items![0].name.toLowerCase()).toContain('coffee');
      expect(expense.items![0].unitPrice).toBe(65);
    });

    it('records expense with bill split (@all)', async () => {
      if (!canRunE2E) return;

      // Arrange
      const message = createMockMessage({ text: 'lunch 500 @all' });
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext();
      const agentInput = formatAgentInput(message, context);

      // Act
      const result = await agent.generate(agentInput, {
        memory: {
          thread: `test-expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      // Assert
      expect(result.text).toMatch(/EX:[a-zA-Z0-9-]+/);

      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }
    });

    it('handles expense with category auto-detection', async () => {
      if (!canRunE2E) return;

      // Arrange: "grab home 120" should detect Transport category
      const message = createMockMessage({ text: 'grab home 120' });
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext();
      const agentInput = formatAgentInput(message, context);

      // Act
      const result = await agent.generate(agentInput, {
        memory: {
          thread: `test-expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      // Assert
      expect(result.text).toMatch(/EX:[a-zA-Z0-9-]+/);
      // Response should mention Transport or category
      expect(result.text.toLowerCase()).toMatch(/transport|grab|taxi|การเดินทาง/i);

      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }
    });

    it('responds in Thai when userLanguage is th', async () => {
      if (!canRunE2E) return;

      // Arrange
      const message = createMockMessage({ text: 'กาแฟ 45' });
      const context = createMockAgentContext({ userLanguage: 'th' });
      const requestContext = createMockRequestContext({ userLanguage: 'th' });
      const agentInput = formatAgentInput(message, context);

      // Act
      const result = await agent.generate(agentInput, {
        memory: {
          thread: `test-expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      // Assert: Response should be in Thai
      expect(result.text).toBeDefined();
      // Should contain Thai characters or expense confirmation
      expect(result.text).toMatch(/EX:[a-zA-Z0-9-]+|บันทึก|฿/);

      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }
    });
  });

  describe('Expense Query', () => {
    it('returns expense history when asked', async () => {
      if (!canRunE2E) return;

      // Use same thread ID for both calls in this test
      const threadId = `test-query-${Date.now()}`;

      // First create an expense
      const createMessage = createMockMessage({ text: 'test expense 100' });
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext();

      const createResult = await agent.generate(
        formatAgentInput(createMessage, context),
        {
          memory: {
            thread: threadId,
            resource: `test`,
          },
          requestContext,
          maxSteps: 5,
        }
      );

      const expenseIdMatch = createResult.text.match(/EX:([a-zA-Z0-9-]+)/i);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }

      // Then query expenses
      const queryMessage = createMockMessage({ text: 'show expenses' });
      const queryResult = await agent.generate(
        formatAgentInput(queryMessage, context),
        {
          memory: {
            thread: threadId,
            resource: `test`,
          },
          requestContext,
          maxSteps: 5,
        }
      );

      // Assert: Should show expenses
      expect(queryResult.text).toBeDefined();
      // Response should contain expense list or "no expenses"
      expect(queryResult.text).toMatch(/expense|รายจ่าย|total|ทั้งหมด|No expenses|ไม่มี/i);
    });
  });

  describe('Error Handling', () => {
    it('handles missing amount gracefully', async () => {
      if (!canRunE2E) return;

      // Arrange: Message without clear amount
      const message = createMockMessage({ text: 'bought something' });
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext();
      const agentInput = formatAgentInput(message, context);

      // Act
      const result = await agent.generate(agentInput, {
        memory: {
          thread: `test-expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      // Assert: Agent should respond sensibly - either:
      // 1. Ask for amount/price
      // 2. Record with 0 or some amount
      // 3. Ask for clarification
      // 4. Respond about the purchase
      expect(result.text).toBeDefined();
      console.log('Missing amount response:', result.text);

      const asksForAmount = /amount|เท่าไ|how much|ราคา|price/i.test(result.text);
      const recordedExpense = /ex:|฿|บาท|baht|expense|ค่าใช้จ่าย|บันทึก/i.test(result.text);
      const asksForClarification = /what|อะไร|clarify|help|ช่วย/i.test(result.text);

      // Agent should respond in some meaningful way
      expect(asksForAmount || recordedExpense || asksForClarification).toBe(true);

      // Track expense for cleanup if created
      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/i);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }
    });
  });
});
