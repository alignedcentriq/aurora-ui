import {
  Users,
  ClipboardCheck,
  Rocket,
  Shield,
  Sparkles,
  TrendingUp,
  LayoutDashboard,
  Brain,
  Megaphone,
  Activity,
  UserCog,
  Zap,
  Car,
  CalendarDays,
  Ticket,
  GraduationCap,
  Globe,
  BookOpen,
  FileText,
  Database,
  Building2,
  Link2,
  type LucideIcon,
} from "lucide-react";

// Per-portal copilot theming + suggestions. The sidebar copilot is scoped to the portal it's
// opened on (see CopilotSidebar / AssistantView portalContext), so its empty-state heading,
// accent, starter chips, and input placeholders should speak to THAT portal — not the generic
// global assistant. Keyed on the first path segment (e.g. "/directory" → "directory").
// For Control Hub tabs, keyed as "control-hub/{tabId}".
export interface PortalCopilotConfig {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** CSS color (theme var) used for the accent glow + chip hover. */
  accent: string;
  heading: string;
  tagline: string;
  starters: string[];
  placeholders: string[];
}

const CONFIGS: Record<string, PortalCopilotConfig> = {
  directory: {
    key: "directory",
    label: "Directory",
    Icon: Users,
    accent: "var(--connectivity)",
    heading: "Search the directory",
    tagline: "Find people by skill, certification, experience, or project — I'll filter the list.",
    starters: [
      "Filter resources with 5+ years in React",
      "Who is certified in AWS?",
      "Who used Python in the last 3 months?",
      "Who worked on Project Apollo?",
    ],
    placeholders: [
      "Find React developers with 5+ years",
      "Who is certified in Azure?",
      "People skilled in SAP",
      "Who used Node in the last 6 months?",
    ],
  },
  "my-requests": {
    key: "my-requests",
    label: "My Requests",
    Icon: ClipboardCheck,
    accent: "var(--collaboration)",
    heading: "Track your requests",
    tagline: "Filter your leaves, tickets, travel, and claims by type, status, or date.",
    starters: [
      "Find all my leave records from June",
      "Show my pending travel requests",
      "My expense claims this month",
      "Closed requests in 2025",
    ],
    placeholders: [
      "Find all my leave records from June",
      "Show my pending travel requests",
      "My expense claims this month",
      "What's the status of my requests?",
    ],
  },
  onboarding: {
    key: "onboarding",
    label: "Onboarding",
    Icon: Rocket,
    accent: "var(--collaboration)",
    heading: "Your onboarding journey",
    tagline: "Get set up faster — tasks, documents, induction, and who to reach out to.",
    starters: [
      "What are my pending onboarding tasks?",
      "Show the induction videos",
      "How do I upload my documents?",
      "Who do I contact for IT setup?",
    ],
    placeholders: [
      "What's my next onboarding step?",
      "Show the induction videos",
      "How do I upload my documents?",
      "Who is my onboarding buddy?",
    ],
  },

  // ── Control Hub: generic fallback (overview / unknown tab) ─────────────────
  "control-hub": {
    key: "control-hub",
    label: "Control Hub",
    Icon: Shield,
    accent: "var(--clarity)",
    heading: "Operations & insights",
    tagline: "Analytics, training, skill supply, team readiness — or manage roles and access.",
    starters: [
      "Search Udemy courses for Python",
      "Where is our biggest skill-supply gap?",
      "What portals does the HR role have access to?",
      "Who currently has IT role access?",
    ],
    placeholders: [
      "Search Udemy courses for Python",
      "What can the PMO role access?",
      "Show team readiness",
      "Who has access to LLM controls?",
    ],
  },

  // ── Control Hub: per-tab configs ───────────────────────────────────────────
  "control-hub/dashboard": {
    key: "control-hub/dashboard",
    label: "Announcements",
    Icon: Megaphone,
    accent: "#00a29a",
    heading: "Manage announcements",
    tagline: "Post alerts, policy changes, and events to the workspace — or search existing ones.",
    starters: [
      "Create an HR announcement about leave policy",
      "Post an IT outage notice for this evening",
      "Draft a company holiday announcement",
      "Show all active announcements",
    ],
    placeholders: [
      "Create an HR announcement about…",
      "Post an IT outage notice",
      "Show all active announcements",
      "Draft a holiday notice",
    ],
  },

  "control-hub/analytics-builder": {
    key: "control-hub/analytics-builder",
    label: "Analytics Studio",
    Icon: LayoutDashboard,
    accent: "#6366F1",
    heading: "Describe a chart, I'll build it",
    tagline: "Describe any visualization in plain English — iterate, export, and save it to a dashboard.",
    starters: [
      "Create a bar chart of leave by department",
      "Build a pie chart of IT tickets by category",
      "Show headcount trend as a line chart",
      "Plot training completion rates over time",
    ],
    placeholders: [
      "Bar chart of leave by department",
      "Pie chart of IT tickets by category",
      "Headcount trend line chart",
      "Training completion over time",
    ],
  },

  "control-hub/role-control": {
    key: "control-hub/role-control",
    label: "Access Management",
    Icon: UserCog,
    accent: "#F59E0B",
    heading: "Manage roles and permissions",
    tagline: "Grant or revoke capabilities, inspect role trees, and audit who has access to what.",
    starters: [
      "Who has Super Admin access?",
      "What portals can the HR role access?",
      "Add analytics capability to the PMO role",
      "Show all capabilities for Functional Manager",
    ],
    placeholders: [
      "Who has Super Admin access?",
      "HR role capabilities",
      "Add capability to PMO",
      "What can Functional Manager access?",
    ],
  },

  "control-hub/observability": {
    key: "control-hub/observability",
    label: "AI Observability",
    Icon: Activity,
    accent: "#6366F1",
    heading: "Monitor AI usage and quality",
    tagline: "Token usage, latency, failed queries, and feedback triage — all in one view.",
    starters: [
      "Show recent AI errors and failed queries",
      "What's the average response latency?",
      "Which tools are called most frequently?",
      "Show feedback triage — low-rated responses",
    ],
    placeholders: [
      "Recent errors and failed queries",
      "Average response latency",
      "Most-used AI tools",
      "Low-rated responses this week",
    ],
  },

  "control-hub/llm-controls": {
    key: "control-hub/llm-controls",
    label: "LLM Controls",
    Icon: Shield,
    accent: "#F59E0B",
    heading: "Configure AI model settings",
    tagline: "Tweak parameters, override models, and toggle regional routing per domain.",
    starters: [
      "What model is currently active?",
      "Show current temperature and token limits",
      "Which domains use a custom model override?",
      "Show model routing configuration",
    ],
    placeholders: [
      "Current active model?",
      "Temperature and token settings",
      "Domain-level model overrides",
      "Model routing configuration",
    ],
  },

  "control-hub/automation-hub": {
    key: "control-hub/automation-hub",
    label: "Email Automation",
    Icon: Zap,
    accent: "#F59E0B",
    heading: "Configure email automations",
    tagline: "Set up recurring email sequences, triggers, and rule-based actions.",
    starters: [
      "Show all active automation rules",
      "Create a weekly attendance email for managers",
      "What triggers are configured for HR?",
      "Set up a leave approval reminder",
    ],
    placeholders: [
      "Show active automation rules",
      "Weekly attendance email for managers",
      "HR trigger configuration",
      "Leave approval reminder setup",
    ],
  },

  "control-hub/admin-portal": {
    key: "control-hub/admin-portal",
    label: "Admin Services",
    Icon: Car,
    accent: "#00a29a",
    heading: "Admin services dashboard",
    tagline: "Manage transport claims, parking stickers, desk keys, and facility requests.",
    starters: [
      "Show pending transport claims",
      "How many parking stickers are active?",
      "View desk key requests this month",
      "Check open food complaints",
    ],
    placeholders: [
      "Pending transport claims",
      "Active parking stickers",
      "Desk key requests this month",
      "Open food complaints",
    ],
  },

  "control-hub/hr-portal": {
    key: "control-hub/hr-portal",
    label: "HR Portal",
    Icon: CalendarDays,
    accent: "#16A34A",
    heading: "HR operations and leave",
    tagline: "Approve leaves, review payroll, and manage HR policies for your team.",
    starters: [
      "Show all pending leave approvals",
      "How many employees are on leave today?",
      "Download this month's payroll report",
      "Show leave balance summary by team",
    ],
    placeholders: [
      "Pending leave approvals",
      "Who is on leave today?",
      "Payroll report for this month",
      "Leave balance by team",
    ],
  },

  "control-hub/onboarding-tracker": {
    key: "control-hub/onboarding-tracker",
    label: "Onboarding Tracker",
    Icon: Rocket,
    accent: "#7C3AED",
    heading: "Track new joiner onboarding",
    tagline: "See completion status, stuck steps, and send reminders to pending joiners.",
    starters: [
      "Show joiners who haven't completed onboarding",
      "Who joined this month?",
      "Which onboarding steps are most commonly stuck?",
      "Send a reminder to pending joiners",
    ],
    placeholders: [
      "Incomplete onboarding joiners",
      "Who joined this month?",
      "Most stuck onboarding steps",
      "Send reminder to pending joiners",
    ],
  },

  "control-hub/it-portal": {
    key: "control-hub/it-portal",
    label: "IT Support",
    Icon: Ticket,
    accent: "#3B82F6",
    heading: "IT support and device control",
    tagline: "Open tickets, view device status, and triage active support incidents.",
    starters: [
      "Show all open IT tickets",
      "How many high-priority tickets are pending?",
      "Which devices need renewal?",
      "Show tickets raised this week",
    ],
    placeholders: [
      "All open IT tickets",
      "High-priority pending tickets",
      "Devices needing renewal",
      "Tickets raised this week",
    ],
  },

  "control-hub/pmo-portal": {
    key: "control-hub/pmo-portal",
    label: "PMO Portal",
    Icon: GraduationCap,
    accent: "#8B5CF6",
    heading: "Projects, milestones, training",
    tagline: "Monitor delivery status, track milestones, and check training compliance.",
    starters: [
      "Show projects at risk of delay",
      "What's the training compliance rate?",
      "Which milestones are overdue?",
      "Show bench vs. allocated resource split",
    ],
    placeholders: [
      "Projects at risk of delay",
      "Training compliance rate",
      "Overdue milestones",
      "Bench vs. allocated resources",
    ],
  },

  "control-hub/leadership-command": {
    key: "control-hub/leadership-command",
    label: "Capability Command",
    Icon: TrendingUp,
    accent: "#06B6D4",
    heading: "Org-wide workforce intelligence",
    tagline: "Skill gaps, pipeline readiness, SPOF risk, and bench cost — all in one view.",
    starters: [
      "Where is our biggest skill gap right now?",
      "Show the leadership capability heat map",
      "Who are our single-points of failure?",
      "What's our bench cost this quarter?",
    ],
    placeholders: [
      "Biggest skill gap",
      "Capability heat map",
      "Single points of failure",
      "Bench cost this quarter",
    ],
  },

  "control-hub/project-iq": {
    key: "control-hub/project-iq",
    label: "Project IQ",
    Icon: Brain,
    accent: "#0EA5E9",
    heading: "Reuse delivery knowledge",
    tagline: "Find similar past projects, lessons learned, subject experts, and reusable assets.",
    starters: [
      "Find projects similar to a CRM migration",
      "Who are the experts in data engineering?",
      "Show lessons learned from past SAP projects",
      "Find reusable assets for a cloud migration",
    ],
    placeholders: [
      "Similar projects to a CRM migration",
      "Experts in data engineering",
      "Lessons from SAP projects",
      "Reusable assets for cloud migration",
    ],
  },

  "control-hub/te-lms": {
    key: "control-hub/te-lms",
    label: "TechElevate LMS",
    Icon: GraduationCap,
    accent: "#7C3AED",
    heading: "Assign, create and track trainings",
    tagline: "Create in-house courses, assign them to your team, generate MCQ assessments, and track verified skill completion.",
    starters: [
      "Create a training on Azure DevOps for new joiners",
      "Assign Python training to me",
      "Generate 5 MCQ questions for the DevOps course",
      "Who has completed the security training?",
    ],
    placeholders: [
      "Create a training on Azure DevOps",
      "Assign Python training to me",
      "Generate MCQ questions for DevOps course",
      "Security training completion status",
    ],
  },

  "control-hub/udemy-business": {
    key: "control-hub/udemy-business",
    label: "Udemy Business",
    Icon: BookOpen,
    accent: "#A435F0",
    heading: "Browse the Udemy catalog",
    tagline: "Search company Udemy courses, assign them, and check learner activity.",
    starters: [
      "Search Udemy courses for Python",
      "Find top-rated courses on cloud architecture",
      "Show data science courses under 10 hours",
      "What courses are available for project management?",
    ],
    placeholders: [
      "Search Udemy courses for Python",
      "Cloud architecture courses",
      "Short data science courses",
      "Project management courses",
    ],
  },

  "control-hub/manager-portal": {
    key: "control-hub/manager-portal",
    label: "My Team",
    Icon: UserCog,
    accent: "#16A34A",
    heading: "Manage your team",
    tagline: "Review attendance, hierarchy, and team leave requests — all in one place.",
    starters: [
      "Show my team's attendance this week",
      "Who is absent today?",
      "Show my full reporting hierarchy",
      "Which team members have pending leave requests?",
    ],
    placeholders: [
      "Team attendance this week",
      "Who is absent today?",
      "My reporting hierarchy",
      "Pending leave requests in my team",
    ],
  },

  "control-hub/people": {
    key: "control-hub/people",
    label: "People Directory",
    Icon: Users,
    accent: "#00a29a",
    heading: "Browse the people directory",
    tagline: "Search team members by skill, project, department, or certification.",
    starters: [
      "Find React developers in the team",
      "Who leads the IT department?",
      "List all employees in PMO",
      "Show people who joined in the last 3 months",
    ],
    placeholders: [
      "Find React developers",
      "Who leads IT?",
      "All PMO employees",
      "Recent joiners (last 3 months)",
    ],
  },

  "control-hub/config": {
    key: "control-hub/config",
    label: "AI Prompt Config",
    Icon: Database,
    accent: "#00a29a",
    heading: "Customize AI instructions",
    tagline: "Edit system prompts, guardrails, and domain-specific instructions for the assistant.",
    starters: [
      "Update the HR system prompt",
      "Show the current IT guardrail",
      "Add a new PMO instruction",
      "What's the current admin prompt?",
    ],
    placeholders: [
      "Update the HR system prompt",
      "Show the IT guardrail",
      "Add a PMO instruction",
      "What is the current admin prompt?",
    ],
  },

  "control-hub/cabin-directory": {
    key: "control-hub/cabin-directory",
    label: "Cabin Directory",
    Icon: Building2,
    accent: "#F59E0B",
    heading: "Find offices and cabins",
    tagline: "Map facility spaces, meeting rooms, and seating assignments across floors.",
    starters: [
      "Who sits in Cabin 101?",
      "Show available meeting rooms on Floor 2",
      "Find a quiet pod near the PMO team",
      "What rooms are available for 10 people?",
    ],
    placeholders: [
      "Who is in Cabin 101?",
      "Available rooms on Floor 2",
      "Quiet pod near PMO",
      "Rooms for 10 people",
    ],
  },

  "control-hub/url-library": {
    key: "control-hub/url-library",
    label: "URL Library",
    Icon: Link2,
    accent: "#00a29a",
    heading: "Manage workspace links",
    tagline: "Add, update, and curate deep-linked tools — with AI-suggested trigger keywords.",
    starters: [
      "Add a new link for the HR payroll portal",
      "Search for the Zoho People link",
      "Show all IT-related workspace links",
      "Update trigger keywords for the expense tool",
    ],
    placeholders: [
      "Add a link for the HR payroll portal",
      "Find the Zoho People link",
      "All IT-related links",
      "Update trigger keywords for expense tool",
    ],
  },

  "control-hub/form-library": {
    key: "control-hub/form-library",
    label: "Form Library",
    Icon: FileText,
    accent: "#00a29a",
    heading: "Create and manage forms",
    tagline: "Build forms with AI, view submissions, and configure trigger keywords.",
    starters: [
      "Create a new IT equipment request form",
      "Show all active forms and their submission counts",
      "Add a signature field to the travel request form",
      "Which forms have the most submissions?",
    ],
    placeholders: [
      "Create an IT equipment request form",
      "Active forms and submission counts",
      "Add a field to travel request form",
      "Most submitted forms",
    ],
  },

  "control-hub/connector-studio": {
    key: "control-hub/connector-studio",
    label: "Connector Studio",
    Icon: Globe,
    accent: "#6366f1",
    heading: "Configure integrations",
    tagline: "Import OpenAPI specs, configure auth, test operations, and publish connectors.",
    starters: [
      "Show all active connectors",
      "Import an OpenAPI spec for a new service",
      "Test the Alchemy connector endpoints",
      "Which connectors are currently failing?",
    ],
    placeholders: [
      "Show all active connectors",
      "Import an OpenAPI spec",
      "Test the Alchemy connector",
      "Connectors with errors",
    ],
  },
};

