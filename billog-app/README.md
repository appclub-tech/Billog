# Billog.ai

> **"No more money fights. Just smiles."**
>

AI-powered family budget assistant with TigerBeetle-style double-entry accounting.

Money is the #1 cause of household conflicts. **Yimmy** is an AI assistant that lives in your family's chat group, quietly managing expenses, tracking who owes whom, and keeping everyone accountable.

---

## Features

### Conversational AI
- Natural Thai/English understanding (auto-detect)
- Context-aware responses with memory
- Proactive suggestions based on spending patterns

### Receipt Vision (OCR)
- Upload any receipt image
- Extracts store, items, prices, totals
- Auto-detects currency from location (Thai store → THB, Australian → AUD)
- Powered by GPT-4o Vision

### Expense Management
- @mention splits: `ค่าอาหาร 500 @all`
- Percentage splits: `@mom 50% @dad 30% @son 20%`
- Item-level assignment: "Bobby's items only"
- Multi-currency support (THB, USD, AUD, EUR, JPY)
- **Reply-to-edit**: Quote any expense message to modify/delete

### Message Workflows
| Workflow | Trigger | Action |
|----------|---------|--------|
| **Text** | Normal message | Conversational expense recording |
| **Receipt** | Image attached | OCR → Auto-save → Compact response |
| **Reply** | Quote/reply to message | Edit expense or items via `EX:xxx` |

### Double-Entry Ledger (TigerBeetle-Compatible)
- ASSET accounts: Money owed TO you
- LIABILITY accounts: Money you OWE
- Atomic transfers with full audit trail
- Real-time balance calculations

### Budget & Reports
- Per-category/person limits
- Real-time warnings before overspending
- Daily summaries, monthly breakdowns

### Multi-Channel
- **LINE** - Webhook integration
- **WhatsApp** - Baileys WebSocket (no browser)
- **Telegram/Discord** - Coming soon

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL (or Neon)
- Redis (or Upstash)
- OpenAI API key

### Installation

```bash
# Clone
git clone https://github.com/your-org/yimmy.git
cd yimmy/app

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Generate Prisma client
pnpm prisma generate

# Run migrations
pnpm prisma migrate dev

# Start development
pnpm dev
```

### Docker

```bash
# Development (with hot reload)
docker-compose up -d

# Production build
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://host:6379

# OpenAI
OPENAI_API_KEY=sk-...

# LINE (optional)
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...

# WhatsApp (optional)
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CHANNELS                                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │  LINE   │  │WhatsApp │  │Telegram │  │ Discord │  │   Web   │           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────────────┘
        └────────────┴────────────┴─────┬──────┴────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MESSAGE QUEUE (BullMQ)                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  message-queue  │    │  receipt-queue  │    │  summary-queue  │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
└───────────┴──────────────────────┴──────────────────────┴───────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WORKFLOW LAYER                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  TextHandler    │  │ ReceiptHandler  │  │  ReplyHandler   │             │
│  │  (normal msg)   │  │ (image → OCR)   │  │ (EX:xxx lookup) │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           └────────────────────┴─────────────┬──────┘                       │
└──────────────────────────────────────────────┼──────────────────────────────┘
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         VoltAgent (Yimmy)                            │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│  │  │    Memory    │  │Summarization │  │     Working Memory       │  │   │
│  │  │  (Postgres)  │  │  (GPT-4o-m)  │  │   (User Preferences)     │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │   │
│  │                                                                      │   │
│  │  ┌──────────────────────── TOOLS ───────────────────────────────┐  │   │
│  │  │ EXPENSE: add │ modify │ delete │ query                       │  │   │
│  │  │ ITEMS:   add │ modify │ delete │ get │ query (reconciliation)│  │   │
│  │  │ BALANCE: get_balances │ record_payment │ analyze_receipt     │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DATA LAYER                                       │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────┐    │
│  │      CORE TABLES        │    │      TIGERBEETLE LEDGER             │    │
│  │  User ◄──► UserIdentity │    │  Account ◄────────► Transfer        │    │
│  │  Source ◄──► Member     │◄──►│  (balances)         (double-entry)  │    │
│  │  Expense ◄──► Items     │    │                                      │    │
│  └─────────────────────────┘    └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Examples

### 1. Bill Splitting Flow

```
Scenario: Alice pays 300 THB for lunch, split with Bob & Carol (100 each)

┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Create Accounts                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Alice's ASSET   │  │ Bob's LIABILITY │  │Carol's LIABILITY│             │
│  │ code: 100       │  │ code: 200       │  │ code: 200       │             │
│  │ ledger: 1 (THB) │  │ ledger: 1 (THB) │  │ ledger: 1 (THB) │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ STEP 2: Create Transfers (amounts in satang = THB × 100)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Transfer 1: Bob → Alice                Transfer 2: Carol → Alice           │
│  ┌─────────────────────────┐            ┌─────────────────────────┐        │
│  │ debit:  Bob's LIABILITY │            │ debit:  Carol's LIAB    │        │
│  │ credit: Alice's ASSET   │            │ credit: Alice's ASSET   │        │
│  │ amount: 10000 (฿100)    │            │ amount: 10000 (฿100)    │        │
│  │ code: 1 (EXPENSE_SPLIT) │            │ code: 1 (EXPENSE_SPLIT) │        │
│  └─────────────────────────┘            └─────────────────────────┘        │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ STEP 3: Resulting Balances                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │ Account          │ debits_posted │ credits_posted │ Balance      │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │ Alice (ASSET)    │ 0             │ 20000          │ +฿200 owed   │      │
│  │ Bob (LIABILITY)  │ 10000         │ 0              │ +฿100 owes   │      │
│  │ Carol (LIABILITY)│ 10000         │ 0              │ +฿100 owes   │      │
│  └──────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Settlement Flow

