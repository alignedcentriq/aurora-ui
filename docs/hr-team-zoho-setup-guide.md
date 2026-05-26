# HR Team Setup Guide — Zoho People API Access (Centriq Integration)

## Overview

We are integrating Zoho People with the Centriq chatbot so employees can check their leave balance, apply for leave, and view attendance — all through the assistant. This requires creating an API client in Zoho's API Console.

This is a **one-time setup** that takes about 5 minutes.

---

## Prerequisites

- Access to [Zoho API Console](https://api-console.zoho.com/) — the person performing this setup must be a **Zoho Admin** for your organization
- The Zoho People subscription must be active

---

## Step 1: Open Zoho API Console

1. Go to **https://api-console.zoho.com/**
2. Sign in with the **organization's Zoho admin account**

---

## Step 2: Create a New API Client

1. Click **"Add Client"** (top-right area)
2. Select **"Server-based Applications"**

---

## Step 3: Fill in Client Details

| Field | Value |
|---|---|
| **Client Name** | `Centriq` |
| **Homepage URL** | `http://localhost:8080` |
| **Authorized Redirect URI** | `http://localhost:8080/api/integrations/callback/zoho` |

> **Note:** The redirect URI will change when the app goes to production. We will update it at that time. For now, use the localhost URL for testing.

3. Click **"Create"**

---

## Step 4: Copy the Credentials

After creating the client, Zoho will display:

- **Client ID** — a long alphanumeric string (e.g., `1000.ABC123XYZ456...`)
- **Client Secret** — another long string (e.g., `abc123def456...`)

**Copy both values** and share them securely (do NOT share via email or chat — use a password manager, sealed envelope, or in-person).

---

## Step 5: Share the Following with Shivam

| Item | Description |
|---|---|
| **Client ID** | Starts with `1000.` followed by alphanumeric characters |
| **Client Secret** | Alphanumeric string shown alongside Client ID |

That's all we need. No further action is required from the HR team.

---

## What Permissions Does This Grant?

The app will request the following permissions when an employee connects their account:

| Permission | What It Does |
|---|---|
| **Leave — Read** | View employee's own leave balance and leave history |
| **Leave — Apply** | Submit leave requests on behalf of the employee |
| **Attendance — Read** | View attendance/check-in records |
| **Forms — Read** | Read employee profile data (name, department, etc.) |

### Important:
- Each employee will **individually authorize** the app when they connect their Zoho account from the Centriq Settings page
- The app **cannot** access any employee's data without their explicit consent
- Employees can **disconnect** their account at any time from Settings
- The app **cannot** modify organization settings, delete data, or access admin functions
- All tokens are **encrypted at rest** in our database

---

## Security Assurances

| Concern | Answer |
|---|---|
| Can the app access all employees' data? | No — only employees who explicitly connect their account |
| Can employees disconnect? | Yes — one click in Settings removes all access |
| Is data stored securely? | Yes — OAuth tokens are AES-encrypted at rest |
| Can the app modify Zoho settings? | No — it only has read/apply permissions for leaves and attendance |
| What happens if an employee leaves? | Their connected account is removed with their profile |

---

## After This Setup

Once we receive the Client ID and Client Secret:
1. We configure them in the application
2. Employees will see a "Connect Zoho People" option in their Settings page
3. Clicking it opens Zoho's consent screen where they authorize access
4. After connecting, the chatbot can answer questions like:
   - *"How many leaves do I have left?"*
   - *"Apply for casual leave on June 5th"*
   - *"Show my attendance for this week"*

---

## FAQ

**Q: Do we need to pay extra for API access?**
A: No — Zoho People API access is included in all paid Zoho People plans.

**Q: Will this affect our existing Zoho setup?**
A: No — creating an API client does not change any existing configurations, users, or settings.

**Q: Can we revoke access later?**
A: Yes — go to Zoho API Console → click on the Centriq client → click "Delete". This immediately revokes all access.

**Q: What if we use zoho.in instead of zoho.com?**
A: Let Shivam know — the API endpoint will need to be changed from `accounts.zoho.com` to `accounts.zoho.in`.

---

*For questions about this setup, contact: Shivam Sharma*
