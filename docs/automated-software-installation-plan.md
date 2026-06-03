# Automated Software Installation — Implementation Plan

## Context

Employees needing to install software with admin privileges currently have to approach the IT team for credentials manually. This creates delays, security risks (shared admin passwords), and no audit trail. This plan automates the process via Centriq chatbot → IT approval → ManageEngine Endpoint Central auto-deployment, where **no admin password is ever shared**.

---

## Architecture

```
Employee → Centriq Chatbot → "I need to install VS Code"
                                    ↓
                        Match to Software Catalog
                                    ↓
                        Auto-approve? ──→ Yes → Skip to deployment
                            ↓ No
                        Create Approval Request
                                    ↓
                        IT Approver Notification (Email)
                                    ↓
                        Approve / Reject (via dashboard or email link)
                                    ↓ (if approved)
                        Centriq Backend → ManageEngine Endpoint Central API
                                    ↓
                        Endpoint Central deploys installer to employee's machine
                                    ↓
                        Installer runs with SYSTEM privileges
                                    ↓
                        Result logged → Employee notified
```

---

## Database Changes

### Table: `software_catalog`

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| name | VARCHAR | Software name (e.g., "VS Code") |
| version | VARCHAR | Version string |
| category | VARCHAR | productivity, development, communication, etc. |
| endpoint_central_package_id | VARCHAR | Maps to the package ID in ManageEngine |
| installer_hash | VARCHAR | SHA-256 hash for verification |
| auto_approve | BOOLEAN | Skip IT approval for low-risk apps |
| requires_license | BOOLEAN | Whether a license key is needed |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

### Table: `installation_requests`

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| employee_id | FK → employees | Who requested |
| software_id | FK → software_catalog | What was requested |
| machine_hostname | VARCHAR | Target machine identifier |
| reason | TEXT | Why they need it |
| status | ENUM | pending / approved / rejected / deploying / deployed / failed |
| requested_at | TIMESTAMP | When request was made |
| reviewed_by | FK → employees | IT approver |
| reviewed_at | TIMESTAMP | When approved/rejected |
| rejection_reason | TEXT | Why it was rejected (if applicable) |
| deployment_job_id | VARCHAR | ManageEngine deployment job ID |
| deployed_at | TIMESTAMP | When deployment completed |
| deployment_log | TEXT | Result/error from ManageEngine |
| approval_token | VARCHAR | One-time token for email approve/reject links |
| approval_expires_at | TIMESTAMP | Token expiry (24 hours from request) |

---

## Backend Components

### 1. ManageEngine Endpoint Central Service

**File:** `backend/app/services/manage_engine_service.py`

```
class ManageEngineService:
    - get_device_by_hostname(hostname) → device_id
        # GET /api/1.4/som/computers?searchValue={hostname}
    
    - deploy_package(package_id, device_id) → job_id
        # POST /api/1.4/som/softwaredeployment
    
    - get_deployment_status(job_id) → status
        # GET /api/1.4/som/softwaredeployment/{job_id}
    
    - execute_script(device_id, script_content) → job_id
        # POST /api/1.4/som/scripts/execute (fallback for custom installs)
```

**Config needed in environment:**
- `MANAGE_ENGINE_BASE_URL` — API base URL
- `MANAGE_ENGINE_API_KEY` — Technician auth token

### 2. Installation Request Routes

**File:** `backend/app/routes/installation_routes.py`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/installation-requests` | Create new request |
| GET | `/api/installation-requests` | List requests (filterable by status) |
| GET | `/api/installation-requests/{id}` | Get request details |
| PATCH | `/api/installation-requests/{id}/approve` | Approve request (triggers deployment) |
| PATCH | `/api/installation-requests/{id}/reject` | Reject request |
| GET | `/api/installation-requests/approve/{token}` | One-click approve via email link |
| GET | `/api/installation-requests/reject/{token}` | One-click reject via email link |

### 3. Software Catalog Routes

**File:** `backend/app/routes/software_catalog_routes.py`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/software-catalog` | List all available software |
| POST | `/api/software-catalog` | Add new software entry |
| PATCH | `/api/software-catalog/{id}` | Update software entry |
| DELETE | `/api/software-catalog/{id}` | Deactivate software entry |

