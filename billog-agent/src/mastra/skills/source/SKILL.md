---
name: source
description: Source initialization and context management
version: 1.0.0
trigger: Automatic - router handles this before agent processes any message
tags: [source, initialization, context, ledger]
---

# Billog Source Management

## Step 0: Automatic Initialization

**The router handles source initialization BEFORE you process any message.**

When a message arrives:
1. Router calls `/sources/init` API
2. Creates Source (group/DM) if new
3. Creates User if new
4. Adds User as member of Source
5. Creates ledger accounts (ASSET/LIABILITY per user per source)

**You do NOT need to call init-source** - it's already done.

## Context Available

Every message includes a [Context] block with:
```
[Context]
Channel: LINE | WHATSAPP | TELEGRAM
SenderChannelId: user's channel ID
SourceChannelId: group/DM channel ID
IsGroup: true | false
SenderName: display name
SourceName: group name
```

**These are automatically injected into tool calls via RequestContext.**

## When to Use init-source Tool

Only call init-source manually if:
- User explicitly asks to "set up billog" or "reinitialize"
- Need to update source name or settings

## Ledger Context

Each Source has isolated ledger accounts:
- Users in Group A have separate balances from Group B
- Money owed in "Family" group ≠ money owed in "Friends" group
- Each currency is tracked separately (THB, USD, JPY, etc.)

## Account Types

| Code | Type | Purpose |
|------|------|---------|
| 100 | ASSET | Money owed TO user |
| 200 | LIABILITY | Money user OWES |
| 300 | EXPENSE | Spending categories |
| 400 | INCOME | Income tracking |

## Source Types

| Type | Description |
|------|-------------|
| GROUP | Multi-user chat (LINE group, WhatsApp group) |
| DM | Direct message (1:1 chat) |
