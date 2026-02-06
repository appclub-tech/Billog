# Billog Architecture

## Overview

Billog is a Bookkeeping AI that manages money flow through chat apps. It uses **OpenClaw** as the agent framework and **Billog API** (NestJS) as the backend.

**Key Insight**: OpenClaw handles the AI agent, channels (LINE, WhatsApp), and conversation flow. Billog API is a REST backend that OpenClaw skills call to manage expenses and ledger.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER                                     │
│                  (LINE / WhatsApp / etc.)                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        OPENCLAW                                  │
│                   (Agent Framework)                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Channels: LINE, WhatsApp, Telegram, Discord, etc.      │   │
│  │  • Receive messages                                      │   │
│  │  • Download media (receipts)                             │   │
│  │  • Route to agent                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  AI Agent (Claude / GPT)                                 │   │
│  │  • Natural language understanding                        │   │
│  │  • Context management                                    │   │
│  │  • Tool orchestration                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Billog Skill (SKILL.md)                                 │   │
│  │  • Instructions for expense tracking                     │   │
│  │  • API endpoint definitions                              │   │
│  │  • Response formatting rules                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
└──────────────────────────────┼──────────────────────────────────┘
                               │ HTTP (REST API)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BILLOG API SERVER                           │
│                        (NestJS)                                 │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  REST Endpoints                                          │   │
│  │  POST /expenses          - Create expense (with items)   │   │
│  │  PUT  /expenses/:id      - Update expense                │   │
│  │  GET  /expenses          - Query expenses                │   │
│  │  POST /expenses/:id/items - Add items                    │   │
│  │  GET  /balances/:sourceId - Get group balances          │   │
│  │  POST /settlements       - Record payment                │   │
│  │                                                          │   │
│  │  Note: OCR is handled by OpenClaw (GPT-4o Vision)       │   │
│  │  Billog API receives extracted data, not images          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Services                                                │   │
│  │  • ExpenseService                                        │   │
│  │  • LedgerModule (Account, Transfer, Balance)            │   │
│  │  • UserService                                           │   │
│  │  • UploadService (receipts)                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL                                │
│                  (TigerBeetle-style Ledger)                     │
│                                                                  │
│  accounts, transfers, expenses, expense_items, users, sources   │
└─────────────────────────────────────────────────────────────────┘
```

---

## OpenClaw Skill Integration

Skills in OpenClaw are defined via `SKILL.md` files that instruct the AI on capabilities.

### Billog Skill Location
```
~/.openclaw/workspace/skills/billog/
└── SKILL.md
```

### Skill Definition Example
```markdown
---
name: billog
description: Bookkeeping AI for expense tracking and bill splitting
metadata: {"openclaw": {"requires": {"env": ["BILLOG_API_URL"]}}}
---

# Billog Bookkeeping Skill

You are a smart bookkeeper. Use the Billog API to manage expenses.

## API Endpoints

Base URL: {env.BILLOG_API_URL}

### Create Expense
POST /expenses
Body: { sourceId, paidById, amount, currency, description, categoryId?, splits? }

### Get Balances
GET /balances/{sourceId}?ledger={currency}
Returns who owes whom in a group.

### Record Settlement
POST /settlements
Body: { sourceId, fromUserId, toUserId, amount, currency, paymentMethod? }

## Response Format

Always respond with compact confirmations:
✅ {description} | {currency}{amount} | {category}
   → @{user} owes {amount}
   EX:{expenseId}
```

---

## Message Flow (with OpenClaw)

### Text Message Flow
```
1. User sends "lunch 500 @all" in LINE group
       ↓
2. OpenClaw LINE channel receives message
       ↓
3. OpenClaw agent processes with Billog skill context
       ↓
4. Agent calls Billog API:
   POST /expenses
   {
     "sourceId": "line_group_123",
     "paidById": "user_abc",
     "amount": 500,
     "currency": "THB",
     "description": "lunch",
     "splits": [{"userId": "all", "type": "equal"}]
   }
       ↓
