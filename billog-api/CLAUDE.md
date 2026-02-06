# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Billog** is a Bookkeeping AI that manages money flow through chat apps (WhatsApp, LINE). It handles expense tracking, bill splitting, and double-entry accounting through natural conversation.

## Architecture

Billog uses **OpenClaw** as the agent framework:

```
OpenClaw (Agent + Channels: LINE, WhatsApp, etc.)
    │
    └── Billog Skill (SKILL.md) ──HTTP──► Billog API Server (NestJS)
                                              │
                                              └── PostgreSQL (TigerBeetle Ledger)
```

- **OpenClaw**: Handles AI agent, channels, conversation flow
- **Billog API**: NestJS REST backend for expense/ledger operations
- **Billog Skill**: Teaches OpenClaw how to interact with Billog API

## Core Use Cases

1. **Group Chat - Bill Splitting**: Share house, travel with friends (domestic/overseas), multi-currency support
2. **Household - Item-Level Splitting**: Same receipt, different payers (my items vs wife's items)
3. **Personal DM - Expense Tracking**: AI collects sufficient info for proper bookkeeping
4. **Smart Receipt OCR**: Extract items with classification (fruit, dairy, pet) for future insights

## Tech Stack

- **Runtime**: Node.js 20, TypeScript, pnpm
- **Framework**: NestJS 11
- **AI**: VoltAgent + OpenAI GPT-4o
- **Database**: PostgreSQL + Prisma ORM
- **Queue**: BullMQ + Redis
- **Channels**: WhatsApp (Baileys), LINE

## Project Structure

```
billog-app/
├── app/                    # NestJS backend
│   ├── src/                # Source code (compiled to dist/)
│   ├── prisma/
│   │   └── schema.prisma   # Database schema
│   └── tests/
├── web/                    # Next.js frontend
└── docker-compose.yml
```

## Message Flow

```
User Message (text | receipt) in LINE/WhatsApp
    ↓
OpenClaw Channel (receives message, downloads images)
    ↓
OpenClaw AI Agent (with Billog Skill context)
├── For receipts: GPT-4o Vision extracts data
└── For text: Collects sufficient info
    ↓
Agent calls Billog API via HTTP:
├── POST /expenses         → Create expense + items + splits
├── GET  /balances/:source → Query who owes whom
├── POST /settlements      → Record payment
└── GET  /expenses         → Query history
    ↓
Billog API processes + updates PostgreSQL ledger
    ↓
Agent formats compact confirmation response
    ↓
OpenClaw sends reply to chat
```

**Note**: Receipt OCR is handled by OpenClaw (GPT-4o Vision), not Billog API.

## TigerBeetle Ledger Model

Every user has accounts **per source** (auto-created):

```
User: @tawan
├── WhatsApp DM          → Account [THB, ASSET]
├── Family LINE Group    → Account [THB, ASSET/LIABILITY]
├── Japan Trip WhatsApp  → Account [JPY, ASSET/LIABILITY]
└── Share House Group    → Account [THB, ASSET/LIABILITY]
```

**Why per source?** Money owed in family group ≠ money owed in travel group.

**Account Codes:**
```typescript
ASSET     = 100  // Money owed TO you
LIABILITY = 200  // Money you OWE
EXPENSE   = 300  // Spending category
INCOME    = 400  // Income tracking
```

**Transfer Codes:**
```typescript
EXPENSE_SPLIT = 1  // Bill split
SETTLEMENT    = 2  // Payment received
ADJUSTMENT    = 3  // Manual correction
```

**Ledger (Currency):**
```typescript
THB = 1, USD = 2, AUD = 3, EUR = 4, JPY = 5
```

## Common Commands

```bash
# Development (in app/)
pnpm dev                    # Start dev server
pnpm build                  # Build TypeScript
pnpm test                   # Run tests (Vitest)

# Database
pnpm prisma generate        # Generate client
pnpm prisma migrate dev     # Apply migrations
pnpm prisma studio          # Open Prisma Studio

# Docker
pnpm docker:dev             # Dev with hot reload + monitoring
docker compose up -d        # Production
```

## Database Schema Overview

### Core Tables
- `users` - User profile
- `user_identities` - Channel identities (LINE ID, WhatsApp JID)
- `sources` - Conversation context (DM/Group)
- `source_members` - User ↔ Source with role/nickname

### Expense Tables
- `expenses` - Main record (paidBy, amount, currency)
- `expense_items` - Line items with `ingredientType` and `assignedTo`
- `categories` - Hierarchical categories
- `receipts` - OCR data (store, items, confidence)

### Ledger Tables
- `account` - Per user/source/currency/code with debit/credit balances
- `transfer` - Double-entry transactions

### Bookkeeping Tables
- `payment_methods` - Cash, cards, PromptPay, etc.
- `tax_categories` - Tax deduction categories
- `bookkeeping_reports` - Generated reports

## Key Architectural Decisions

1. **Accounts auto-created per source** - System preps accounts when user joins or creates expense
2. **Double-entry always** - Every transfer has debit + credit account
3. **Item-level splitting** - `ExpenseItem.assignedTo` enables same-receipt splits
4. **Multi-currency** - Ledger field partitions accounts by currency
5. **Reconciliation** - Item changes recalculate expense totals

## Testing

```bash
pnpm test                   # Run all tests
pnpm vitest run <file>      # Run specific test
pnpm test:watch             # Watch mode
pnpm test:coverage          # Coverage report
```

Tests are in `app/tests/` and use Vitest with 30s timeout.

## Important Files

1. `ARCHITECTURE.md` - Full architecture with flow diagrams
2. `app/prisma/schema.prisma` - Database schema
3. `app/src/services/ledger/` - TigerBeetle-style accounting
4. `app/src/agent/` - VoltAgent setup and tools
5. `app/src/workflow/handlers/` - Message flow handlers
