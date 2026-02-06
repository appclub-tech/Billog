---
name: onboarding
description: First interaction flow, welcome messages, help commands, source initialization
version: 1.0.0
trigger: First message in new group/DM, "help", "start", greeting, or bot added to group
tags: [onboarding, welcome, help, initialization]
---

# Onboarding & Help

Guide for first interactions and help commands.

## Trigger Conditions

Activate this skill when:
- User sends first message in a new group/DM
- User says: "help", "start", "hi", "hello", greeting
- Bot is added to a group
- User asks "what can you do", "how to use"

## First Interaction Flow

When user sends first message (any message) in a new source:

1. **Call init-source tool** with context values
2. Check response: `isNewSource`, `isNewUser`
3. Show appropriate welcome message

### New Group Response
```
Welcome to Billog!
Group: {sourceName}
Members: {memberCount}

Quick start:
- "coffee 65" → Record expense
- "lunch 600 @all" → Split with everyone
- "who owes" → Check balances
- "help" → See all commands
```

### New User (Existing Group) Response
```
Welcome {senderName}!
You're now part of {sourceName}.

Start recording: "coffee 65"
```

### Already Initialized Response
Just process the user's actual request (don't show welcome again).

## Help Command

When user asks for help, show available commands:

```
Billog Commands

Record expense:
  "coffee 65" → Quick expense
  "lunch 200 Food" → With category
  [receipt photo] → Auto-extract

Split bills:
  "@all" → Split with everyone
  "@tom @jerry" → Split with specific people
  "tom 300, jerry 200" → Exact amounts

Check balances:
  "who owes" → Group balances
  "my balance" → Personal balance

Settle up:
  "tom paid me 350" → Record payment
  "paid jerry 200" → You paid someone

Other:
  "call me boss" → Set nickname
  "speak Thai" → Change language
```

## Nickname Setup

When user wants to set nickname:
- "call me X", "my name is X", "set nickname X"
- Call set-nickname tool
- Confirm: "Nickname set: @{nickname}"

## Language Setup

When user wants to change language:
- "speak Thai", "speak English", "use Thai"
- Call set-user-language tool
- Confirm in the new language

## Thai Input Recognition

| Pattern | Meaning |
|---------|---------|
| สวัสดี / หวัดดี | Hello (greeting) |
| ช่วยด้วย / help | Help command |
| เริ่มต้น / start | Start/initialize |
| วิธีใช้ | How to use |

## Source Types

| Type | Context |
|------|---------|
| DM | Personal expense tracking |
| GROUP | Bill splitting with members |

## Important Notes

1. **Always init before transactions** - If source doesn't exist, init first
2. **Accounts auto-created** - Each user gets ASSET + LIABILITY accounts per source
3. **Nicknames enable @mentions** - Encourage users to set nicknames
4. **WhatsApp syncs members** - Use sync-members when members change
5. **LINE builds dynamically** - Members added as they interact
