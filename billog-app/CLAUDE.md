# CLAUDE.md - Project Context for Claude Code

## Project Overview

**Yimmy** is an AI-powered family budget assistant that operates through WhatsApp/LINE. Built with NestJS + VoltAgent framework, it helps users track expenses, split bills, and manage shared budgets in Thai/English.

## Tech Stack

- **Runtime**: Node.js 20, TypeScript, pnpm
- **Framework**: NestJS 11
- **AI**: VoltAgent + OpenAI GPT-4o
- **Database**: PostgreSQL + Prisma ORM
- **Messaging**: WhatsApp (Baileys), LINE
- **Testing**: Vitest

## Project Structure

```
app/
├── src/
│   ├── agent/           # VoltAgent setup, tools, prompts
│   │   ├── agent.service.ts      # Main agent with summarization config
│   │   ├── prompt.service.ts     # Dynamic system prompts
│   │   ├── tool-registry.service.ts
│   │   └── tools/                # AI tool definitions
│   │       ├── expense.tools.ts  # Expense tracking tools
│   │       ├── balance.tools.ts  # Balance query tools
│   │       └── settlement.tools.ts
│   ├── memory/          # VoltAgent memory (shared module)
│   │   └── memory.module.ts      # PostgreSQL adapter + Working Memory
│   ├── services/
│   │   ├── ledger/      # TigerBeetle-style double-entry accounting
│   │   │   ├── account.service.ts
│   │   │   ├── transfer.service.ts
│   │   │   ├── balance.service.ts
│   │   │   └── constants.ts
│   │   ├── expense/     # Expense business logic
│   │   └── whatsapp/    # WhatsApp integration (Baileys)
│   ├── channels/        # Message channel adapters
│   │   ├── whatsapp/
│   │   └── line/
│   └── workflow/        # VoltAgent workflows (receipt processing)
├── prisma/
│   └── schema.prisma    # Database schema
├── test/                # E2E tests (Vitest)
└── docs/
    └── ARCHITECTURE.md  # Detailed architecture documentation
```

## Key Architectural Decisions

### 1. TigerBeetle-Style Double-Entry Accounting
Instead of simple balance fields, we use proper accounting:
- `Account` table: tracks `debits_posted`, `credits_posted` per user/source/ledger
- `Transfer` table: every money movement is a debit+credit pair
- Ensures balances always sum to zero (accounting integrity)

### 2. VoltAgent Memory (Shared Module)
Single `PostgreSQLMemoryAdapter` instance shared across all services to prevent duplicate PostgreSQL type creation errors.

```typescript
// memory.module.ts exports VOLTAGENT_MEMORY token
@Inject(VOLTAGENT_MEMORY) private readonly memory: Memory | null
```

### 3. Context Management (OpenClaw-inspired)
- **Working Memory**: User preferences, group context, budget goals persisted across conversations
- **Summarization**: Triggers at 80K tokens, keeps last 8 messages, uses GPT-4o-mini

### 4. Receipt Processing Flow
1. User sends image via WhatsApp
2. Image uploaded to Cloudinary
3. VoltAgent multimodal processes image
4. Extracted items stored in `expense_items`
5. Transfers created for bill splits

## Database Schema (Key Tables)

```
Core Tables:
- User, Source (groups/chats)
- Expense, ExpenseItem, Receipt, Category

Ledger Tables (TigerBeetle-style):
- Account (user_id, source_id, ledger, code, debits_posted, credits_posted)
- Transfer (debit_account_id, credit_account_id, amount, code, user_data_128)

VoltAgent Tables (auto-created):
- voltagent_memory_* (conversations, messages, working memory)
```

## Common Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Build TypeScript
pnpm test                   # Run all tests
pnpm test:e2e               # Run E2E tests only

# Database
pnpm prisma migrate dev     # Apply migrations
pnpm prisma generate        # Generate client
pnpm prisma studio          # Open Prisma Studio

# Docker
docker compose up -d        # Start services
docker compose logs -f app-yimmyai-1  # View logs
docker compose build --no-cache       # Rebuild
```

## Environment Variables

```env
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
CLOUDINARY_URL=cloudinary://...
WHATSAPP_SESSION_PATH=./data/sessions
```

## Testing

E2E tests use Vitest with test database:
- `test/ledger/account.service.e2e-spec.ts`
- `test/ledger/transfer.service.e2e-spec.ts`
- `test/ledger/balance.service.e2e-spec.ts`

Run specific test:
```bash
pnpm vitest run test/ledger/balance.service.e2e-spec.ts
```

## Current Implementation Status

**Completed:**
- TigerBeetle-style ledger (Account, Transfer tables)
- VoltAgent integration with shared memory
- Working Memory schema for user preferences
- Summarization config (80K token trigger)
- WhatsApp channel with Baileys
- Receipt OCR via multimodal
- E2E tests for ledger services (36 tests passing)

**In Progress:**
- Settlement tool updates to use Transfer table
- LINE channel integration

## Important Files to Read First

1. `docs/ARCHITECTURE.md` - Full architecture with flow diagrams
2. `src/agent/agent.service.ts` - VoltAgent setup with summarization
3. `src/memory/memory.module.ts` - Shared memory with Working Memory schema
4. `src/services/ledger/constants.ts` - Ledger/account/transfer codes
5. `prisma/schema.prisma` - Database schema

## Ledger Constants Reference

```typescript
LEDGER = { THB: 1, USD: 2, AUD: 3 }
ACCOUNT_CODE = { ASSET: 100, LIABILITY: 200, EXPENSE: 300 }
TRANSFER_CODE = { EXPENSE_SPLIT: 1, SETTLEMENT: 2, ADJUSTMENT: 3 }
```

## Bill Split Flow Example

```
Alice pays 300 THB for lunch, split with Bob and Carol:

1. Create Expense (paid_by: Alice, amount: 300)
2. Create Accounts:
   - Alice ASSET (code=100) for this source
   - Bob LIABILITY (code=200) for this source
   - Carol LIABILITY (code=200) for this source
3. Create Transfers (code=1 EXPENSE_SPLIT):
   - Transfer: Bob LIABILITY -> Alice ASSET, 100 THB
   - Transfer: Carol LIABILITY -> Alice ASSET, 100 THB
4. Result:
   - Alice: credits_posted=200 (owed 200)
   - Bob: debits_posted=100 (owes 100)
   - Carol: debits_posted=100 (owes 100)
```

## Tips for Working on This Codebase

1. **Always run tests** after modifying ledger services
2. **Use Prisma transactions** for account balance updates
3. **Check VoltAgent docs** via MCP tool for framework questions
4. **Memory is optional** - services handle null memory gracefully
5. **Amounts in smallest unit** - store satang (1 THB = 100 satang)
