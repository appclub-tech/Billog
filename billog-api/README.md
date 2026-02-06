# Billog

> **Your AI Bookkeeper in Chat**

Billog is a smart AI bookkeeper that manages money flow through your everyday chat apps (WhatsApp, LINE). It handles expense tracking, bill splitting, and proper double-entry accounting - all through natural conversation.

## Architecture

Billog works with **OpenClaw** (agent framework):

```
OpenClaw (Agent + Channels)
    │
    └── Billog Skill ──HTTP──► Billog API Server (NestJS)
                                    │
                                    └── PostgreSQL (Ledger)
```

- **OpenClaw** handles AI agent, LINE/WhatsApp channels, conversation flow
- **Billog API** is a NestJS REST backend for expense/ledger operations
- **Billog Skill** teaches OpenClaw how to call Billog API

---

## Use Cases

### 1. Group Chat - Bill Splitting

**Share House**
```
You: "Rent 15000 @all"
Billog: ✅ Rent | ฿15,000 | Split 3 ways
        → @tom owes ฿5,000
        → @jerry owes ฿5,000
        EX:exp_abc123
```

**Travel with Friends** (domestic or overseas)
```
# In Japan - you pay for dinner
You: [sends receipt image]
Billog: ✅ Ichiran Ramen | ¥4,800 | 4 people
        → @friend1 owes ¥1,200
        → @friend2 owes ¥1,200
        → @friend3 owes ¥1,200

# Back home - friend settles up
Friend: "paid @you 500 baht"
Billog: ✅ Settlement recorded
        → @friend1 balance: ¥1,200 → ฿0 ✓
```

Multi-currency is essential - pay in JPY, get paid back in THB or JPY.

### 2. Household - Item-Level Splitting

Same receipt, different payers:
```
You: [sends grocery receipt]
Billog: ✅ Big C | ฿1,200 | 8 items

You: "wife's items are the cosmetics and snacks"
Billog: ✅ Updated splits:
        → Your items: ฿850 (groceries, household)
        → @wife's items: ฿350 (cosmetics, snacks)
        EX:exp_def456
```

### 3. Personal DM - Expense Tracking

No receipt? AI collects the info:
```
You: "bought a speaker"
Billog: Got it! A few quick questions:
        - How much was it?
        - Where did you buy it?
        - Category: Electronics?

You: "3500 from lazada, yes electronics"
Billog: ✅ Speaker | ฿3,500 | Electronics | Lazada
        EX:exp_ghi789
```

For tax deductions and proper bookkeeping.

### 4. Smart Receipt OCR

Upload any receipt - AI extracts everything:
- Store name & location
- Individual items with prices
- **Auto-detects currency** from store location (Thai store → THB, Japanese store → JPY)
- **Item classification** (banana → fruit, milk → dairy, dog food → pet)

This data enables future insights:
- Zero waste tracking (food categories)
- Tax/GST deductible item identification
- Spending patterns by item type

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         CHAT                                 │
│   LINE  •  WhatsApp  •  (Telegram/Discord coming soon)      │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      BILLOG AI                               │
│                                                              │
│  "bought coffee 120"     →  Expense + Category              │
│  [receipt image]         →  OCR + Items + Currency          │
│  "split with @tom"       →  Ledger Transfers                │
│  "tom paid me back"      →  Settlement                      │
│                                                              │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 DOUBLE-ENTRY LEDGER                          │
│                                                              │
│  Every money movement = debit + credit pair                 │
│  Balances always sum to zero (accounting integrity)         │
│  Full audit trail for all transactions                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Natural Language** | Thai/English auto-detect, conversational interface |
| **Multi-Currency** | THB, USD, AUD, EUR, JPY with auto-detection |
| **Receipt OCR** | GPT-4o Vision extracts store, items, prices |
| **Item Classification** | Categorize items (fruit, dairy, pet, etc.) |
| **Bill Splitting** | @mention, percentage, or item-level splits |
| **Reply-to-Edit** | Quote any expense message to modify (EX:xxx) |
| **Double-Entry Accounting** | TigerBeetle-style ledger with full audit trail |
| **Settlement Tracking** | Record payments, track who owes whom |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20, TypeScript |
| Backend | NestJS 11 |
| AI | VoltAgent + OpenAI GPT-4o |
| Database | PostgreSQL + Prisma |
| Queue | BullMQ + Redis |
| Channels | WhatsApp, LINE |

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis
- OpenAI API key

### Installation

```bash
cd app

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Database setup
pnpm prisma generate
pnpm prisma migrate dev

# Start development
pnpm dev
```

### Docker

```bash
# Development (with hot reload + monitoring)
pnpm docker:dev

# Production
docker compose up -d
```

### Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
OPENAI_API_KEY=sk-...

# LINE (optional)
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...

# WhatsApp (optional)
WHATSAPP_ENABLED=true
```

---

## Project Structure

```
billog-app/
├── app/                    # NestJS backend
│   ├── src/
│   │   ├── agent/          # VoltAgent + AI tools
│   │   ├── channels/       # LINE, WhatsApp adapters
│   │   ├── services/
│   │   │   └── ledger/     # Double-entry accounting
│   │   └── workflow/       # Message handlers
│   ├── prisma/
│   │   └── schema.prisma
│   └── tests/
├── web/                    # Next.js frontend
└── docker-compose.yml
```

---

## Documentation

- [Architecture Deep Dive](./app/docs/ARCHITECTURE.md)
- [Claude Code Context](./CLAUDE.md)

---

## License

MIT
