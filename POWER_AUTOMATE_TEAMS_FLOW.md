# Power Automate: AURORA Teams Notifier Flow

## What This Does

The Aurora backend sends a structured email to `poc@alignedautomation.com` every time a workflow event happens (reimbursement, leave, announcement, etc.). Each email has:
- **Subject**: `[AURORA] {event_type} — {detail}`
- **Body**: contains an HTML comment `<!-- PA_JSON: {"event": "...", ...data...} -->`

This Power Automate flow watches that mailbox, reads the JSON, and posts the right Teams message. No premium connectors needed.

---

## Event Types

| `event` value | What happened |
|---|---|
| `reimbursement_submitted` | Employee submitted a reimbursement |
| `reimbursement_decision` | Admin approved/rejected a reimbursement |
| `parking_activated` | Admin issued a parking sticker |
| `parking_revoked` | Admin revoked a parking sticker |
| `facility_complaint` | Employee filed a facility complaint |
| `food_complaint` | Employee filed a food/cafeteria complaint |
| `announcement_created` | HR/admin published an announcement |
| `leave_approved` | Manager approved an employee leave |

---

## Step-by-Step Build

### Step 1 — Create the Flow

1. Go to [make.powerautomate.com](https://make.powerautomate.com) → **My flows** → **+ New flow** → **Automated cloud flow**
2. Name: `AURORA Teams Notifier`
3. Trigger: search **"Office 365 Outlook — When a new email arrives (V3)"**
4. Click **Create**

---

### Step 2 — Configure the Trigger

In the trigger card:

| Field | Value |
|---|---|
| Folder | `Inbox` |
| Subject Filter | `[AURORA]` |
| Include Attachments | No |
| Only with Attachments | No |
| Importance | Any |

---

### Step 3 — Extract the PA_JSON Block

Add action: **Data Operation → Compose**

Name the step: `Extract PA_JSON string`

In **Inputs**, switch to expression mode and paste:

```
base64ToString(first(split(last(split(triggerBody()?['body'], 'PAJSON:')), ':ENDJSON')))
```

This extracts the base64-encoded JSON from the hidden div and decodes it to a JSON string.

> **Why base64?** Exchange HTML-encodes `"` to `&quot;` inside div text, breaking JSON parsing. Base64 only contains alphanumeric chars and `+/=` which Exchange never touches, so the decoded string is always clean JSON.

---

### Step 4 — Parse the JSON

Add action: **Data Operation → Parse JSON**

- **Content**: `outputs('Compose')`
- **Schema**: paste this:

```json
{
  "type": "object",
  "properties": {
    "event": { "type": "string" },
    "employee_name": { "type": "string" },
    "employee_email": { "type": "string" },
    "amount": { "type": "string" },
    "category": { "type": "string" },
    "status": { "type": "string" },
    "reason": { "type": "string" },
    "sticker_number": { "type": "string" },
    "vehicle_number": { "type": "string" },
    "complaint_description": { "type": "string" },
    "leave_type": { "type": "string" },
    "from_date": { "type": "string" },
    "to_date": { "type": "string" },
    "title": { "type": "string" },
    "message": { "type": "string" }
  }
}
```

Name the step: `Parse PA_JSON`

---

### Step 5 — Switch on the Event

Add action: **Control → Switch**

- **On** (expression): `body('Parse_JSON')?['event']`

Add one **Case** per event below. Inside each Case add **Microsoft Teams → Post a message in a chat or channel** (Post as: Flow bot, Post in: Channel, pick your team/channel).

---

#### Case: `reimbursement_submitted`
```
**New Reimbursement Request**
Employee: [employee_name]
Amount: [amount]
Category: [category]
```

#### Case: `reimbursement_decision`
```
**Reimbursement Decision**
Employee: [employee_name]
Status: [status]
Reason: [reason]
```

#### Case: `parking_activated`
```
**Parking Sticker Issued**
Employee: [employee_name]
Sticker #: [sticker_number]
Vehicle: [vehicle_number]
```

#### Case: `parking_revoked`
```
**Parking Sticker Revoked**
Employee: [employee_name]
Vehicle: [vehicle_number]
```

#### Case: `facility_complaint`
```
**Facility Complaint Filed**
Employee: [employee_name]
Description: [complaint_description]
```

#### Case: `food_complaint`
```
**Food Complaint Filed**
Employee: [employee_name]
Description: [complaint_description]
```

#### Case: `announcement_created`
```
📢 New Announcement
[title]

[message]
```

#### Case: `leave_approved`
```
**Leave Approved**
Employee: [employee_email]
Type: [leave_type]
Dates: [from_date] → [to_date]
```

---

### Step 6 — Delete the Email

After the Switch block, add action: **Office 365 Outlook → Delete email (V2)**

- **Message Id**: `triggerBody()?['id']`

---

## Full Flow Order

```
[Trigger]  When new email arrives (V3) — subject filter: [AURORA]
    ↓
[Compose]  Extract PA_JSON string
    ↓
[Parse JSON]  Parse PA_JSON
    ↓
[Switch]  on event field
    ├── reimbursement_submitted  → Teams message
    ├── reimbursement_decision   → Teams message
    ├── parking_activated        → Teams message
    ├── parking_revoked          → Teams message
    ├── facility_complaint       → Teams message
    ├── food_complaint           → Teams message
    ├── announcement_created     → Teams message
    └── leave_approved           → Teams message
    ↓
[Delete email (V2)]
```

---

## Connectors Used (all Standard — no Premium)

| Connector | Action |
|---|---|
| Office 365 Outlook | When a new email arrives (V3) |
| Data Operation | Compose |
| Data Operation | Parse JSON |
| Control | Switch |
| Microsoft Teams | Post a message in a chat or channel |
| Office 365 Outlook | Delete email (V2) |

---

## Testing

1. Trigger any event in Aurora UI (e.g., submit a reimbursement)
2. Check `poc@alignedautomation.com` inbox — email should arrive with `[AURORA]` subject
3. Open PA flow run history — confirm it ran successfully
4. Check your Teams channel — message should appear
5. Confirm the email was deleted from the inbox

---

## Important Notes

- `NOTIFICATION_EMAIL` env var on the backend must match the mailbox the O365 trigger watches (`poc@alignedautomation.com`)
- The backend currently uses **Gmail SMTP** (`smtp.gmail.com`). If emails are landing in a Gmail inbox instead of O365, either:
  - Switch the backend SMTP to Office 365 (`smtp.office365.com`, port 587), **or**
  - Use **Gmail → When a new email arrives** as the trigger instead of the O365 one
