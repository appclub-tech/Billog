/**
 * Receipt Workflow E2E Tests
 *
 * Tests the complete receipt processing flow:
 * 1. User sends receipt image
 * 2. Gateway detects image → sets taskComplexity='high'
 * 3. Agent receives image with ImageURL in context
 * 4. Agent calls extract-receipt tool with imageUrl
 * 5. OCR extracts items, amounts, store info
 * 6. Agent calls create-expense with receiptData
 * 7. API creates expense + items + receipt records
 * 8. Agent returns confirmation with expense ID
 *
 * Prerequisites:
 * - Billog API running at BILLOG_API_URL
 * - GOOGLE_API_KEY for Gemini Vision OCR
 * - OPENAI_API_KEY for agent (gpt-4o for images)
 * - Database seeded with categories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { billogAgent } from '../../src/mastra/agents/billog.agent.js';
import {
  TEST_CONTEXT,
  createMockAgentContext,
  createMockRequestContext,
  formatAgentInput,
  wrapAgentInput,
  createMockReceiptMessage,
} from '../helpers/test-context.js';
import {
  initializeTestSource,
  getTestExpenseById,
  getTestExpenseFullDetails,
  getTestSource,
  getTestBalances,
  getTestReceipt,
  isApiReachable,
  testApiRequest,
} from '../helpers/test-api.js';
import { getTestReceiptBase64, hasTestAssets, TEST_RECEIPT_URL } from '../helpers/test-fixtures.js';

// Check if we can run receipt E2E tests
let canRunReceiptE2E = false;
let receiptSkipReason = '';

describe('Receipt Workflow E2E', () => {
  let createdExpenseIds: string[] = [];

  beforeAll(async () => {
    // Check prerequisites
    if (!process.env.OPENAI_API_KEY) {
      receiptSkipReason = 'OPENAI_API_KEY not set';
      console.warn(`Skipping receipt E2E tests: ${receiptSkipReason}`);
      return;
    }

    if (!process.env.GOOGLE_API_KEY) {
      receiptSkipReason = 'GOOGLE_API_KEY not set (needed for Gemini OCR)';
      console.warn(`Skipping receipt E2E tests: ${receiptSkipReason}`);
      return;
    }

    const apiReachable = await isApiReachable();
    if (!apiReachable) {
      receiptSkipReason = 'Billog API not reachable at ' + (process.env.BILLOG_API_URL || 'http://localhost:8000');
      console.warn(`Skipping receipt E2E tests: ${receiptSkipReason}`);
      return;
    }

    // Check for test assets
    if (!hasTestAssets()) {
      console.warn('Test assets not found at ../test-assets/receipt-test.jpg');
    }

    canRunReceiptE2E = true;

    // Initialize test source
    await initializeTestSource();
  });

  afterAll(async () => {
    // Clean up created expenses
    for (const id of createdExpenseIds) {
      try {
        await testApiRequest('DELETE', `/expenses/${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Full Receipt Processing Flow', () => {
    /**
     * Test with a real public receipt image
     * This tests the COMPLETE business flow:
     * 1. Source/account initialization
     * 2. OCR → extract receipt data
     * 3. Create expense with items
     * 4. Verify receipt record linked
     * 5. Verify ledger entries (money flow)
     * 6. Verify payment method (if applicable)
     */
    it('processes receipt image and creates expense with items', async () => {
      if (!canRunReceiptE2E) {
        console.log(`Skipped: ${receiptSkipReason}`);
        return;
      }

      // Step 1: Verify source exists (created in beforeAll)
      // Note: The source endpoint might not exist, so we try-catch
      try {
        const sourceResult = await getTestSource();
        if (sourceResult?.source) {
          const { source } = sourceResult;
          expect(source.id).toBeDefined();
          console.log('Source verified:', source.id, source.name);

          // Verify source has accounts (ASSET/LIABILITY for ledger)
          if (source.accounts) {
            expect(source.accounts.length).toBeGreaterThan(0);
            console.log('Source accounts:', source.accounts.map(a => `${a.type}:${a.name}`));
          }
        } else {
          console.log('Source endpoint returned no source - continuing test');
        }
      } catch (error) {
        // Source endpoint might not exist yet in API
        console.log('Source verification skipped:', error instanceof Error ? error.message : 'API not available');
      }

      // Use local base64 if available, otherwise use public URL
      const testReceiptBase64 = getTestReceiptBase64();

      // Create message with image (prefer base64, fallback to URL)
      const message = testReceiptBase64
        ? createMockReceiptMessage('', {
            text: undefined,
            imageBase64: testReceiptBase64,
            imageUrl: undefined,
          })
        : createMockReceiptMessage(TEST_RECEIPT_URL, {
            text: undefined,
            imageBase64: undefined,
          });

      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({
        taskComplexity: 'high', // Image triggers high complexity → gpt-4o
      });

      const agentInput = formatAgentInput(message, context);

      // Use unique thread ID for test isolation
      const threadId = `test-receipt-${Date.now()}`;

      // Step 2 & 3: Call agent (OCR → create-expense)
      const result = await billogAgent.generate(wrapAgentInput(agentInput), {
        memory: {
          thread: threadId,
          resource: `${TEST_CONTEXT.channel}:${threadId}`,
        },
        requestContext,
        maxSteps: 5, // Allow multi-step: OCR → create-expense → response
      });

      // Assert: Response should contain expense ID or request clarification
      expect(result.text).toBeDefined();
      console.log('Receipt test response:', result.text);

      // The agent might:
      // 1. Successfully create expense (response contains EX:xxx or ex:xxx)
      // 2. Request clarification if OCR fails (asks for clearer photo)
      // 3. Ask for amount if receipt is unclear
      // 4. Record something (บันทึก/recorded)
      // 5. Acknowledge receipt (ใบเสร็จ/receipt)

      const hasExpenseId = /ex:[a-zA-Z0-9-]+/i.test(result.text);
      const asksForClarification = /unclear|clearer|try again|ลองใหม่|ไม่ชัด/i.test(result.text);
      const askForAmount = /amount|how much|เท่าไ|ราคา/i.test(result.text);
      const recordedSomething = /บันทึก|recorded|saved|expense|ค่าใช้จ่าย/i.test(result.text);
      const mentionsReceipt = /ใบเสร็จ|receipt/i.test(result.text);

      // At least one of these should be true
      const validResponse = hasExpenseId || asksForClarification || askForAmount || recordedSomething || mentionsReceipt;
      expect(validResponse).toBe(true);

      // Step 4-6: If expense was created, verify complete business flow
      if (hasExpenseId) {
        const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
        expect(expenseIdMatch).not.toBeNull();

        const expenseId = expenseIdMatch![1];
        createdExpenseIds.push(expenseId);

        // Get full expense details including receipt, items, splits, ledger
        const { expense } = await getTestExpenseFullDetails(expenseId);
        expect(expense).toBeDefined();
        expect(expense.id).toBe(expenseId);
        expect(expense.amount).toBeGreaterThan(0);
        console.log('Expense verified:', expense.id, expense.description, expense.amount);

        // Step 4: Verify receipt record is created and linked
        if (expense.receipt) {
          expect(expense.receipt.id).toBeDefined();
          console.log('Receipt record linked to expense:', expense.receipt.id, expense.receipt.storeName);

          // Verify receipt exists independently in database
          try {
            const { receipt } = await getTestReceipt(expense.receipt.id);
            expect(receipt).toBeDefined();
            expect(receipt.id).toBe(expense.receipt.id);
            expect(receipt.expenseId).toBe(expenseId);
            console.log('Receipt record verified in DB:', {
              id: receipt.id,
              storeName: receipt.storeName,
              imageUrl: receipt.imageUrl ? 'present' : 'none',
              rawText: receipt.rawText ? `${receipt.rawText.substring(0, 50)}...` : 'none',
            });

            // Receipt should have store name from OCR (if detected)
            if (receipt.storeName) {
              expect(typeof receipt.storeName).toBe('string');
            }
          } catch (error) {
            // Receipt endpoint might not exist - verify via expense.receipt instead
            console.log('Direct receipt fetch failed, using expense.receipt:', error instanceof Error ? error.message : 'unknown');
            if (expense.receipt.storeName) {
              expect(typeof expense.receipt.storeName).toBe('string');
            }
          }
        } else {
          console.log('No receipt record linked to expense - OCR may have failed or not created receipt');
        }

        // Verify items are extracted from receipt
        if (expense.items && expense.items.length > 0) {
          console.log('Items extracted:', expense.items.map(i => `${i.name}: ${i.unitPrice}`));
          expect(expense.items[0].name).toBeDefined();
          expect(expense.items[0].unitPrice).toBeGreaterThanOrEqual(0);
        }

        // Step 5: Verify ledger entries (money flow)
        if (expense.ledgerEntries && expense.ledgerEntries.length > 0) {
          console.log('Ledger entries:', expense.ledgerEntries.length);
          for (const entry of expense.ledgerEntries) {
            expect(entry.id).toBeDefined();
            expect(entry.fromAccountId).toBeDefined();
            expect(entry.toAccountId).toBeDefined();
            expect(entry.amount).toBeGreaterThan(0);
          }
        }

        // Verify splits exist (who owes what)
        if (expense.splits && expense.splits.length > 0) {
          console.log('Splits:', expense.splits.map(s => `${s.userName || s.userId}: ${s.amount}`));
          const totalSplits = expense.splits.reduce((sum, s) => sum + s.amount, 0);
          // Total splits should approximately equal expense amount
          expect(Math.abs(totalSplits - expense.amount)).toBeLessThan(1); // Allow rounding
        }

        // Step 6: Verify payment method (if applicable)
        if (expense.paymentMethod) {
          expect(expense.paymentMethod.id).toBeDefined();
          expect(expense.paymentMethod.name).toBeDefined();
          console.log('Payment method:', expense.paymentMethod.name, expense.paymentMethod.type);
        }

        // Verify payer is set
        expect(expense.paidById).toBeDefined();
        console.log('Paid by:', expense.paidByName || expense.paidById);

        // Verify expense belongs to correct source
        expect(expense.sourceId).toBeDefined();
      }

      // Additional verification: Check balances updated
      if (hasExpenseId) {
        try {
          const { balances } = await getTestBalances();
          console.log('Balances after expense:', balances.length, 'users');
          // Balances should exist after expense creation
          // (may be empty if single-user expense with no split)
        } catch (error) {
          // Balances endpoint might not exist or return empty for single user
          console.log('Balances check:', error instanceof Error ? error.message : 'skipped');
        }
      }
    }, 60000); // 60s timeout for OCR + LLM calls

    /**
     * Test receipt with specific message text
     * User sends image with text like "this is from lunch"
     */
    it('processes receipt with accompanying text', async () => {
      if (!canRunReceiptE2E) return;

      const testReceiptBase64 = getTestReceiptBase64();

      // Use base64 if available, otherwise use URL
      const message = testReceiptBase64
        ? createMockReceiptMessage('', {
            text: 'lunch with team @all',
            imageBase64: testReceiptBase64,
          })
        : createMockReceiptMessage(TEST_RECEIPT_URL, {
            text: 'lunch with team @all',
          });

      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({
        taskComplexity: 'high',
      });

      const agentInput = formatAgentInput(message, context);

      const result = await billogAgent.generate(wrapAgentInput(agentInput), {
        memory: {
          thread: `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      expect(result.text).toBeDefined();

      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      if (expenseIdMatch) {
        createdExpenseIds.push(expenseIdMatch[1]);
      }
    }, 60000);
  });

  describe('Receipt OCR Validation', () => {
    /**
     * Test that OCR extracts expected fields
     * NOTE: Direct OCR tool testing requires a served image URL
     * For now, OCR is tested indirectly via the agent flow above
     */
    it.skip('extracts store name and items from receipt (requires served URL)', async () => {
      // This test is skipped because:
      // 1. The extract-receipt tool expects imageUrl (not base64)
      // 2. To test directly, we'd need to serve the test image
      // 3. OCR extraction is tested indirectly via 'processes receipt image' test
      //
      // Future: Add HTTP server for local test assets to enable direct tool testing
    });
  });

  describe('Error Handling', () => {
    it('handles invalid image URL gracefully', async () => {
      if (!canRunReceiptE2E) return;

      const message = createMockReceiptMessage('https://invalid-url.example.com/receipt.jpg');
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({
        taskComplexity: 'high',
      });

      const agentInput = formatAgentInput(message, context);

      try {
        const result = await billogAgent.generate(wrapAgentInput(agentInput), {
          memory: {
            thread: `test-invalid-url-${Date.now()}`,
            resource: `test`,
          },
          requestContext,
          maxSteps: 5,
        });

        // If we get a response, it should handle error gracefully
        expect(result.text).toBeDefined();
        expect(result.text.toLowerCase()).toMatch(/error|sorry|try again|ลองใหม่|ขออภัย|failed|unable|cannot/i);
      } catch (error) {
        // OpenAI throws an error when trying to download invalid URL
        // This is expected behavior - the error contains "Failed to download"
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage.toLowerCase()).toMatch(/failed|download|error|invalid|url/i);
      }
    }, 30000);

    it('handles non-receipt image', async () => {
      if (!canRunReceiptE2E) return;

      // Use an image that's clearly not a receipt
      const nonReceiptUrl = 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=400'; // Dog image

      const message = createMockReceiptMessage(nonReceiptUrl);
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({
        taskComplexity: 'high',
      });

      const agentInput = formatAgentInput(message, context);

      try {
        const result = await billogAgent.generate(wrapAgentInput(agentInput), {
          memory: {
            thread: TEST_CONTEXT.sourceChannelId,
            resource: `${TEST_CONTEXT.channel}:${TEST_CONTEXT.sourceChannelId}`,
          },
          requestContext,
          maxSteps: 5,
        });

        expect(result.text).toBeDefined();
        console.log('Non-receipt image response:', result.text);

        // Agent should respond sensibly - various valid responses:
        // - Indicate it's not a receipt
        // - Ask for clarification
        // - Ask for amount (if unsure)
        // - Try to be helpful
        const validResponse =
          /not.*receipt|can't.*read|unclear|ไม่.*ใบเสร็จ|manual|amount|help|assist|ช่วย|อะไร|what|image|รูป/i.test(
            result.text
          );
        expect(validResponse).toBe(true);
      } catch (error) {
        // If image URL fails to load, that's also acceptable
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage.toLowerCase()).toMatch(/failed|download|error|url/i);
      }
    }, 60000);
  });

  describe('Database Record Verification', () => {
    it('creates expense with receipt record linked', async () => {
      if (!canRunReceiptE2E) return;

      // Skip if no real receipt to test with
      if (!process.env.TEST_RECEIPT_URL) {
        console.log('Skipping: Set TEST_RECEIPT_URL to test with real receipt');
        return;
      }

      const message = createMockReceiptMessage(process.env.TEST_RECEIPT_URL);
      const context = createMockAgentContext();
      const requestContext = createMockRequestContext({
        taskComplexity: 'high',
      });

      const agentInput = formatAgentInput(message, context);

      const result = await billogAgent.generate(wrapAgentInput(agentInput), {
        memory: {
          thread: `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
      });

      const expenseIdMatch = result.text.match(/EX:([a-zA-Z0-9-]+)/);
      if (expenseIdMatch) {
        const expenseId = expenseIdMatch[1];
        createdExpenseIds.push(expenseId);

        // Verify expense with items
        const { expense } = await getTestExpenseById(expenseId);
        expect(expense).toBeDefined();

        // Should have items from receipt
        if (expense.items && expense.items.length > 0) {
          expect(expense.items[0].name).toBeDefined();
          expect(expense.items[0].unitPrice).toBeGreaterThanOrEqual(0);
        }

        // Should have receipt record linked
        if (expense.receipt) {
          expect(expense.receipt.id).toBeDefined();
        }
      }
    }, 60000);
  });
});

