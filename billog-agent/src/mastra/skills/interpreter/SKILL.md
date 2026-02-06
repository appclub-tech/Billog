---
name: interpreter
description: Translates agent responses to user's preferred language while preserving expense data
version: 1.0.0
trigger: Always active - applies to all responses based on user language preference
tags: [translation, localization, thai, english]
---

# Response Interpreter

Translate agent responses to user's preferred language from RESPONSE LANGUAGE section.

## Translation Rules

### MUST Translate
- Confirmation messages ("Recorded", "Updated", "Deleted")
- Labels ("Category", "Total", "Balance", "Paid by")
- Error messages
- Questions and prompts
- Date formats (use locale-appropriate format)

### MUST NOT Translate
- Expense item names (keep original: "กาแฟลาเต้", "Pad Thai")
- Store names (keep original: "7-Eleven", "โลตัส")
- User nicknames (@tom, @wife)
- Expense IDs (EX:abc123)
- Currency symbols and amounts

## Language Templates

### English Response
```
{description} | {currency}{amount}
Category: {category}
EX:{expenseId}
```

### Thai Response
```
{description} | {currency}{amount}
หมวด: {category}
EX:{expenseId}
```

## Label Translations

| English | Thai |
|---------|------|
| Recorded | บันทึกแล้ว |
| Updated | แก้ไขแล้ว |
| Deleted | ลบแล้ว |
| Category | หมวด |
| Total | รวม |
| Subtotal | ยอดย่อย |
| Balance | ยอดค้าง |
| Paid by | จ่ายโดย |
| owes | ค้าง |
| paid | จ่ายแล้ว |
| Settlement recorded | บันทึกการชำระแล้ว |
| Remaining | คงเหลือ |
| All settled | หมดหนี้แล้ว |
| Error | ผิดพลาด |
| Not found | ไม่พบข้อมูล |
| Group Balances | ยอดค้างกลุ่ม |
| Net | สุทธิ |
| Date | วันที่ |
| Items | รายการ |
| Adjustments | ปรับยอด |
| New total | ยอดใหม่ |

## Category Translations

| English | Thai |
|---------|------|
| Food | อาหาร |
| Transport | เดินทาง |
| Groceries | ของใช้ |
| Utilities | สาธารณูปโภค |
| Entertainment | บันเทิง |
| Shopping | ช้อปปิ้ง |
| Health | สุขภาพ |
| Education | การศึกษา |
| Travel | ท่องเที่ยว |
| Housing | ที่อยู่อาศัย |
| Personal | ส่วนตัว |
| Gift | ของขวัญ |
| Other | อื่นๆ |

## Date Formatting

| Language | Format | Example |
|----------|--------|---------|
| English | DD MMM YYYY | 5 Feb 2025 |
| Thai | D MMM YYYY | 5 ก.พ. 2568 |

## Examples

### Receipt Confirmation (Thai user)
```
บันทึกแล้ว: 7-Eleven | ฿245
หมวด: ของใช้
5 ก.พ. 2568
───────────
- นมสด x2 @ 35 = 70
- ขนมปัง x1 @ 45 = 45
- Lay's Original x2 @ 65 = 130
───────────
EX:abc123
```

Note: Item names "นมสด", "ขนมปัง", "Lay's Original" kept as-is from receipt.

### Receipt Confirmation (English user)
```
Recorded: 7-Eleven | ฿245
Category: Groceries
5 Feb 2025
───────────
- นมสด x2 @ 35 = 70
- ขนมปัง x1 @ 45 = 45
- Lay's Original x2 @ 65 = 130
───────────
EX:abc123
```

Note: Same item names preserved, only labels translated.

### Balance Query (Thai user)
```
ยอดค้างกลุ่ม (THB)
─────────────────
@tom ค้าง @wife ฿350
@jerry ค้าง @wife ฿200
─────────────────
สุทธิ: wife +550 | tom -350 | jerry -200
```

### Balance Query (English user)
```
Group Balances (THB)
─────────────────
@tom owes @wife ฿350
@jerry owes @wife ฿200
─────────────────
Net: wife +550 | tom -350 | jerry -200
```
