# IT Team Setup Guide — Automated Software Installation (Pilot)

## Overview

We are building an automated software installation request system where employees can request software through the company chatbot, IT approves with one click, and ManageEngine Endpoint Central deploys the software automatically — **no admin credentials are ever shared with employees**.

This guide covers what the IT team needs to configure for a **single-device pilot** to validate the system before production rollout.

---

## Step 1: Create a Pilot Computer Group

1. Open **ManageEngine Endpoint Central** web console
2. Go to **Admin** → **Scope of Management (SoM)** → **Computer Groups**
3. Click **Create Custom Group**
4. Name it: `Pilot - Automated Install`
5. Add **only the pilot test machine** (Shivam Sharma's device) to this group
6. Save the group

> This ensures the API can only target this one device during the pilot.

---

## Step 2: Enable the REST API

1. Go to **Admin** → **Integrations** → **API Explorer** (or **API Settings**)
2. Enable the REST API if not already enabled
3. Note down the **base URL** of the API (e.g., `https://<your-server>:8020/api/`)

---

## Step 3: Generate an API Key (Technician Token)

1. Go to **Admin** → **Technicians**
2. Either create a new technician account or use an existing one:
   - **Name:** `Centriq Service Account` (or similar)
   - **Role:** Custom role with the following permissions only:
     - Software Deployment — Deploy/Install
     - Inventory — View Computers
     - Custom Scripts — Execute (optional, for fallback)
3. **Scope:** Restrict this technician to the `Pilot - Automated Install` computer group created in Step 1
4. Generate an **API authentication token** for this technician:
   - Go to **Admin** → **Integrations** → **API Explorer**
   - Or generate via: **Technician Profile** → **Generate Auth Token**
5. Copy and securely share the token

### What We Need From This Step
- API base URL
- Authentication token
- Technician username (if required for auth)

---

## Step 4: Create a Test Software Package

1. Go to **Software Deployment** → **Packages** → **Add Package**
2. Create a package for a simple, safe application:
   - **Package Name:** `Notepad++ (Pilot Test)`
   - **Installer:** Upload the latest Notepad++ `.exe` installer (download from official site)
   - **Installation Type:** Silent install
   - **Silent install command:** `npp.<version>.Installer.x64.exe /S`
   - **Install as:** System User
3. Save the package
4. Note down the **Package ID** (visible in the URL or package details)

> Feel free to use any other low-risk app instead (7-Zip, VLC, etc.)

### What We Need From This Step
- Package ID of the test software

---

## Step 5: Network / Firewall Access

Ensure the following network connectivity:

| From | To | Port | Purpose |
|---|---|---|---|
| Centriq backend server | ManageEngine Endpoint Central server | 8020 (or configured HTTPS port) | API calls |

If the Centriq backend is hosted on a different network/cloud, the IT team may need to:
- Whitelist the Centriq server IP in ManageEngine's allowed connections
- Open the API port in the firewall

### What We Need From This Step
- Confirmation that the Centriq backend IP is whitelisted (if applicable)
- Confirm the exact port number for API access

---

## Step 6: Verify the Setup

Once Steps 1-5 are complete, we will run this quick verification:

1. **Test API connectivity** — Call the device list API to confirm we can reach Endpoint Central
2. **Test device lookup** — Query the pilot machine by hostname to confirm scope works
3. **Test deployment** — Deploy the Notepad++ package to the pilot machine
4. **Verify installation** — Confirm Notepad++ installed successfully on the pilot machine
5. **Check audit log** — Verify the deployment appears in Endpoint Central's logs

---

## Summary: What We Need From IT Team

| Item | Details |
|---|---|
| API Base URL | e.g., `https://me-server:8020/api/` |
| API Auth Token | Technician token scoped to pilot group |
| Test Package ID | Package ID of the Notepad++ (or equivalent) package |
| Pilot Group Created | Computer group with only the test machine |
| Network Access Confirmed | Centriq server can reach ME API endpoint |

---

## Security Assurances

- **Scope:** API access is restricted to one machine only during pilot
- **No credential sharing:** Employees will never see or receive any admin password
- **Audit trail:** Every deployment is logged in both Centriq and Endpoint Central
- **One-time deployment:** Each approval results in exactly one installation
- **Read + deploy only:** The API token has no permissions to modify configs, uninstall software, or access other machines

---

## After Successful Pilot

Once the pilot is validated and demoed:
1. Expand the computer group to include more devices (or all managed devices)
2. Add more software packages to the catalog
3. Assign IT approvers for the production approval workflow
4. Enable employee access through the Centriq chatbot

---

*For questions about this setup, contact: Shivam Sharma*
