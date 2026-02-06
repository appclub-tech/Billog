# Billog Agent E2E Tests

End-to-end tests for the Billog AI bookkeeper agent.

## Architecture

```
tests/
├── setup.ts                    # Test environment setup
├── helpers/
│   ├── test-context.ts         # Mock messages, contexts, RequestContext
│   ├── test-api.ts             # API helpers for DB verification
│   └── index.ts                # Helper exports
├── e2e/
│   ├── expense-workflow.test.ts  # Text expense E2E tests
│   └── receipt-workflow.test.ts  # Receipt OCR E2E tests
└── scorers/
    ├── tool-accuracy.scorer.ts   # Mastra scorers for tool call accuracy
    ├── run-evals.test.ts         # Batch evaluation tests
    └── index.ts                  # Scorer exports
```

## Test Flow

The E2E tests verify the complete Billog workflow:

```
User Message (text | image)
    ↓
Gateway Router
    ├── Detect complexity (image → high, text → simple)
    ├── Build RequestContext (language, channel, IDs)
    └── Format agent input
    ↓
Billog Agent (with RequestContext)
    ├── Dynamic instructions based on userLanguage
    ├── Dynamic model based on taskComplexity
    └── Tool calls:
        ├── For receipts: extract-receipt → create-expense
        └── For text: create-expense directly
    ↓
Billog API (with JWT auth)
    ├── Create expense record
    ├── Create expense items
    ├── Create receipt record (if OCR)
    └── Create ledger transfers (if splits)
    ↓
Agent Response (with EX:expense_id)
```

## Running Tests

### Prerequisites

1. **Billog API Running**
   ```bash
   cd billog-api && docker compose up -d
   ```

2. **Environment Variables** (loaded from `.env` automatically)

   Create `.env` in `billog-agent/`:
   ```bash
   BILLOG_API_URL=http://localhost:8000
   BILLOG_JWT_SECRET=your-secret
   OPENAI_API_KEY=sk-...
   GOOGLE_API_KEY=your-gemini-key
   ```

3. **Test Assets** (for receipt tests)

   Place test receipt at `test-assets/receipt-test.jpg` (project root)

### Run Tests

```bash
# Install dependencies
pnpm install

# Run all tests (auto-detects if API is available)
pnpm test

# Run E2E tests only
pnpm test:e2e

# Run scorer tests only
pnpm test:scorers

# Run unit tests only (scorer unit tests, no API needed)
pnpm test:unit

# Watch mode
pnpm test:watch
```

> **Note**: Tests automatically skip if prerequisites are missing (API not reachable, keys not set). No need to set `RUN_E2E=true`.

## Test Categories

### 1. Text Expense Workflow (`expense-workflow.test.ts`)

Tests simple text-based expense recording:

- **Simple expense**: "coffee 65" → creates expense
- **Bill split**: "lunch 500 @all" → creates with splits
- **Category detection**: "grab home 120" → detects Transport
- **Language response**: Thai input → Thai response

### 2. Receipt Workflow (`receipt-workflow.test.ts`)

Tests image-based receipt processing:

- **Full flow**: Image → OCR → create expense → verify DB
- **OCR extraction**: Verify store name, items extracted
- **Error handling**: Invalid URL, non-receipt images
- **Database verification**: Expense + items + receipt linked

### 3. Tool Call Accuracy (`scorers/`)

Mastra-based scorers for evaluating agent behavior:

- **`receiptToolAccuracyScorer`**: Verifies extract → create order
- **`textExpenseToolAccuracyScorer`**: Verifies no OCR for text
- **`queryToolAccuracyScorer`**: Verifies query vs create
- **`expenseIdResponseScorer`**: Verifies EX:xxx in response
- **`languageAccuracyScorer`**: Verifies language matches preference

## Writing New Tests

### Testing Agent Behavior

```typescript
import { billogAgent } from '../src/mastra/agents/billog.agent.js';
import { createMockRequestContext, formatAgentInput } from './helpers';

const message = createMockMessage({ text: 'coffee 65' });
const context = createMockAgentContext();
const requestContext = createMockRequestContext();
const agentInput = formatAgentInput(message, context);

const result = await billogAgent.generate(agentInput, {
  memory: { thread: 'test', resource: 'test' },
  requestContext,
  maxSteps: 5,
});

expect(result.text).toMatch(/EX:[a-zA-Z0-9-]+/);
```

### Creating Custom Scorers

```typescript
import { createScorer } from '@mastra/core/evals';

export const myScorer = createScorer({
  id: 'my-scorer',
  description: 'My custom scorer',
  type: 'agent',
}).generateScore(({ run }) => {
  // Check run.output, run.inputMessages, etc.
  return 0.0 to 1.0;
});
```

### Running Evaluations

```typescript
import { runEvals } from '@mastra/core/evals';

const result = await runEvals({
  target: billogAgent,
  data: [
    { input: 'coffee 65', requestContext },
    { input: 'lunch 500', requestContext },
  ],
  scorers: [myScorer],
});

console.log(result.scores);
```

## Debugging

### Enable Debug Logging

```bash
DEBUG=true pnpm test:e2e
```

### Inspect Tool Calls

```typescript
const result = await agent.generate(input, {
  onStepFinish: ({ toolCalls, toolResults }) => {
    console.log('Tool calls:', toolCalls);
    console.log('Results:', toolResults);
  },
});
```

### Check Database State

```typescript
import { getTestExpenseById } from './helpers';

const { expense } = await getTestExpenseById(expenseId);
console.log('Expense:', expense);
console.log('Items:', expense.items);
console.log('Receipt:', expense.receipt);
```

## CI/CD Integration

Add to your CI workflow:

```yaml
- name: Run E2E Tests
  env:
    RUN_E2E: true
    BILLOG_API_URL: http://localhost:8000
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
  run: pnpm test:e2e
```