5. Billog API:
   - Creates Expense record
   - Auto-creates Accounts for group members
   - Creates Transfer entries for splits
   - Returns expense with splits
       ↓
6. Agent formats response:
   "✅ lunch | ฿500 | Split 3 ways
    → @tom owes ฿167
    → @jerry owes ฿167
    EX:exp_abc123"
       ↓
7. OpenClaw sends reply to LINE group
```

### Receipt Image Flow
```
1. User sends receipt image in LINE group
       ↓
2. OpenClaw LINE channel downloads image
       ↓
3. OpenClaw agent uses GPT-4o Vision to extract:
   - Store name, address
   - Items with prices
   - Currency (auto-detect from location)
   - Total amount
       ↓
4. Agent calls Billog API with extracted data:
   POST /expenses
   {
     "sourceId": "line_group_123",
     "paidById": "user_abc",
     "amount": 1200,
     "currency": "THB",
     "description": "Big C",
     "receipt": {
       "storeName": "Big C",
       "storeAddress": "Bangkok"
     },
     "items": [
       {"name": "Rice", "quantity": 1, "unitPrice": 50, "ingredientType": "grain"},
       {"name": "Milk", "quantity": 2, "unitPrice": 45, "ingredientType": "dairy"}
     ]
   }
       ↓
5. Billog API creates Expense + ExpenseItems + Receipt record
       ↓
6. Agent responds with confirmation
```

---

## User & Source Resolution

OpenClaw provides context about WHO sent the message and WHERE:

```typescript
// OpenClaw message context includes:
{
  SenderId: "Uxxxxxxxxxxxxxxxx",        // LINE user ID
  From: "line:group:Cxxxxxxxxxxxxxxxx", // Source identifier
  ChatType: "group" | "direct",
  GroupSubject: "Cxxxxxxxxxxxxxxxx",    // Group ID (if group)
}
```

### How Billog API Handles This

Billog skill passes channel context to API. Billog API resolves/creates records:

```
POST /expenses
{
  "channel": "LINE",                    // Channel type
  "channelUserId": "Uxxxxxxxxxxxxxxxx", // LINE user ID (sender)
  "channelSourceId": "Cxxxxxxxxxxxxxxxx", // LINE group ID
  ...
}
```

**Billog API Resolution Flow:**
```
1. Receive request with channel context
       ↓
2. Resolve/create Source:
   - Look up Source by [channel, channelId]
   - If not exists, create Source record
       ↓
3. Resolve/create User:
   - Look up UserIdentity by [channel, channelId]
   - If not exists, create User + UserIdentity
       ↓
4. Resolve/create SourceMember:
   - Link User to Source if not already member
       ↓
5. Auto-create Accounts (TigerBeetle):
   - Create Account for this user in this source
   - Unique: [ledger, userId, sourceId, code]
       ↓
6. Proceed with expense creation
```

### Data Model for Multi-User

```
User (internal)
├── id: "usr_abc123"
├── name: "Tawan"
└── identities:
    ├── UserIdentity { channel: LINE, channelId: "Uxxxx" }
    └── UserIdentity { channel: WHATSAPP, channelId: "66812345678@s.whatsapp.net" }

Source (group/DM)
├── id: "src_xyz789"
├── channel: LINE
├── channelId: "Cxxxxxxxxxxxxxxxx"
├── type: GROUP
└── members:
    ├── SourceMember { userId: "usr_abc123", nickname: "Tawan" }
    └── SourceMember { userId: "usr_def456", nickname: "Wife" }