```
Scenario: Bob pays Alice ฿100 via PromptPay

┌─────────────────────────────────────────────────────────────────────────────┐
│ Create Settlement Transfer                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────┐                                      │
│  │ debit:  Alice's ASSET             │  ← Reduces what she's owed           │
│  │ credit: Bob's LIABILITY           │  ← Reduces what he owes              │
│  │ amount: 10000 (฿100)              │                                      │
│  │ code: 2 (SETTLEMENT)              │                                      │
│  │ user_data_32: 3 (PromptPay)       │  ← Payment method                    │
│  └───────────────────────────────────┘                                      │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ Updated Balances                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │ Account          │ debits_posted │ credits_posted │ Balance      │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │ Alice (ASSET)    │ 10000         │ 20000          │ +฿100 owed   │      │
│  │ Bob (LIABILITY)  │ 10000         │ 10000          │ ฿0 CLEARED!  │      │
│  │ Carol (LIABILITY)│ 10000         │ 0              │ +฿100 owes   │      │
│  └──────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Reply-to-Edit Flow (EX Tracking)

```
Every expense response includes EX:{expenseId} for tracking:

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. User creates expense                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User: "Coffee $5"                                                          │
│   Bot:  ✅ **Coffee** | $5 | Food                                            │
│         EX:exp_abc123                                                        │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. User replies to edit (quotes the message)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User: "EX:exp_abc123 change to $6"                                         │
│                                                                              │
│   → Reply handler extracts EX:exp_abc123 from message                        │
│   → Fetches expense + all items by PK                                        │
│   → Adds full context to prompt:                                             │
│                                                                              │
│     ### Target Expense                                                       │
│     - Expense ID: exp_abc123                                                 │
│     - Description: Coffee                                                    │
│     - Total: USD 5.00                                                        │
│     - Category: Food                                                         │
│                                                                              │
│     ### Items (use item ID for item-level edits)                             │
│     - **item_001**: Coffee x1 @ $5.00 = $5.00                                │
│                                                                              │
│   → AI calls modify_expense(exp_abc123, amount: 6)                           │
│   → Response: ✅ Updated: Coffee | $5 → $6 | EX:exp_abc123                   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Item-level edits                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User: "EX:exp_abc123 change TheraBreath to $14"                            │
│                                                                              │
│   → AI sees items list with IDs                                              │
│   → AI calls modify_expense_item(item_001, unitPrice: 14)                    │
│   → Item totalPrice recalculated: 14 × 1 = 14                                │
│   → Expense amount recalculated: Σ(all items) = new total                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. Receipt Processing Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ User sends receipt image via LINE/WhatsApp                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Download & Store Image                                                    │
│    /data/uploads/1770170886089-e65353432f30e5a2.jpg                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. GPT-4o Vision Analysis                                                    │
│                                                                              │
│    ┌────────────────────────────────────────────────────────────────┐       │
│    │ {                                                               │       │
│    │   "storeName": "Kmart Geelong",                                │       │
│    │   "storeAddress": "Geelong, VIC, Australia",                   │       │
│    │   "currency": "AUD",  ← Detected from location                 │       │
│    │   "total": 140.00,                                             │       │
│    │   "items": [                                                   │       │
│    │     { "name": "Dog Food", "price": 45.00, "type": "pet" },    │       │
│    │     { "name": "Cat Litter", "price": 28.00, "type": "pet" },  │       │
│    │     { "name": "Milk 2L", "price": 4.50, "type": "dairy" },    │       │
│    │     ...                                                        │       │
│    │   ]                                                            │       │
│    │ }                                                              │       │
│    └────────────────────────────────────────────────────────────────┘       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Create Expense + Items                                                    │
│                                                                              │
│    Expense: $140 AUD at Kmart                                               │
│    ExpenseItems: 9 items with names, prices, ingredient types               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Handle Splits (if group chat)                                             │
│                                                                              │
│    "Bobby's items are the pet food and cat litter"                          │
│                                                                              │
│    → Bobby's share: $73.00 (dog food + cat litter)                          │
│    → Create Transfer: Bobby LIABILITY → Payer ASSET                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Context Management

