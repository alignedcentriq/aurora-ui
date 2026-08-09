import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Palmtree,
  ListTodo,
  Ticket,
  AlertCircle,
  Users,
  Receipt,
  X,
  Plus,
  Settings2,
  Check,
  Brain,
  Clock,
  Heart,
  Smile,
  GraduationCap,
  Activity,
  Server,
  Target,
  Flag,
  Trophy,
  Sparkles,
  UserPlus,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type Role } from "@/lib/auth-store";
import { useSettings, COUNTRIES } from "@/lib/settings-store";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
};

function CircularProgress({
  value,
  size = 48,
  strokeWidth = 4,
  color = "var(--primary)",
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/50"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

// ── Card catalog ──────────────────────────────────────────────────────────────

type CardId =
  | "leave_balance"
  | "holidays"
  | "pending_approvals"
  | "it_tickets"
  | "team_leave"
  | "open_tickets"
  | "reimbursements"
  | "focus_mode"
  | "up_next"
  | "org_pulse"
  | "skill_progress"
  | "system_health"
  | "project_milestones"
  | "kudos_board"
  | "new_hires_onboarding";

interface CardDef {
  id: CardId;
  label: string;
  description: string;
  allowedRoles: Role[] | "all";
  prompt: string | ((role: Role) => string);
}

const CARD_CATALOG: CardDef[] = [
  {
    id: "leave_balance",
    label: "Leave Balance",
    description: "Your remaining leave days",
    allowedRoles: ["Employee", "HR", "PMO", "Admin", "Functional Manager", "Super Admin"],
    prompt: "How many leave days do I have left?",
  },
  {
    id: "holidays",
    label: "Upcoming Holidays",
    description: "Next public holiday",
    allowedRoles: "all",
    prompt: "Show me upcoming holidays",
  },
  {
    id: "pending_approvals",
    label: "Pending Approvals",
    description: "Items awaiting your action",
    allowedRoles: ["HR", "IT", "PMO", "Admin", "Functional Manager", "Super Admin"],
    prompt: (role) =>
      role === "HR" || role === "Functional Manager"
        ? "Show pending leave approvals from my reportees"
        : "Show my pending tasks",
  },
  {
    id: "it_tickets",
    label: "IT Tickets",
    description: "Your open support tickets",
    allowedRoles: ["IT", "Admin", "Super Admin", "Employee"],
    prompt: "What's the status of my IT tickets?",
  },
  {
    id: "team_leave",
    label: "Team Leave",
    description: "Leave status for your reportees",
    allowedRoles: ["HR", "Functional Manager", "Admin", "PMO", "Super Admin"],
    prompt: "Show leave status for my reportees",
  },
  {
    id: "open_tickets",
    label: "Open Tickets",
    description: "All unresolved IT tickets",
    allowedRoles: ["IT", "Admin", "Super Admin"],
    prompt: "Show all open IT tickets",
  },
  {
    id: "reimbursements",
    label: "Reimbursements",
    description: "Your pending expense claims",
    allowedRoles: ["Employee", "Admin", "Super Admin"],
    prompt: "What's the status of my reimbursement requests?",
  },
  {
    id: "focus_mode",
    label: "Focus Mode",
    description: "Your focus time session metrics",
    allowedRoles: ["Employee", "Admin", "PMO", "Functional Manager", "Super Admin"],
    prompt: "Show me my focus time status and history",
  },
  {
    id: "up_next",
    label: "Up Next",
    description: "Your next calendar meeting details",
    allowedRoles: "all",
    prompt: "What is my next meeting?",
  },
  {
    id: "org_pulse",
    label: "Org Pulse",
    description: "Team feedback and mood index",
    allowedRoles: ["HR", "Admin", "Super Admin", "Functional Manager"],
    prompt: "What is our team engagement score and feedback trends?",
  },
  {
    id: "skill_progress",
    label: "Skill Progress",
    description: "Mandatory employee compliance training",
    allowedRoles: ["Employee", "Admin", "Super Admin", "Functional Manager"],
    prompt: "Show my pending training courses and skill progress",
  },
  {
    id: "system_health",
    label: "System Health",
    description: "IT systems operational status",
    allowedRoles: ["IT", "Admin", "Super Admin"],
    prompt: "Show system health dashboard status",
  },
  {
    id: "project_milestones",
    label: "Project Milestones",
    description: "Project sprints and deadlines",
    allowedRoles: ["PMO", "Admin", "Super Admin", "Functional Manager"],
    prompt: "Show upcoming project milestones",
  },
  {
    id: "kudos_board",
    label: "Kudos Board",
    description: "Team recognition and congratulations",
    allowedRoles: ["Employee", "HR", "PMO", "Admin", "Super Admin", "Functional Manager"],
    prompt: "Show recent kudos received by my team",
  },
  {
    id: "new_hires_onboarding",
    label: "Onboarding Track",
    description: "Checkpoint checklist for new joiners",
    allowedRoles: ["HR", "Admin", "Super Admin"],
    prompt: "Who are the new hires starting next week and what is their onboarding checklist?",
  },
];

const ROLE_DEFAULTS: Record<Role, CardId[]> = {
  Employee: ["leave_balance", "up_next", "focus_mode", "it_tickets"],
  HR: ["pending_approvals", "org_pulse", "team_leave", "new_hires_onboarding"],
  IT: ["system_health", "it_tickets", "open_tickets", "pending_approvals"],
  PMO: ["project_milestones", "pending_approvals", "leave_balance", "kudos_board"],
  Admin: ["system_health", "pending_approvals", "org_pulse", "open_tickets"],
  "Functional Manager": ["pending_approvals", "team_leave", "project_milestones", "kudos_board"],
  // Owner's home page: personal cards (leave, holiday, kudos, next meeting) rather
  // than ops widgets — Control Hub already covers the admin surface.
  "Super Admin": ["leave_balance", "holidays", "kudos_board", "up_next"],
};

const CARD_HOVER: Record<CardId, string> = {
  leave_balance: "hover:shadow-lg hover:shadow-emerald-500/5 hover:border-emerald-500/20",
  holidays: "hover:shadow-lg hover:shadow-cyan-500/5 hover:border-cyan-500/20",
  pending_approvals: "hover:shadow-lg hover:shadow-amber-500/5 hover:border-amber-500/20",
  it_tickets: "hover:shadow-lg hover:shadow-violet-500/5 hover:border-violet-500/20",
  team_leave: "hover:shadow-lg hover:shadow-indigo-500/5 hover:border-indigo-500/20",
  open_tickets: "hover:shadow-lg hover:shadow-rose-500/5 hover:border-rose-500/20",
  reimbursements: "hover:shadow-lg hover:shadow-orange-500/5 hover:border-orange-500/20",
  focus_mode: "hover:shadow-lg hover:shadow-purple-500/5 hover:border-purple-500/20",
  up_next: "hover:shadow-lg hover:shadow-sky-500/5 hover:border-sky-500/20",
  org_pulse: "hover:shadow-lg hover:shadow-pink-500/5 hover:border-pink-500/20",
  skill_progress: "hover:shadow-lg hover:shadow-teal-500/5 hover:border-teal-500/20",
  system_health: "hover:shadow-lg hover:shadow-teal-500/5 hover:border-teal-500/20",
  project_milestones: "hover:shadow-lg hover:shadow-amber-500/5 hover:border-amber-500/20",
  kudos_board: "hover:shadow-lg hover:shadow-yellow-500/5 hover:border-yellow-500/20",
  new_hires_onboarding: "hover:shadow-lg hover:shadow-indigo-500/5 hover:border-indigo-500/20",
};

const CARD_LEFT_ACCENT: Record<CardId, string> = {
  leave_balance: "border-l-emerald-500",
  holidays: "border-l-cyan-500",
  pending_approvals: "border-l-amber-500",
  it_tickets: "border-l-violet-500",
  team_leave: "border-l-indigo-500",
  open_tickets: "border-l-rose-500",
  reimbursements: "border-l-orange-500",
  focus_mode: "border-l-purple-500",
  up_next: "border-l-sky-500",
  org_pulse: "border-l-pink-500",
  skill_progress: "border-l-teal-500",
  system_health: "border-l-teal-500",
  project_milestones: "border-l-amber-500",
  kudos_board: "border-l-yellow-500",
  new_hires_onboarding: "border-l-indigo-500",
};

function getPrompt(card: CardDef, role: Role): string {
  return typeof card.prompt === "function" ? card.prompt(role) : card.prompt;
}

function isCardAllowed(card: CardDef, role: Role): boolean {
  return card.allowedRoles === "all" || (card.allowedRoles as Role[]).includes(role);
}

// ── Card content ──────────────────────────────────────────────────────────────

/** Days-until label matching the style of the static COUNTRIES holiday fixture ("in 12d", "Today"). */
function relativeDays(dateStr: string): string {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 0) return `in ${days}d`;
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The two types people actually track day-to-day. Leave Without Pay is unlimited
// (not a real quota) and Compensatory Off is rare, so both are left off the card.
const LEAVE_CARD_TYPES = ["Privileged Leave (New)", "Casual Leave (New)"];

function CardContent({ id }: { id: CardId }) {
  const { country } = useSettings();
  const { user } = useAuth();
  const cData = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];

  const [leaveBalances, setLeaveBalances] = useState<{ type: string; balance: number; total: number }[] | null>(null);
  const [holiday, setHoliday] = useState<{ name: string; date: string } | null>(null);

  useEffect(() => {
    if (id !== "leave_balance" || !user?.email) return;
    const controller = new AbortController();
    fetch("/api/leave/balance", {
      signal: controller.signal,
      headers: {
        ...(user?.email ? { "x-user-email": user.email } : {}),
        ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { success?: boolean; balances?: { type: string; total: number; balance: number }[] } | null) => {
        if (!data?.success || !data.balances?.length) return;
        // Every leave type has its own separate quota (Casual, Privileged, Sabbatical,
        // unlimited LWP, ...) — summing them into one number is meaningless, so show
        // each type's own balance instead of a blended total, limited to the handful
        // of types people actually check day-to-day (see LEAVE_CARD_TYPES).
        const wanted = data.balances
          .filter((b) => LEAVE_CARD_TYPES.some((t) => t.toLowerCase() === b.type.toLowerCase()))
          .sort(
            (a, b) =>
              LEAVE_CARD_TYPES.findIndex((t) => t.toLowerCase() === a.type.toLowerCase()) -
              LEAVE_CARD_TYPES.findIndex((t) => t.toLowerCase() === b.type.toLowerCase()),
          )
          .map((b) => ({ type: b.type, balance: Math.round(b.balance * 10) / 10, total: Math.round(b.total * 10) / 10 }));
        setLeaveBalances(wanted);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, user?.email, user?.role]);

  useEffect(() => {
    if (id !== "holidays" || !user?.email) return;
    const controller = new AbortController();
    fetch("/api/leave/holidays", {
      signal: controller.signal,
      headers: {
        ...(user?.email ? { "x-user-email": user.email } : {}),
        ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { holidays?: { name: string; date: string }[] } | null) => {
        const list = data?.holidays;
        if (!list?.length) return;
        const todayStr = new Date().toISOString().slice(0, 10);
        setHoliday(list.find((h) => h.date >= todayStr) ?? list[list.length - 1]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, user?.email, user?.role]);

  switch (id) {
    case "leave_balance": {
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
              <CalendarDays className="h-4 w-4 text-emerald-500" />
            </div>
          </div>
          {leaveBalances ? (
            <div className="flex flex-col gap-1">
              {leaveBalances.map((b) => (
                <div key={b.type} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground font-medium truncate">{b.type}</span>
                  <span className="text-[13px] font-bold text-foreground shrink-0">
                    {b.balance} <span className="text-[10px] font-medium text-muted-foreground">/ {b.total}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                12 / {cData.leave.amount}
              </p>
              <p className="text-[11px] text-muted-foreground font-medium">
                {cData.leave.label} Left
              </p>
            </div>
          )}
        </>
      );
    }

    case "holidays": {
      const name = holiday?.name ?? cData.holiday.name;
      const dateLabel = holiday ? new Date(holiday.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : cData.holiday.date;
      const relative = holiday ? relativeDays(holiday.date) : cData.holiday.relative;
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10">
              <Palmtree className="h-4 w-4 text-cyan-500" />
            </div>
            <span className="text-[11px] font-semibold text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span>{cData.flag}</span>
              <span>{relative === "Today" || relative === "Tomorrow" ? relative : "Soon"}</span>
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate">{name}</p>
            <p className="text-[11px] text-muted-foreground font-medium">
              {dateLabel} · {relative}
            </p>
          </div>
        </>
      );
    }

    case "pending_approvals":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
              <ListTodo className="h-4 w-4 text-amber-500" />
            </div>
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.6, type: "spring" as const, stiffness: 400, damping: 15 }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white"
            >
              3
            </motion.span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">3</p>
            <p className="text-[11px] text-muted-foreground font-medium">Pending approvals</p>
          </div>
        </>
      );

    case "it_tickets":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/10">
              <Ticket className="h-4 w-4 text-violet-500" />
            </div>
            <span className="text-[9px] text-muted-foreground font-semibold bg-secondary px-2 py-0.5 rounded">
              {cData.helpdesk}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                All resolved
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">0 open tickets</p>
          </div>
        </>
      );

    case "team_leave":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10">
              <Users className="h-4 w-4 text-indigo-500" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">2</p>
            <p className="text-[11px] text-muted-foreground font-medium">On leave today</p>
          </div>
        </>
      );

    case "open_tickets":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10">
              <AlertCircle className="h-4 w-4 text-rose-500" />
            </div>
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.6, type: "spring" as const, stiffness: 400, damping: 15 }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white"
            >
              5
            </motion.span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">5</p>
            <p className="text-[11px] text-muted-foreground font-medium">
              Open tickets ({cData.code})
            </p>
          </div>
        </>
      );

    case "reimbursements":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/10">
              <Receipt className="h-4 w-4 text-orange-500" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="flex h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                2 pending
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">Expense claims</p>
          </div>
        </>
      );

    case "focus_mode":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10">
              <Brain className="h-4 w-4 text-purple-500" />
            </div>
            <CircularProgress value={62} size={36} strokeWidth={3} color="#8b5cf6" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">2.5h</p>
            <p className="text-[11px] text-muted-foreground font-medium">Focus of 4h done</p>
          </div>
        </>
      );

    case "up_next":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
              <Clock className="h-4 w-4 text-sky-500" />
            </div>
            <span className="text-[10px] font-semibold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded-full flex items-center">
              In 15m
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate">Weekly Sync Meeting</p>
            <p className="text-[11px] text-muted-foreground font-medium">2:00 PM · Outlook Sync</p>
          </div>
        </>
      );

    case "org_pulse":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-500/10">
              <Heart className="h-4 w-4 text-pink-500" />
            </div>
            <span className="text-[10px] font-semibold text-pink-500 bg-pink-500/10 px-2 py-0.5 rounded-full">
              ▲ +0.2
            </span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">8.4 / 10</p>
            <p className="text-[11px] text-muted-foreground font-medium">Team Pulse Index</p>
          </div>
        </>
      );

    case "skill_progress":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/10">
              <GraduationCap className="h-4 w-4 text-teal-500" />
            </div>
            <span className="text-[11px] font-bold text-teal-500">78%</span>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground truncate">Security Compliance</p>
            <div className="w-full bg-muted/60 h-1 rounded-full overflow-hidden">
              <div className="bg-teal-500 h-full rounded-full" style={{ width: "78%" }} />
            </div>
          </div>
        </>
      );

    case "system_health":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/10">
              <Server className="h-4 w-4 text-teal-500" />
            </div>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">All Systems OK</p>
            <p className="text-[10px] text-muted-foreground font-medium">API 12ms · DB 99%</p>
          </div>
        </>
      );

    case "project_milestones":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
              <Target className="h-4 w-4 text-amber-500" />
            </div>
            <span className="text-[10px] font-bold text-amber-500">
              Sprint 4
            </span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">2 / 3</p>
            <p className="text-[11px] text-muted-foreground font-medium">Milestones due</p>
          </div>
        </>
      );

    case "kudos_board":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-yellow-500/10">
              <Trophy className="h-4 w-4 text-yellow-500" />
            </div>
            <span className="text-[10px] font-bold text-yellow-500 flex items-center gap-0.5">
              +3 new
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground truncate">
              "Great delivery!" - Alice
            </p>
            <p className="text-[11px] text-muted-foreground font-medium">Kudos Board</p>
          </div>
        </>
      );

    case "new_hires_onboarding":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10">
              <UserPlus className="h-4 w-4 text-indigo-500" />
            </div>
            <span className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full">
              3 / 4 completed
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate">4 New Hires</p>
            <p className="text-[11px] text-muted-foreground font-medium">Starting next week</p>
          </div>
        </>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface SmartWidgetsProps {
  onAction?: (prompt: string) => void;
}

