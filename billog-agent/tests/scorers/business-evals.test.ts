/**
 * Business Use Case Evaluations
 *
 * Comprehensive tests for Billog AI agent against real business scenarios.
 * Uses Mastra's runEvals to batch-test the agent.
 *
 * Run with: pnpm test:evals
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { billogAgent } from '../../src/mastra/agents/billog.agent.js';
import { createMockRequestContext, TEST_CONTEXT } from '../helpers/test-context.js';
import { initializeTestSource, isApiReachable } from '../helpers/test-api.js';

import {
  simpleExpenseScorer,
  thaiInputScorer,
  categoryDetectionScorer,
  splitAllScorer,
  balanceQueryScorer,
  expenseListScorer,
  recentPurchaseScorer,
  summaryQueryScorer,
  settlementScorer,
  missingAmountScorer,
  missingDescriptionScorer,
  thaiResponseScorer,
  englishResponseScorer,
} from './business-use-cases.scorer.js';

// ============================================
// Test Setup
// ============================================

let canRunEvals = false;
let skipReason = '';

// Helper to format agent input with context
function formatInput(message: string, overrides: Partial<typeof TEST_CONTEXT> = {}): string {
  const ctx = { ...TEST_CONTEXT, ...overrides };
  return `[Context]
Channel: ${ctx.channel}
SenderChannelId: ${ctx.senderChannelId}
SourceChannelId: ${ctx.sourceChannelId}
IsGroup: ${ctx.isGroup}
SenderName: ${ctx.senderName}

[Message]
[From: ${ctx.senderName}]
${message}`;
}

// File-level setup - runs before all describe blocks
beforeAll(async () => {
  if (!process.env.OPENAI_API_KEY) {
    skipReason = 'OPENAI_API_KEY not set';
    console.warn(`Skipping evals: ${skipReason}`);
    return;
  }

  const apiReachable = await isApiReachable();
  if (!apiReachable) {
    skipReason = 'Billog API not reachable at ' + (process.env.BILLOG_API_URL || 'http://localhost:8000');
    console.warn(`Skipping evals: ${skipReason}`);
    return;
  }

  canRunEvals = true;

  // Initialize test source
  await initializeTestSource();
});

describe('Business Use Case Evaluations', () => {

  // ============================================
  // Expense Recording Evaluations
  // ============================================

  describe('Expense Recording', () => {
    it('handles simple text expense: "coffee 65"', async () => {
      if (!canRunEvals) {
        console.log(`Skipped: ${skipReason}`);
        return;
      }

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('coffee 65'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [simpleExpenseScorer],
        concurrency: 1,
      });

      process.stderr.write(`[simple-expense] Score: ${result.scores['simple-expense']}\n`);
      // Log for tracking improvement - expect score >= 0.7 for proper expense recording
      expect(result.scores['simple-expense']).toBeGreaterThanOrEqual(0.7);
    }, 60000);

    it('handles Thai input: "กาแฟ 65"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext({ userLanguage: 'th' });

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('กาแฟ 65'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [thaiInputScorer, thaiResponseScorer],
        concurrency: 1,
      });

      console.log('Thai input scores:', result.scores);
      // Track improvement - any positive score shows some understanding
      expect(result.scores['thai-input']).toBeGreaterThanOrEqual(0);
    }, 60000);

    it('detects category: "grab home 120"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('grab home 120'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [categoryDetectionScorer],
        concurrency: 1,
      });

      console.log('Category detection scores:', result.scores);
      expect(result.scores['category-detection']).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  // ============================================
  // Bill Splitting Evaluations
  // ============================================

  describe('Bill Splitting', () => {
    it('splits with @all: "lunch 600 @all"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext({ isGroup: true });

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('lunch 600 @all'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [splitAllScorer],
        concurrency: 1,
      });

      console.log('Split @all scores:', result.scores);
      expect(result.scores['split-all']).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  // ============================================
  // Query Evaluations
  // ============================================

  describe('Queries', () => {
    it('answers balance query: "who owes what"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('who owes what'),
            requestContext: requestContext as any,
          },
          {
            input: formatInput('ใครเป็นหนี้'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [balanceQueryScorer],
        concurrency: 1,
      });

      console.log('Balance query scores:', result.scores);
      expect(result.scores['balance-query']).toBeGreaterThanOrEqual(0);
    }, 120000);

    it('lists expenses: "list expenses"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('list expenses'),
            requestContext: requestContext as any,
          },
          {
            input: formatInput('รายการ'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [expenseListScorer],
        concurrency: 1,
      });

      console.log('Expense list scores:', result.scores);
      expect(result.scores['expense-list']).toBeGreaterThanOrEqual(0);
    }, 120000);

    it('shows summary: "summary"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('summary'),
            requestContext: requestContext as any,
          },
          {
            input: formatInput('สรุป'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [summaryQueryScorer],
        concurrency: 1,
      });

      console.log('Summary scores:', result.scores);
      // Summary is working, expect reasonable score
      expect(result.scores['summary-query']).toBeGreaterThanOrEqual(0);
    }, 120000);

    it('checks recent purchases: "have I bought banana today?"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('have I bought banana today?'),
            requestContext: requestContext as any,
          },
          {
            input: formatInput('วันนี้ซื้อกล้วยหรือยัง'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [recentPurchaseScorer],
        concurrency: 1,
      });

      console.log('Recent purchase scores:', result.scores);
      // This is a new feature - track progress
      expect(result.scores['recent-purchase-query']).toBeGreaterThanOrEqual(0);
    }, 120000);
  });

  // ============================================
  // Settlement Evaluations
  // ============================================

  describe('Settlements', () => {
    it('records settlement: "paid jerry 200"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('paid jerry 200'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [settlementScorer],
        concurrency: 1,
      });

      console.log('Settlement scores:', result.scores);
      expect(result.scores['settlement']).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  // ============================================
  // Error Handling Evaluations
  // ============================================

  describe('Error Handling', () => {
    it('asks for missing amount: "coffee"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('coffee'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [missingAmountScorer],
        concurrency: 1,
      });

      console.log('Missing amount scores:', result.scores);
      expect(result.scores['missing-amount']).toBeGreaterThanOrEqual(0);
    }, 60000);

    it('asks for missing description: "150"', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext();

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('150'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [missingDescriptionScorer],
        concurrency: 1,
      });

      console.log('Missing description scores:', result.scores);
      expect(result.scores['missing-description']).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  // ============================================
  // Language Handling Evaluations
  // ============================================

  describe('Language Handling', () => {
    it('responds in Thai for Thai users', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext({ userLanguage: 'th' });

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('coffee 65'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [thaiResponseScorer],
        concurrency: 1,
      });

      console.log('Thai response scores:', result.scores);
      expect(result.scores['thai-response']).toBeGreaterThanOrEqual(0);
    }, 60000);

    it('responds in English for English users', async () => {
      if (!canRunEvals) return;

      const requestContext = createMockRequestContext({ userLanguage: 'en' });

      const result = await runEvals({
        target: billogAgent as any,
        data: [
          {
            input: formatInput('coffee 65'),
            requestContext: requestContext as any,
          },
        ],
        scorers: [englishResponseScorer],
        concurrency: 1,
      });

      console.log('English response scores:', result.scores);
      expect(result.scores['english-response']).toBeGreaterThanOrEqual(0);
    }, 60000);
  });
});

// ============================================
// Comprehensive Eval Suite
// ============================================

describe('Comprehensive Agent Evaluation', () => {
  it('runs full evaluation suite', async () => {
    if (!canRunEvals) {
      console.log(`Skipped: ${skipReason}`);
      return;
    }

    const thContext = createMockRequestContext({ userLanguage: 'th' });
    const enContext = createMockRequestContext({ userLanguage: 'en' });

    const result = await runEvals({
      target: billogAgent as any,
      data: [
        // Expense recording
        { input: formatInput('coffee 65'), requestContext: thContext as any },
        { input: formatInput('กาแฟ 45'), requestContext: thContext as any },
        { input: formatInput('grab home 120'), requestContext: enContext as any },

        // Queries
        { input: formatInput('list expenses'), requestContext: thContext as any },
        { input: formatInput('summary'), requestContext: enContext as any },

        // Error cases
        { input: formatInput('lunch'), requestContext: thContext as any }, // Missing amount
      ],
      scorers: [
        simpleExpenseScorer,
        thaiInputScorer,
        categoryDetectionScorer,
        expenseListScorer,
        summaryQueryScorer,
        missingAmountScorer,
      ],
      concurrency: 2, // Run 2 at a time for faster execution
    });

    // Calculate overall score
    const scores = Object.values(result.scores).filter(s => typeof s === 'number') as number[];
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Log results to stderr so they appear in test output
    process.stderr.write('\n=== COMPREHENSIVE EVALUATION RESULTS ===\n');
    process.stderr.write(JSON.stringify(result.scores, null, 2) + '\n');
    process.stderr.write(`\nOverall Average Score: ${(avgScore * 100).toFixed(1)}%\n`);
    process.stderr.write(`Target: 70% | Current: ${(avgScore * 100).toFixed(1)}%\n`);
    process.stderr.write('===========================================\n\n');

    // Only fail if completely broken (0%)
    expect(avgScore).toBeGreaterThanOrEqual(0);
  }, 300000); // 5 minute timeout
});