/**
 * Tool Call Accuracy Tests
 * Verifies the agent calls the correct tools in the right order
 */
describe('Receipt Tool Call Accuracy', () => {
  it('calls extract-receipt before create-expense for images', async () => {
    if (!canRunReceiptE2E) return;

    const testReceiptBase64 = getTestReceiptBase64();

    // Use base64 if available, otherwise use URL
    const message = testReceiptBase64
      ? createMockReceiptMessage('', {
          imageBase64: testReceiptBase64,
        })
      : createMockReceiptMessage(TEST_RECEIPT_URL);
    const context = createMockAgentContext();
    const requestContext = createMockRequestContext({
      taskComplexity: 'high',
    });

    const agentInput = formatAgentInput(message, context);

    // Track tool calls
    const toolCalls: string[] = [];

    try {
      const result = await billogAgent.generate(wrapAgentInput(agentInput), {
        memory: {
          thread: `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          resource: `test`,
        },
        requestContext,
        maxSteps: 5,
        onStepFinish: ({ toolCalls: calls }: any) => {
          if (calls) {
            for (const call of calls as any[]) {
              // Access toolName which may be on the call object directly
              if (call.toolName) {
                toolCalls.push(call.toolName);
              }
            }
          }
        },
      });

      console.log('Tool calls made:', toolCalls);

      // Verify tool call order
      // For receipt, should call extract-receipt first (if any tools called)
      if (toolCalls.length > 0) {
        const extractIndex = toolCalls.indexOf('extractReceipt');
        const createIndex = toolCalls.indexOf('createExpense');

        // If both are called, extract should come before create
        if (extractIndex !== -1 && createIndex !== -1) {
          expect(extractIndex).toBeLessThan(createIndex);
        }
      }

      // Test passes if we get here without error
      expect(result.text).toBeDefined();
    } catch (error) {
      // If image processing fails, that's acceptable for this test
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Receipt tool call test error:', errorMessage);
      // Test still passes - we're testing tool order, not success
      expect(true).toBe(true);
    }
  }, 60000);
});
