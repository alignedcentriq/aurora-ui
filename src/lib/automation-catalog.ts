export type AutomationCategory = "Report" | "Reminder" | "Digest" | "Alert" | "Custom";

export interface CatalogParam {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "toggle";
  options?: { value: string; label: string }[];
  default?: any;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
}

export interface CatalogItem {
  id: string;                  // → automation_kind in backend
  label: string;
  description: string;
  emailPreview: string;        // what the email will show
  category: AutomationCategory;
  accent: string;
  portalIds: string[];         // [] = show in all portals
  params: CatalogParam[];
  defaultFrequency: "daily" | "weekly" | "monthly";
  defaultDayOfWeek?: number;
  defaultDayOfMonth?: number;
  defaultHour: number;
  defaultSubject: string;
}

export const AUTOMATION_CATALOG: CatalogItem[] = [

  // ────────── Reports ───────────────────────────────────────────────
  {
    id: "leave_balance_report",
    label: "Team Leave Balance Report",
    description: "Leave balances for your reporting hierarchy (Super Admins get org-wide)",
    emailPreview: "Available, used, and remaining leave days per leave type — scoped to your team",
    category: "Report", accent: "#16A34A",
    portalIds: ["hr-portal", "leadership-command"],
    params: [],
    defaultFrequency: "monthly", defaultDayOfMonth: 1, defaultHour: 9,
    defaultSubject: "Team Leave Balance Report — {{month}} {{year}}",
  },
  {
    id: "attendance_summary",
    label: "Team Attendance Summary",
    description: "Present/absent/WFH breakdown for the reporting period",
    emailPreview: "Attendance counts by status, late-arrival list, and per-employee rows",
    category: "Report", accent: "#16A34A",
    portalIds: ["hr-portal", "leadership-command"],
    params: [
      {
        key: "period", label: "Report period", type: "select",
        options: [
          { value: "last_week", label: "Last 7 days" },
          { value: "last_month", label: "Last 30 days" },
          { value: "current_month", label: "Current month to date" },
        ],
        default: "last_week",
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 0, defaultHour: 8,
    defaultSubject: "Team Attendance Summary — Week ending {{date}}",
  },
  {
    id: "it_ticket_digest",
    label: "IT Ticket Backlog Report",
    description: "Open IT support tickets grouped by priority and age",
    emailPreview: "P1/P2/P3 counts, tickets aging >7 days, and top 10 unresolved issues",
    category: "Report", accent: "#3B82F6",
    portalIds: ["it-portal"],
    params: [
      {
        key: "include_in_progress", label: "Include In Progress tickets", type: "toggle",
        default: true,
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 0, defaultHour: 8,
    defaultSubject: "IT Ticket Status Report — Week {{week}}",
  },
  {
    id: "bench_utilization_report",
    label: "Bench & Utilization Report",
    description: "Bench headcount, billable utilization, and upcoming rolloffs",
    emailPreview: "Bench count, utilization %, skills on bench, and deployment-ready resources",
    category: "Report", accent: "#06B6D4",
    portalIds: ["pmo-portal", "leadership-command"],
    params: [],
    defaultFrequency: "monthly", defaultDayOfMonth: 5, defaultHour: 9,
    defaultSubject: "Bench & Utilization Report — {{month}} {{year}}",
  },
  {
    id: "training_compliance_report",
    label: "Training Compliance Report",
    description: "Who has and hasn't completed mandatory TechElevate training",
    emailPreview: "Completion rates, overdue learner list, and upcoming deadlines",
    category: "Report", accent: "#7C3AED",
    portalIds: ["pmo-portal", "te-lms"],
    params: [
      {
        key: "overdue_only", label: "Show overdue assignments only", type: "toggle",
        default: false,
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 1, defaultHour: 9,
    defaultSubject: "Training Compliance Report — {{date}}",
  },
  {
    id: "inactive_udemy_digest",
    label: "Inactive Udemy Learners",
    description: "Employees who haven't accessed Udemy Business in N days",
    emailPreview: "Name, last login date, group, and idle day count for each inactive learner",
    category: "Report", accent: "#A435F0",
    portalIds: ["udemy-business"],
    params: [
      {
        key: "inactive_days", label: "Inactive for more than", type: "number",
        default: 14, min: 7, max: 90, hint: "days",
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 1, defaultHour: 9,
    defaultSubject: "Udemy Inactive Learners Report — {{date}}",
  },
  {
    id: "project_status_report",
    label: "Project Delivery Status Report",
    description: "Active project listing with allocation and delivery data",
    emailPreview: "Project name, delivery manager, status, and team size for active projects",
    category: "Report", accent: "#8B5CF6",
    portalIds: ["pmo-portal", "leadership-command"],
    params: [
      {
        key: "active_only", label: "Active allocations only", type: "toggle",
        default: true,
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 0, defaultHour: 8,
    defaultSubject: "Project Delivery Status — Week {{week}}",
  },

  // ────────── Reminders ─────────────────────────────────────────────
  {
    id: "leave_approval_reminder",
    label: "Pending Leave Approvals",
    description: "Remind HR/managers of leave requests waiting for action",
    emailPreview: "Employee name, leave type, requested dates, and days count — one row per pending request",
    category: "Reminder", accent: "#16A34A",
    portalIds: ["hr-portal"],
    params: [
      {
        key: "pending_days_min", label: "Only include requests pending for more than", type: "number",
        default: 0, min: 0, max: 30, hint: "days (0 = all pending)",
      },
    ],
    defaultFrequency: "daily", defaultHour: 9,
    defaultSubject: "Pending Leave Requests — {{count}} Awaiting Approval",
  },
  {
    id: "expense_cutoff_reminder",
    label: "Expense Reimbursement Cutoff",
    description: "Remind employees to submit expenses before the monthly cutoff",
    emailPreview: "Cutoff date, submission link, and step-by-step instructions",
    category: "Reminder", accent: "#00a29a",
    portalIds: ["admin-portal"],
    params: [
      {
        key: "cutoff_day", label: "Monthly cutoff on day", type: "number",
        default: 20, min: 1, max: 28, hint: "of the month",
      },
      {
        key: "send_days_before", label: "Send reminder", type: "number",
        default: 3, min: 1, max: 10, hint: "days before cutoff",
      },
    ],
    defaultFrequency: "monthly", defaultDayOfMonth: 17, defaultHour: 10,
    defaultSubject: "Expense Reimbursement Cutoff — Submit by {{date}}",
  },
  {
    id: "onboarding_pending_reminder",
    label: "Onboarding Steps Pending",
    description: "Remind HR and new joiners about incomplete onboarding steps",
    emailPreview: "Joiner name, pending step name, and expected completion date",
    category: "Reminder", accent: "#7C3AED",
    portalIds: ["onboarding-tracker", "hr-portal"],
    params: [
      {
        key: "stalled_days", label: "Show journeys stalled for more than", type: "number",
        default: 2, min: 0, max: 14, hint: "days",
      },
    ],
    defaultFrequency: "daily", defaultHour: 9,
    defaultSubject: "Onboarding Steps Pending — {{count}} Journeys Need Attention",
  },
  {
    id: "training_due_reminder",
    label: "Training Deadline Reminder",
    description: "Remind learners about upcoming mandatory TechElevate training deadlines",
    emailPreview: "Training name, assigned-to, due date, and current completion % for each near-due assignment",
    category: "Reminder", accent: "#7C3AED",
    portalIds: ["te-lms", "pmo-portal"],
    params: [
      {
        key: "due_within_days", label: "Remind for assignments due within", type: "number",
        default: 7, min: 1, max: 30, hint: "days",
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 1, defaultHour: 9,
    defaultSubject: "Training Deadline Reminder — Due in {{days}} Days",
  },

  // ────────── Digests ────────────────────────────────────────────────
  {
    id: "team_learning_digest",
    label: "Team Learning Digest",
    description: "Weekly summary of team training completions, progress, and overdue learners",
    emailPreview: "Completed courses, in-progress with %, and overdue assignments per team member",
    category: "Digest", accent: "#A435F0",
    portalIds: ["te-lms", "udemy-business", "pmo-portal"],
    params: [
      {
        key: "source", label: "Include training from", type: "select",
        options: [
          { value: "te_lms", label: "TechElevate LMS only" },
          { value: "udemy", label: "Udemy Business only" },
          { value: "both", label: "Both platforms" },
        ],
        default: "te_lms",
      },
    ],
    defaultFrequency: "weekly", defaultDayOfWeek: 4, defaultHour: 17,
    defaultSubject: "Team Learning Digest — Week {{week}}",
  },
  {
    id: "workforce_readiness_digest",
    label: "Workforce Readiness Digest",
    description: "Bench availability, skill gaps, and allocation snapshot for leadership",
    emailPreview: "Total headcount, bench count, top bench skills, and recent rolloffs",
    category: "Digest", accent: "#06B6D4",
    portalIds: ["leadership-command", "pmo-portal"],
    params: [],
    defaultFrequency: "weekly", defaultDayOfWeek: 0, defaultHour: 7,
    defaultSubject: "Workforce Readiness Digest — Week {{week}}",
  },

  // ────────── Alerts ─────────────────────────────────────────────────
  {
    id: "it_overdue_tickets_alert",
    label: "IT Overdue Tickets Alert",
    description: "Alert when IT tickets are unresolved beyond the SLA threshold",
    emailPreview: "Ticket ID, subject, priority, age in days, and assigned-to for each overdue ticket",
    category: "Alert", accent: "#3B82F6",
    portalIds: ["it-portal"],
    params: [
      {
        key: "overdue_days", label: "Alert for tickets open more than", type: "number",
        default: 5, min: 1, max: 30, hint: "days",
      },
      {
        key: "min_priority", label: "Minimum priority", type: "select",
        options: [
          { value: "Critical", label: "Critical only" },
          { value: "High", label: "High and above" },
          { value: "Medium", label: "Medium and above" },
        ],
        default: "High",
      },
    ],
    defaultFrequency: "daily", defaultHour: 9,
    defaultSubject: "IT SLA Alert — {{count}} Overdue Tickets",
  },

  // ────────── Custom ─────────────────────────────────────────────────
  {
    id: "custom_email",
    label: "Custom Email",
    description: "Write your own subject and message, delivered on your schedule",
    emailPreview: "Exactly what you type — no data pulled from the system",
    category: "Custom", accent: "#64748B",
    portalIds: [],
    params: [],
    defaultFrequency: "weekly", defaultDayOfWeek: 0, defaultHour: 9,
    defaultSubject: "",
  },
];

export function getCatalogItem(id: string): CatalogItem | undefined {
  return AUTOMATION_CATALOG.find((c) => c.id === id);
}

export function getCatalogForPortal(portalId?: string): CatalogItem[] {
  if (!portalId) return AUTOMATION_CATALOG;
  return AUTOMATION_CATALOG.filter(
    (c) => c.portalIds.length === 0 || c.portalIds.includes(portalId),
  );
}

export const CATEGORY_ORDER: AutomationCategory[] = [
  "Report",
  "Reminder",
  "Digest",
  "Alert",
  "Custom",
];

export const CATEGORY_META: Record<AutomationCategory, { color: string; description: string }> = {
  Report: { color: "#16A34A", description: "Pull live data and send a formatted snapshot" },
  Reminder: { color: "#F59E0B", description: "Notify people about upcoming actions or deadlines" },
  Digest: { color: "#6366F1", description: "Recurring summaries that keep teams informed" },
  Alert: { color: "#EF4444", description: "Immediate notification when thresholds are breached" },
  Custom: { color: "#64748B", description: "Write your own email delivered on a schedule" },
};