Account (per user per source per currency)
├── { userId: "usr_abc123", sourceId: "src_xyz789", ledger: THB, code: ASSET }
└── { userId: "usr_abc123", sourceId: "src_xyz789", ledger: THB, code: LIABILITY }
```

### @mention Resolution

For bill splitting with @mentions:

```
User: "lunch 500 @all"
User: "coffee 120 @tom @jerry"
```

The skill needs to resolve @mentions to user IDs:

**Option 1: Skill fetches group members from OpenClaw**
- OpenClaw may have LINE group member list
- Skill maps @nickname to channel user ID
- Passes resolved user IDs to Billog API

**Option 2: Billog API resolves nicknames**
- API receives @nicknames
- Looks up SourceMember by nickname in that source
- Resolves to internal user IDs

**Option 3: Special keywords**
- `@all` = split with all source members
- `@me` = the sender
- Billog API handles these keywords

---

## Data Model

### Entity Relationship

```
┌─────────────────────────────────────────────────────────────────┐
│                        IDENTITY LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User ◄────────► UserIdentity                                   │
│   │              (LINE ID, WhatsApp JID)                        │
│   │                                                              │
│   ├──► SourceMember ◄────► Source                               │
│   │    (role, nickname)    (DM or Group)                        │
│   │                                                              │
│   └──► PaymentMethod                                            │
│        (cash, card, PromptPay)                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        EXPENSE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Expense ◄────► ExpenseItem                                     │
│   │             (name, qty, price, ingredientType, assignedTo)  │
│   │                                                              │
│   ├──► Receipt (OCR data, store, confidence)                    │
│   ├──► Category (hierarchical)                                  │
│   ├──► Pool (trip, event grouping)                              │
│   └──► Transfer[] (ledger entries)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   TIGERBEETLE LEDGER LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Account                         Transfer                       │
│  ├── userId                      ├── debit_account_id           │
│  ├── sourceId                    ├── credit_account_id          │
│  ├── ledger (currency)           ├── amount                     │
│  ├── code (ASSET/LIABILITY)      ├── code (SPLIT/SETTLEMENT)    │
│  ├── debits_posted               ├── expenseId                  │
│  └── credits_posted              └── timestamp                  │
│                                                                  │
│  Unique: [ledger, userId, sourceId, code]                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Schema Details

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User profile (name, email, timezone, language) |
| `user_identities` | Channel identities - one user can have LINE + WhatsApp |
| `sources` | Conversation context (DM or Group per channel) |
| `source_members` | User ↔ Source membership with role and nickname |

### Expense Tables

| Table | Purpose |
|-------|---------|
| `expenses` | Main expense record with payer, amount, currency |
| `expense_items` | Line items from receipt with classification |
| `categories` | Hierarchical expense categories |
| `receipts` | OCR data (store, items, confidence) |
| `pools` | Group expenses for trips/events |

### TigerBeetle Ledger

| Table | Purpose |
|-------|---------|
| `account` | Balance tracking per user/source/currency/type |
| `transfer` | Double-entry transactions (always debit + credit) |

**Account Codes:**
```
ASSET     = 100  // Money owed TO you
LIABILITY = 200  // Money you OWE
EXPENSE   = 300  // Spending category tracking
INCOME    = 400  // Income tracking
```

**Transfer Codes:**
```
EXPENSE_SPLIT = 1  // Created when expense is split
SETTLEMENT    = 2  // When someone pays back
ADJUSTMENT    = 3  // Manual corrections
```

**Ledger (Currency):**
```
THB = 1
USD = 2
AUD = 3
EUR = 4
JPY = 5
```

### Bookkeeping & Tax

| Table | Purpose |
|-------|---------|
| `payment_methods` | User's payment methods (cash, cards, PromptPay) |
| `expense_payment_methods` | Link expense to payment method(s) |
| `tax_categories` | Tax deduction categories |
| `category_tax_mappings` | Map expense category → tax category |
| `expense_tax_classifications` | Per-expense tax classification |
| `bookkeeping_reports` | Generated reports (tax, ledger, analysis) |

### Summary/Cache