### 4. IT Agent Tool Enhancement

**Modify:** IT domain agent in `backend/app/agents/`

Add tool function: `request_software_installation(software_name, reason)`
- Fuzzy match `software_name` against software catalog
- Look up employee's machine hostname from session/profile
- Create installation request
- If `auto_approve` → immediately trigger deployment
- Otherwise → send approval notification email
- Return status message to employee

### 5. Notification Integration

Use existing email service (`shivam.sharma@alignedautomation.com` via Office 365 SMTP):

**On request created (to IT approver):**
- Employee name, software requested, reason
- One-click Approve / Reject links (tokenized)

**On approved (to employee):**
- "Your request for {software} has been approved. Installation is starting."

**On deployed (to employee):**
- "Installation of {software} on your machine is complete."

**On rejected (to employee):**
- "Your request for {software} was not approved. Reason: {reason}"

**On failed (to IT + employee):**
- "Installation of {software} failed. Error: {details}"

---

## Frontend Components

### 1. IT Admin Dashboard — Installation Requests

**File:** New route in settings/admin area

- **Pending Approvals Tab:** List of pending requests with approve/reject buttons
- **History Tab:** All past requests with status, timestamps, who approved
- **Filters:** By status, employee, software, date range

### 2. Software Catalog Management

**File:** New route in settings/admin area

- Add/edit/remove software entries
- Toggle auto-approve per app
- View Endpoint Central package ID mapping

### 3. Employee View (Optional)

- "My Requests" section showing status of their installation requests
- Or simply show status via chatbot when asked

---

## Security Controls

| Control | Implementation |
|---|---|
| No credential exposure | Employee never receives any admin password |
| Installer verification | SHA-256 hash check before deployment |
| Audit trail | Every request, approval, and deployment logged with timestamps |
| One-time deployment | Each approval maps to exactly one deployment |
| Approval expiry | Approval tokens expire after 24 hours |
| Role-based access | Only designated IT approvers can approve/reject |
| Tokenized approval links | One-time-use UUIDs for email approve/reject links |
| Scoped API access | ManageEngine API token restricted to managed device groups |

---

## Implementation Phases

### Phase 1 — Database & Models
- Create `software_catalog` and `installation_requests` tables
- Add SQLAlchemy models
- Run migrations

### Phase 2 — ManageEngine Integration
- Build `ManageEngineService` with device lookup and deployment methods
- Test API connectivity with pilot device and test package
- Handle auth, error responses, retries

### Phase 3 — Backend Routes
- Installation request CRUD routes
- Software catalog CRUD routes
- Approval/rejection endpoints with token validation

### Phase 4 — Approval Workflow
- Email notifications on request creation (to IT approver)
- One-click approve/reject via tokenized email links
- Status update notifications to employee
- Approval expiry logic

### Phase 5 — Chatbot Integration
- Add `request_software_installation` tool to IT agent
- Fuzzy matching against software catalog
- Employee-friendly status responses

### Phase 6 — Frontend Dashboard
- Admin view for pending approvals and history
- Software catalog management UI

### Phase 7 — Production Rollout
- Expand ManageEngine scope to all managed devices
- Add more software packages to catalog
- Assign production IT approvers
- Configure auto-approve for common low-risk apps

---

## Prerequisites (Before Implementation)

Refer to `docs/it-team-setup-guide.md` for the complete IT team setup guide.

**What we need from IT team:**
1. ManageEngine Endpoint Central API base URL
2. API authentication token (scoped to pilot device group)
3. Test software package ID (e.g., Notepad++)
4. Network access confirmation (Centriq backend → ME API)

---

## Verification / Testing

1. Add test app to software catalog → request via chatbot → verify approval email sent
2. Click approve link in email → verify ManageEngine API called with correct package + device
3. Verify installer runs on target machine with SYSTEM privileges
4. Verify employee receives completion notification
5. Reject a request → verify employee gets rejection notification
6. Wait 24 hours → verify expired approval token is rejected
7. Check audit trail captures full request lifecycle
8. Verify employee never sees any admin credentials at any point
