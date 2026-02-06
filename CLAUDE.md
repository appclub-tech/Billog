# Billog - AI Bookkeeper

AI-powered expense tracking and bill splitting through chat apps.

## Project Structure

```
billog/
├── billog-agent/        # Mastra AI Agent (handles LINE/WhatsApp)
│   └── src/mastra/
│       ├── agents/      # Billog agent definition
│       ├── tools/       # API interaction tools
│       ├── gateway/     # Channel adapters (LINE, WhatsApp)
│       └── skills/      # Domain knowledge (SKILL.md)
├── billog-api/          # NestJS API Server
│   ├── app/             # Backend (NestJS + Prisma + PostgreSQL)
│   └── web/             # Frontend (Next.js) - TODO
├── skills/              # Legacy OpenClaw-format skills (reference)
├── reference-openclaw/  # OpenClaw docs for reference
└── docker-compose.yml   # Docker deployment
```

## Architecture

```
LINE/WhatsApp
    │
    ▼
┌─────────────────────────────────────────────────┐
│ Billog Agent (Mastra)                           │
│ https://billoggateway.ngrok.app                │
│                                                 │
│ ┌─────────────┐    ┌──────────────────────────┐ │
│ │ Gateway     │───►│ Billog Agent (GPT-4o)    │ │
│ │ LINE/WA     │    │ - Expense recording      │ │
│ │ Adapters    │◄───│ - Bill splitting         │ │
│ └─────────────┘    │ - Balance tracking       │ │
│                    └──────────────────────────┘ │
└─────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Billog API (NestJS) │
              │ http://billog-api   │ (internal)
              │                     │
              │ - Expense CRUD      │
              │ - Ledger (double-   │
              │   entry accounting) │
              │ - User management   │
              └─────────────────────┘
                         │
                         ▼
                   PostgreSQL
```

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Development (local)
pnpm dev        # API server
pnpm dev:agent  # Mastra Studio
```

## Billog Agent (Mastra)

### Gateway
- `gateway/adapters/line.ts` - LINE webhook + reply
- `gateway/adapters/whatsapp.ts` - WhatsApp via Baileys
- `gateway/router.ts` - Message routing with session isolation

### Tools (API Interactions)
- `createExpense` - Record expenses with items/splits
- `getExpenses` - Query expense history
- `deleteExpense` - Remove expenses
- `getBalances` - Who owes whom
- `getSpendingSummary` - Spending by category/period
- `getMyBalance` - Personal balance
- `recordSettlement` - Track payments
- `initSource` - Setup group/DM
- `syncMembers` - Update member list
- `setNickname` - Set @nickname

## Billog API (NestJS)

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/expenses | Create expense |
| GET | /api/expenses | List expenses |
| GET | /api/expenses/:id | Get expense |
| DELETE | /api/expenses/:id | Delete expense |
| POST | /api/expenses/:id/reconcile | Adjust expense |
| GET | /api/balances | Get group balances |
| POST | /api/settlements | Record payment |
| POST | /api/sources/init | Initialize source |
| GET | /api/insights/summary | Spending summary |

## Environment Variables

```bash
# Root .env
OPENAI_API_KEY=sk-...
NGROK_AUTHTOKEN=...
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
BILLOG_JWT_SECRET=your-secret

# billog-api/app/.env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

## Development

```bash
# Install dependencies
pnpm install

# Database migrations
cd billog-api/app && pnpm prisma migrate dev

# Type check agent
pnpm --filter billog-agent exec tsc --noEmit
```

## URLs

| Service | URL |
|---------|-----|
| Billog Gateway | https://billoggateway.ngrok.app |
| Billog API | https://billog-api.ngrok.app (optional) |
| LINE Webhook | https://billoggateway.ngrok.app/webhook/line |
| Health Check | https://billoggateway.ngrok.app/health |

## Thai Language Support

Billog supports Thai and English. Common phrases:
- "กาแฟ 65" → Record coffee expense 65 THB
- "ใครเป็นหนี้" → Show balances
- "จ่ายแล้ว 350" → Record settlement
- "@all" / "หารกัน" → Split equally

## Claude Code Rules

### DO NOT (saves tokens)
- **NEVER run `docker` commands** - just provide the command for user to run
- Read `node_modules/` - use type definitions only
- Read lock files (pnpm-lock.yaml, package-lock.json)
- Read large generated files (dist/, build/, .next/)
- Read migration files unless debugging migrations
- Read binary files (images, fonts)

### DO
- Use `tsc --noEmit` for type checking
- Provide docker commands for user to copy/paste
- Read source files in `src/` directly
- Check `.claudeignore` for ignored paths

### Type Checking
```bash
# billog-agent
cd billog-agent && pnpm exec tsc --noEmit

# billog-api
cd billog-api && pnpm exec tsc --noEmit
```

### When User Says "rebuild" or "restart"
Provide command: `docker compose up -d --build [service]`