| Table | Purpose |
|-------|---------|
| `user_summaries` | Cached totals per user/source/period |
| `budgets` | Spending limits per category/source |

---

## Account Auto-Creation

When a user interacts with Billog, accounts are **automatically created** per source:

```
User: @tawan
│
├── WhatsApp DM (source_1)
│   └── Account [THB, ASSET, source_1]
│
├── Family LINE Group (source_2)
│   ├── Account [THB, ASSET, source_2]
│   └── Account [THB, LIABILITY, source_2]
│
├── Japan Trip WhatsApp (source_3)
│   ├── Account [JPY, ASSET, source_3]
│   ├── Account [JPY, LIABILITY, source_3]
│   ├── Account [THB, ASSET, source_3]  // for settlement
│   └── Account [THB, LIABILITY, source_3]
│
└── Share House Group (source_4)
    ├── Account [THB, ASSET, source_4]
    └── Account [THB, LIABILITY, source_4]
```

**Why per source?**
- Money owed in family group ≠ money owed in travel group
- Each source has isolated balances
- Clear audit trail per context

---

## Bill Split Flow (TigerBeetle)

```
Scenario: Alice pays ฿300 for lunch, split with Bob & Carol

1. CREATE EXPENSE
   └── Expense { paidBy: Alice, amount: 300, sourceId: group_1 }

2. AUTO-CREATE ACCOUNTS (if not exist)
   ├── Alice: Account { code: 100 (ASSET), ledger: 1 (THB), sourceId: group_1 }
   ├── Bob:   Account { code: 200 (LIABILITY), ledger: 1 (THB), sourceId: group_1 }
   └── Carol: Account { code: 200 (LIABILITY), ledger: 1 (THB), sourceId: group_1 }

3. CREATE TRANSFERS (code: 1 = EXPENSE_SPLIT)
   ├── Transfer { debit: Bob.LIABILITY, credit: Alice.ASSET, amount: 100 }
   └── Transfer { debit: Carol.LIABILITY, credit: Alice.ASSET, amount: 100 }

4. UPDATE ACCOUNT BALANCES
   ├── Alice.ASSET:    credits_posted += 200  → owed ฿200
   ├── Bob.LIABILITY:  debits_posted += 100   → owes ฿100
   └── Carol.LIABILITY: debits_posted += 100  → owes ฿100
```

---

## Settlement Flow

```
Scenario: Bob pays Alice ฿100 via PromptPay

1. CREATE TRANSFER (code: 2 = SETTLEMENT)
   └── Transfer {
         debit: Alice.ASSET,      // reduces what she's owed
         credit: Bob.LIABILITY,   // reduces what he owes
         amount: 100,
         user_data_32: 5          // PromptPay payment method
       }

2. UPDATE ACCOUNT BALANCES
   ├── Alice.ASSET:   debits_posted += 100  → owed ฿200 → ฿100
   └── Bob.LIABILITY: credits_posted += 100 → owes ฿100 → ฿0 ✓
```

---

## Item-Level Splitting

```
Scenario: Grocery receipt, wife's items are cosmetics and snacks

1. RECEIPT OCR → ExpenseItems
   ├── { name: "Rice", price: 50, ingredientType: "grain" }
   ├── { name: "Milk", price: 45, ingredientType: "dairy" }
   ├── { name: "Lipstick", price: 200, ingredientType: null, assignedTo: wife_id }
   └── { name: "Chips", price: 35, ingredientType: "snack", assignedTo: wife_id }

2. CALCULATE SPLITS
   ├── Husband's items: ฿95 (rice + milk)
   └── Wife's items: ฿235 (lipstick + chips)

3. CREATE TRANSFER
   └── Transfer { debit: Wife.LIABILITY, credit: Husband.ASSET, amount: 235 }
```

---

## Multi-Currency (Travel)

