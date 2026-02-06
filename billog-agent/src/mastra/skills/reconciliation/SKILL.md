---
name: reconciliation
description: Knowledge for adjusting and correcting expenses - reassign items, update prices, fix splits
version: 1.0.0
trigger: When user quotes expense, says "fix", "change", "wrong", "remove", "add to", or references EX:id
tags: [reconciliation, corrections, adjustments, editing]
---

# Expense Reconciliation Knowledge

You help users adjust and correct existing expenses while maintaining proper audit trails.

## Trigger Conditions

Activate this skill when user:
- Quotes a message containing `EX:xxx` expense ID
- Uses correction words: fix, change, wrong, edit, update
- Wants to reassign: "change X to @person"
- Wants to update: "actually was X", "should be X"
- Wants to remove: "remove X", "delete X"
- Wants to add: "forgot X", "add X"

## Thai Input Recognition

| Pattern | Meaning |
|---------|---------|
| แก้ไข / แก้ | edit/fix |
| ผิด / ไม่ใช่ | wrong/not correct |
| เปลี่ยน | change |
| ลบ / เอาออก | remove/delete |
| เพิ่ม / ลืม | add/forgot |
| ของ @name | belongs to @name |
| จริงๆ | actually |
| อันนั้น / อันนี้ | that one/this one |

## Identifying Expenses

Expenses are identified by ID in format `EX:abc123` which appears in confirmation messages. When user quotes a message containing this ID, extract it for reconciliation.

## Adjustment Types

### reassign_item
Change who an item is assigned to.
```
User: "change milk to @tom"
→ Reassign milk item from current assignee to @tom
```

### update_item
Update quantity or price of an item.
```
User: "chips was actually 45 not 35"
→ Update chips unitPrice to 45
```

### add_item
Add a missing item to the expense.
```
User: "forgot to add bread 25 baht @wife"
→ Add new item: bread, 25 THB, assigned to @wife
```

### remove_item
Remove an item from the expense.
```
User: "remove the beer, we returned it"
→ Remove beer item, recalculate total
```

### remove_from_split
Remove a person from equal split.
```
User: "tom wasn't there, remove him"
→ Remove tom from split, redistribute among others
```

### add_to_split
Add a person to equal split.
```
User: "add @jerry to the split"
→ Include jerry in split, recalculate shares
```

### update_amount
Change total amount (for non-itemized expenses).
```
User: "total was actually 500"
→ Update expense amount to 500
```

### update_category
Change expense category.
```
User: "this should be groceries not food"
→ Change category to Groceries
```

## Response Format

Always show:
1. Expense reference (EX:id)
2. What changed (item-by-item)
3. New total if amount changed
4. Adjustment summary per person (delta from previous)

### Example Response
```
Updated 7-Eleven (EX:abc123)
- Milk: @wife → @tom
- Chips: qty 1 → 2 (+35 THB)
- Removed: Beer x6 (-324 THB)
New total: 161 THB

Adjustments:
- Tawan: +25 THB
- Wife: -180 THB
- Tom: -81 THB
```

## Important Rules

1. **Audit Trail**: All adjustments create ADJUSTMENT type transfers, never delete existing ledger entries
2. **Recalculation**: After any change, recalculate all splits based on current items/assignments
3. **Delta Only**: Only create adjustment transfers for the DIFFERENCE, not the full amount
4. **Confirmation**: For large adjustments (>500 THB delta), confirm before applying
5. **Quote Context**: The expense ID comes from quoted message - look for `EX:` pattern
6. **Preserve Item Names**: Keep original item names as-is (don't translate)

## Bulk Corrections

Users may request multiple changes at once:
```
User: "fix: milk to @me, chips x2, remove beer"

→ Apply all adjustments in one reconciliation call:
   - reassign_item: milk to sender
   - update_item: chips quantity to 2
   - remove_item: beer
```

Process all changes together and show combined adjustment summary.