Implements [OpenClaw's 8 Techniques](https://codepointer.substack.com/p/openclaw-stop-losing-context-8-techniques):

| Technique | Implementation |
|-----------|----------------|
| Memory Flush Before Compaction | Working Memory Schema |
| Context Window Guards | VoltAgent built-in |
| Tool Result Guard | VoltAgent built-in |
| Turn-Based History Limiting | `keepMessages: 8` |
| Cache-Aware Pruning | Provider-level |
| Head/Tail Preservation | Recent messages kept |
| Adaptive Chunk Ratio | `triggerTokens: 80K` |
| Staged Summarization | VoltAgent built-in |

### Working Memory Schema

```typescript
{
  preferences: { language, currency, timezone, communicationStyle },
  groupContext: { memberNicknames, recentPayers, defaultSplitStyle },
  budgetGoals: [{ category, limit, period }],
  recentPatterns: { topCategories, averageExpense, frequentStores },
  pendingTasks: [{ task, dueDate, relatedExpenseId }]
}
```

### Summarization

- Triggers at 80K tokens (GPT-4o has 128K)
- Keeps last 8 messages for continuity
- Uses GPT-4o-mini for cost efficiency
- Focuses on balances, expenses, settlements, preferences

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User profiles |
| `user_identities` | Channel identities (LINE ID, WhatsApp JID) |
| `sources` | Conversations (DM/Group) |
| `source_members` | User ↔ Source mapping |
| `expenses` | Expense records |
| `expense_items` | Receipt line items |
| `categories` | Expense categories |

### Ledger Tables (TigerBeetle-Compatible)

| Table | Purpose |
|-------|---------|
| `account` | Balance tracking (ASSET/LIABILITY per user per source) |
| `transfer` | Double-entry transactions (EXPENSE_SPLIT, SETTLEMENT) |

### Removed Tables

These were replaced by the ledger system:
- ~~`expense_splits`~~ → `transfer` with code=1
- ~~`settlements`~~ → `transfer` with code=2

---

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/ledger/ledger.e2e.test.ts

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Test Files

| File | Tests | Description |
|------|-------|-------------|
| `ledger.e2e.test.ts` | 13 | Core ledger operations |
| `expense-integration.e2e.test.ts` | 11 | Expense tools integration |
| `receipt-flow.e2e.test.ts` | 12 | Full receipt → expense → settlement |

---

## Project Structure

```
app/
├── src/
│   ├── agent/              # VoltAgent configuration
│   │   ├── agent.service.ts
│   │   ├── prompt.service.ts    # Dynamic prompts per workflow
│   │   ├── tool-registry.service.ts
│   │   └── tools/
│   │       ├── expense.tools.ts   # Expense & item CRUD
│   │       ├── balance.tools.ts   # Balance queries
│   │       ├── settlement.tools.ts
│   │       └── receipt.tools.ts   # OCR
│   ├── channels/           # LINE, WhatsApp adapters
│   │   ├── adapters/
│   │   │   ├── line.adapter.ts
│   │   │   └── whatsapp.adapter.ts
│   │   └── webhooks/
│   ├── memory/             # Shared VoltAgent memory
│   ├── services/
│   │   ├── ledger/         # TigerBeetle-style accounting
│   │   ├── expense/
│   │   ├── user/
│   │   └── ...
│   ├── queue/              # BullMQ processors
│   └── workflow/           # Message workflow routing
│       ├── message-workflow.service.ts
│       └── handlers/
│           ├── base.handler.ts        # Handler interface
│           ├── text-expense.handler.ts  # Normal text messages
│           ├── receipt-image.handler.ts # Receipt OCR workflow
│           └── reply.handler.ts         # Reply-to-edit with EX lookup
├── prisma/
│   └── schema.prisma
├── tests/
│   └── ledger/
├── docs/
│   └── ARCHITECTURE.md
└── CLAUDE.md               # Context for Claude Code
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20, NestJS |
| AI Framework | VoltAgent |
| LLM | OpenAI GPT-4o |
| Vision | OpenAI GPT-4o Vision |
| Prompt Optimization | [TOON](https://github.com/toon-format/toon) (~40% fewer tokens) |
| Database | PostgreSQL (Neon) + Prisma |
| Queue | BullMQ + Redis (Upstash) |
| Memory | VoltAgent PostgreSQL Adapter |

---

## Available AI Tools

### Expense Tools
| Tool | Description |
|------|-------------|
| `add_expense` | Record expense with splits, items, multi-currency |
| `modify_expense` | Edit expense (amount, category, description, splits) |
| `delete_expense` | Remove expense and all items |
| `query_expenses` | Search expenses with filters |

### Item Tools (with auto-reconciliation)
| Tool | Description |
|------|-------------|
| `get_expense_items` | Get items from specific expense |
| `add_expense_item` | Add item to existing expense |
| `modify_expense_item` | Edit item (qty, price, name) - recalculates totals |
| `delete_expense_item` | Remove item - recalculates expense total |
| `query_items` | Search items across expenses |

### Balance & Settlement
| Tool | Description |
|------|-------------|
| `get_balances` | Check who owes whom |
| `record_payment` | Record debt settlement |

### Other Tools
| Tool | Description |
|------|-------------|
| `analyze_receipt` | OCR receipt image |
| `get_spending_report` | Generate spending reports |
| `set_budget` | Set spending limits |
| `query_budget` | Check budget status |

### Reconciliation
Item changes automatically recalculate:
```
item.totalPrice = quantity × unitPrice
expense.amount = Σ(all items.totalPrice)
```
This ensures expense totals always match sum of items (proper bookkeeping).

---

## Documentation

- [Architecture Deep Dive](./app/docs/ARCHITECTURE.md)
- [Claude Code Context](./app/CLAUDE.md)

---

## License

MIT