const GENERIC: PortalCopilotConfig = {
  key: "generic",
  label: "Workspace",
  Icon: Sparkles,
  accent: "var(--clarity)",
  heading: "How can I help you today?",
  tagline: "Ask about this page, operational data, or request a workspace action.",
  starters: [],
  placeholders: [
    "Ask about leave, IT tickets, travel, bookings, policies...",
    "Can you check my remaining leave balance?",
    "How do I submit an IT support ticket?",
    "What is our work from home policy?",
  ],
};

export function getPortalCopilot(pathname?: string, search?: string): PortalCopilotConfig {
  if (!pathname) return GENERIC;
  const segments = pathname.split("/").filter(Boolean);
  const key = segments[0] || "";
  if (key === "control-hub") {
    // Enriched path form: "/control-hub/roi" (from AssistantView portalContext)
    if (segments[1]) return CONFIGS[`control-hub/${segments[1]}`] ?? CONFIGS["control-hub"] ?? GENERIC;
    // Query-param form: "/control-hub?tab=roi" (from CopilotSidebar location)
    if (search) {
      const tab = new URLSearchParams(search).get("tab");
      if (tab) return CONFIGS[`control-hub/${tab}`] ?? CONFIGS["control-hub"] ?? GENERIC;
    }
    return CONFIGS["control-hub"] ?? GENERIC;
  }
  return CONFIGS[key] ?? GENERIC;
}