// App owner's personal default — independent of whatever role the backend resolves
// (Employee in some environments, Super Admin in others). Their home page should look
// the same regardless, so this is keyed off the account, not the role field.
const OWNER_EMAIL = "shivam.sharma@alignedautomation.com";
const OWNER_DEFAULT_CARDS: CardId[] = ["leave_balance", "holidays", "kudos_board", "up_next"];

export function SmartWidgets({ onAction }: SmartWidgetsProps) {
  const { user } = useAuth();
  const role: Role = user?.role ?? "Employee";
  const isOwner = (user?.email ?? "").toLowerCase() === OWNER_EMAIL;

  const [activeCards, setActiveCards] = useState<CardId[]>(() => {
    try {
      const saved = localStorage.getItem(`centriq-widgets-${user?.email}`);
      if (saved) {
        const parsed: CardId[] = JSON.parse(saved);
        // Drop any cards that are no longer allowed for this role
        return parsed.filter((id) => {
          const def = CARD_CATALOG.find((c) => c.id === id);
          return def && isCardAllowed(def, role);
        });
      }
    } catch {
      // ignore malformed storage
    }
    if (isOwner) return OWNER_DEFAULT_CARDS;
    return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS["Employee"];
  });

  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The widget row lives inside an `overflow-hidden` scroll container, so a plain
  // absolutely-positioned dropdown gets clipped whenever it would extend past that
  // container's edge (e.g. down towards the chat composer). Rendering it through a
  // portal with fixed coordinates escapes that clipping ancestor entirely.
  const [addMenuPos, setAddMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        addRef.current && !addRef.current.contains(target) &&
        addMenuRef.current && !addMenuRef.current.contains(target)
      ) {
        setAddOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addOpen]);

  function saveCards(cards: CardId[]) {
    setActiveCards(cards);
    if (user?.email) {
      localStorage.setItem(`centriq-widgets-${user.email}`, JSON.stringify(cards));
    }
  }

  function removeCard(id: CardId) {
    saveCards(activeCards.filter((c) => c !== id));
  }

  function addCard(id: CardId) {
    if (activeCards.length >= 4) return;
    saveCards([...activeCards, id]);
    setAddOpen(false);
  }

  function toggleEdit() {
    setEditMode((e) => !e);
    setAddOpen(false);
  }

  const availableToAdd = CARD_CATALOG.filter(
    (c) => isCardAllowed(c, role) && !activeCards.includes(c.id),
  );

  const showAddSlot = editMode && activeCards.length < 4;

  return (
    <div className="w-full space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="section-label flex-1">
          <span>Quick Glance</span>
        </div>
        <button
          onClick={toggleEdit}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium transition-all rounded-full px-3 py-1 ml-3",
            editMode
              ? "text-primary bg-primary/10 border border-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent",
          )}
        >
          {editMode ? (
            <>
              <Check className="h-3 w-3" />
              Done
            </>
          ) : (
            <>
              <Settings2 className="h-3 w-3" />
              Customize
            </>
          )}
        </button>
      </div>

      {/* Card grid */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex lg:grid lg:grid-cols-4 overflow-x-auto lg:overflow-visible no-scrollbar flex-nowrap lg:flex-wrap gap-3 w-full items-stretch px-1.5 pt-2 pb-1 -mx-1.5"
      >
        <AnimatePresence mode="popLayout">
          {activeCards.map((id) => {
            const def = CARD_CATALOG.find((c) => c.id === id)!;
            return (
              <motion.div
                key={id}
                variants={item}
                layout
                exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.15 } }}
                className="relative h-full w-[calc(50%-0.375rem)] sm:w-[calc(33.333%-0.5rem)] lg:w-auto shrink-0 lg:shrink"
              >
                {/* Remove button — visible in edit mode */}
                <AnimatePresence>
                  {editMode && (
                    <motion.button
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      onClick={() => removeCard(id)}
                      whileHover={{ scale: 1.12 }}
                      whileTap={{ scale: 0.9 }}
                      className="absolute -top-2 -right-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md ring-2 ring-background hover:bg-destructive/90"
                      aria-label={`Remove ${def.label}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </motion.button>
                  )}
                </AnimatePresence>

                <motion.button
                  whileHover={
                    editMode
                      ? {}
                      : { y: -4, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }
                  }
                  whileTap={editMode ? {} : { scale: 0.97 }}
                  onClick={() => !editMode && onAction?.(getPrompt(def, role))}
                  className={cn(
                    "card-live-dot group flex flex-col justify-between gap-3 rounded-2xl glass-widget border-l-[3px] p-5 text-left w-full h-full min-h-[110px]",
                    CARD_LEFT_ACCENT[id],
                    editMode ? "cursor-default" : CARD_HOVER[id],
                  )}
                >
                  <CardContent id={id} />
                </motion.button>
              </motion.div>
            );
          })}

          {/* Add card slot */}
          {showAddSlot && (
            <motion.div
              key="add-slot"
              variants={item}
              layout
              exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.15 } }}
              className="relative h-full w-[145px] sm:w-[170px] lg:w-auto shrink-0 lg:shrink"
            >
              <div ref={addRef} className="h-full">
                <button
                  onClick={() => {
                    if (!addOpen && addRef.current) {
                      const rect = addRef.current.getBoundingClientRect();
                      const spaceAbove = rect.top;
                      const spaceBelow = window.innerHeight - rect.bottom;
                      const dropUp = spaceAbove > spaceBelow;
                      setAddMenuPos({
                        left: rect.left,
                        width: rect.width,
                        ...(dropUp
                          ? { bottom: window.innerHeight - rect.top + 6 }
                          : { top: rect.bottom + 6 }),
                      });
                    }
                    setAddOpen((o) => !o);
                  }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-card/30 p-4 w-full h-full min-h-[110px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[11px] font-medium">Add card</span>
                </button>

                {/* Add dropdown — portalled to <body> so the surrounding overflow-hidden
                    scroll container can't clip it (e.g. against the chat composer). */}
                {addOpen && addMenuPos && createPortal(
                  <AnimatePresence>
                    <motion.div
                      ref={addMenuRef}
                      initial={{ opacity: 0, y: addMenuPos.bottom !== undefined ? 6 : -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: addMenuPos.bottom !== undefined ? 6 : -6, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      style={{
                        position: "fixed",
                        left: addMenuPos.left,
                        top: addMenuPos.top,
                        bottom: addMenuPos.bottom,
                        width: Math.max(addMenuPos.width, 208),
                      }}
                      className="z-50 max-w-[80vw] max-h-[min(60vh,20rem)] overflow-y-auto rounded-xl border border-border bg-popover shadow-xl shadow-black/10"
                    >
                      {availableToAdd.length === 0 ? (
                        <p className="px-3 py-2.5 text-[12px] text-muted-foreground">
                          No more cards available for your role
                        </p>
                      ) : (
                        availableToAdd.map((card) => (
                          <button
                            key={card.id}
                            onClick={() => addCard(card.id)}
                            className="flex flex-col w-full px-3 py-2.5 text-left hover:bg-accent transition-colors gap-0.5"
                          >
                            <span className="text-[12px] font-medium text-foreground">
                              {card.label}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {card.description}
                            </span>
                          </button>
                        ))
                      )}
                    </motion.div>
                  </AnimatePresence>,
                  document.body,
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