```
Scenario: Japan trip, paid ¥4,800 for dinner, friend settles in THB

1. IN JAPAN - Create expense in JPY
   └── Expense { amount: 4800, currency: "JPY", ledger: 5 }
   └── Transfer { ledger: 5 (JPY), amount: 1200 per person }

2. BACK HOME - Friend pays in THB
   User: "paid 500 baht"

   Option A: Direct settlement (manual rate)
   └── Transfer { ledger: 1 (THB), code: 2, amount: 500 }
   └── Mark JPY balance as settled

   Option B: Track both currencies
   └── User has JPY liability and THB settlement recorded
```

---

## Receipt Handling

Receipt images are processed by **OpenClaw** (not Billog API):

1. **OpenClaw** downloads image from LINE/WhatsApp
2. **OpenClaw** uses GPT-4o Vision to extract receipt data
3. **OpenClaw** calls Billog API with structured data (not image)
4. **Billog API** stores receipt metadata (store name, items) - not the image file

```
OpenClaw handles:
├── Image download (LINE Data API, WhatsApp Baileys)
├── Image storage (if needed)
├── OCR via GPT-4o Vision
└── Extracted data → Billog API

Billog API receives:
├── storeName, storeAddress
├── items[] with prices and ingredientType
├── currency (auto-detected)
└── total amount
```

---

## Ledger Service Implementation

The ledger follows TigerBeetle patterns with PostgreSQL + Prisma.

### Module Structure

```
services/ledger/
├── constants.ts        # All codes, flags, helper functions
├── account.service.ts  # Account CRUD with auto-creation
├── transfer.service.ts # Atomic double-entry transfers
├── balance.service.ts  # Balance queries + debt optimization
└── ledger.module.ts    # NestJS module
```

### Constants (constants.ts)

```typescript
// Currency partitions
export const LEDGER = {
  THB: 1, USD: 2, AUD: 3, EUR: 4, JPY: 5
} as const;

// Account types
export const ACCOUNT_CODE = {
  ASSET: 100,      // Money owed TO user
  LIABILITY: 200,  // Money user OWES
  EXPENSE: 300,    // Spending tracking
  INCOME: 400,     // Income tracking
  EQUITY: 500,     // Balancing entries
} as const;

// Transfer types
export const TRANSFER_CODE = {
  EXPENSE_SPLIT: 1,      // Expense creates debt
  SETTLEMENT: 2,         // Payment clears debt
  ADJUSTMENT: 3,         // Manual correction
  REVERSAL: 4,           // Undo a transfer
  POOL_CONTRIBUTION: 5,  // Pool payment
  POOL_WITHDRAWAL: 6,    // Pool expense
} as const;

// TigerBeetle-compatible flags (bitmask)
export const ACCOUNT_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0,
  DEBITS_MUST_NOT_EXCEED_CREDITS: 1 << 1,
  CREDITS_MUST_NOT_EXCEED_DEBITS: 1 << 2,
  HISTORY: 1 << 3,
  CLOSED: 1 << 5,
} as const;

export const TRANSFER_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0,
  PENDING: 1 << 1,
  POST_PENDING_TRANSFER: 1 << 2,
  VOID_PENDING_TRANSFER: 1 << 3,
} as const;

// Payment method codes (for settlement user_data_32)
export const PAYMENT_METHOD = {
  CASH: 1, BANK_TRANSFER: 2, PROMPTPAY: 3,
  CREDIT_CARD: 4, EWALLET: 5, OTHER: 99
} as const;

// Helpers
currencyToLedger(currency: string): LedgerCode
ledgerToCurrency(ledger: LedgerCode): string
formatUserData128(userId, sourceId): string  // "userId:sourceId"
getNanoTimestamp(): bigint  // TigerBeetle uses nanoseconds
```

### AccountService (account.service.ts)

```typescript
// Key pattern: idempotent account creation
async getOrCreateAccount(params: {
  ledger: LedgerCode;
  code: AccountCode;
  userId: string;
  sourceId: string;
}) {
  // Uses unique constraint: [ledger, userId, sourceId, code]
  const existing = await prisma.account.findUnique({
    where: { ledger_userId_sourceId_code: { ... } }
  });
  if (existing) return existing;
  return this.createAccount(params);
}

// Balance calculation differs by account type
getAccountBalance(account, code: AccountCode): Decimal {
  if (code === ASSET) {
    return credits_posted - debits_posted;  // positive = owed TO user
  } else if (code === LIABILITY) {
    return debits_posted - credits_posted;  // positive = user OWES
  }
}
```

### TransferService (transfer.service.ts)

```typescript
// Atomic transfer: creates transfer + updates both accounts in transaction
async createTransfer(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: Decimal;
  ledger: LedgerCode;
  code: TransferCode;
  expenseId?: string;      // FK to expense
  userData32?: number;     // Payment method for settlements
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Create transfer record
    const transfer = await tx.transfer.create({ ... });

    // 2. Update debit account (increase debits_posted)
    await tx.account.update({
      where: { id: debitAccountId },
      data: { debits_posted: { increment: amount } }
    });

    // 3. Update credit account (increase credits_posted)
    await tx.account.update({
      where: { id: creditAccountId },
      data: { credits_posted: { increment: amount } }
    });

    return transfer;
  });
}

// Batch: all succeed or all fail
async createLinkedTransfers(transfers: CreateTransferParams[])

// Two-phase commit support
async createPendingTransfer(params)   // Phase 1: reserve
async postPendingTransfer(pendingId)  // Phase 2: commit
async voidPendingTransfer(pendingId)  // Phase 2: rollback
```

### BalanceService (balance.service.ts)

```typescript
// Get user's position in a source
async getUserBalances(userId, sourceId, ledger): Promise<{
  asset: Decimal;      // Money owed TO user
  liability: Decimal;  // Money user OWES
  net: Decimal;        // asset - liability
}>

// Get all users' balances in a group
async getGroupBalances(sourceId, ledger): Promise<Map<userId, UserBalance>>

// Optimal debt settlement (minimizes transactions)
async getDebts(sourceId, ledger): Promise<BalanceEntry[]> {
  // 1. Get all balances
  // 2. Separate creditors (positive net) and debtors (negative net)
  // 3. Sort by amount (largest first)
  // 4. Match creditors with debtors optimally
  // Returns: [{ from: debtor, to: creditor, amount }]
}

// Check if expense is fully settled
async isExpenseSettled(expenseId): Promise<boolean>
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20, TypeScript |
| Backend | NestJS 11 |
| AI | VoltAgent + OpenAI GPT-4o |
| Database | PostgreSQL + Prisma |
| Queue | BullMQ + Redis |
| Channels | WhatsApp (Baileys), LINE (Webhook) |

---

## Key Files

```
app/
├── src/
│   ├── agent/
│   │   ├── agent.service.ts        # VoltAgent setup
│   │   ├── prompt.service.ts       # Dynamic prompts
│   │   └── tools/                  # AI tools (expense, balance, receipt)
│   ├── channels/
│   │   ├── whatsapp/               # Baileys adapter
│   │   └── line/                   # LINE webhook adapter
│   ├── services/
│   │   ├── ledger/
│   │   │   ├── constants.ts        # All codes, flags, helpers
│   │   │   ├── account.service.ts  # Account CRUD + getOrCreateAccount
│   │   │   ├── transfer.service.ts # Atomic transfers + two-phase commit
│   │   │   ├── balance.service.ts  # Balance queries + debt optimization
│   │   │   └── ledger.module.ts    # NestJS module
│   │   ├── expense/                # Expense business logic
│   │   └── user/                   # User/identity resolution
│   └── workflow/
│       └── handlers/               # Text, Receipt, Reply handlers
├── prisma/
│   └── schema.prisma               # Database schema
└── tests/
```
