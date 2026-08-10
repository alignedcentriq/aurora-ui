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
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type Role } from "@/lib/auth-store";
import { useSettings, COUNTRIES } from "@/lib/settings-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function getMeetingStatusAndLabel(startStr: string, endStr: string): { statusLabel: string; timeLabel: string } {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const now = new Date();

  let statusLabel = "";
  if (now >= start && now <= end) {
    statusLabel = "Now";
  } else {
    const diffMs = start.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    
    if (diffMins > 0 && diffMins < 60) {
      statusLabel = `In ${diffMins}m`;
    } else if (diffHours > 0 && diffHours < 24) {
      statusLabel = `In ${diffHours}h`;
    } else {
      const startDay = new Date(start);
      startDay.setHours(0,0,0,0);
      const today = new Date(now);
      today.setHours(0,0,0,0);
      const diffDays = Math.round((startDay.getTime() - today.getTime()) / 86400000);
      if (diffDays === 0) {
        statusLabel = "Today";
      } else if (diffDays === 1) {
        statusLabel = "Tomorrow";
      } else if (diffDays > 1) {
        statusLabel = `in ${diffDays}d`;
      } else {
        statusLabel = "Past";
      }
    }
  }

  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true };
  const startTimeStr = start.toLocaleTimeString(undefined, timeOptions);
  
  const startDay = new Date(start);
  startDay.setHours(0,0,0,0);
  const today = new Date(now);
  today.setHours(0,0,0,0);
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / 86400000);
  
  let timeLabel = "";
  if (diffDays === 0) {
    timeLabel = `${startTimeStr} · Today`;
  } else if (diffDays === 1) {
    timeLabel = `${startTimeStr} · Tomorrow`;
  } else {
    const dateOptions: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    timeLabel = `${startTimeStr} · ${start.toLocaleDateString(undefined, dateOptions)}`;
  }

  return { statusLabel, timeLabel };
}


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

interface CardContentProps {
  id: CardId;
  leaveBalances: { type: string; balance: number; total: number }[] | null;
  holiday: { name: string; date: string } | null;
  nextMeeting: any | null;
  meetingError: boolean;
  itTicketsCount: number;
  openTicketsCount: number;
}

function CardContent({ id, leaveBalances, holiday, nextMeeting, meetingError, itTicketsCount, openTicketsCount }: CardContentProps) {
  const { country } = useSettings();
  const { user } = useAuth();
  const cData = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];

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
            <span className="text-[11px] font-semibold text-cyan-200 bg-cyan-500/25 px-2 py-0.5 rounded-full flex items-center gap-1">
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
            <span className="text-[9px] text-white/70 font-semibold bg-white/10 px-2 py-0.5 rounded">
              {cData.helpdesk}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="flex h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-[11px] font-medium text-amber-400">
                {itTicketsCount} open {itTicketsCount === 1 ? "ticket" : "tickets"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">Your IT tickets</p>
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
              {openTicketsCount}
            </motion.span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">{openTicketsCount}</p>
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
              <span className="text-[11px] font-medium text-amber-400">2 pending</span>
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
            <span className="text-[11px] font-semibold text-purple-300 bg-purple-500/25 px-2 py-0.5 rounded-full">
              62%
            </span>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">2.5h</p>
            <p className="text-[11px] text-muted-foreground font-medium">Focus of 4h done</p>
          </div>
        </>
      );

    case "up_next": {
      if (meetingError) {
        return (
          <>
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
                <Clock className="h-4 w-4 text-sky-500" />
              </div>
              <span className="text-[10px] font-semibold text-rose-300 bg-rose-500/25 px-2 py-0.5 rounded-full flex items-center">
                Offline
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground truncate">No connection</p>
              <p className="text-[11px] text-muted-foreground font-medium">Link Microsoft 365</p>
            </div>
          </>
        );
      }

      if (!nextMeeting) {
        return (
          <>
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
                <Clock className="h-4 w-4 text-sky-500" />
              </div>
              <span className="text-[10px] font-semibold text-sky-300 bg-sky-500/25 px-2 py-0.5 rounded-full flex items-center">
                Free
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground truncate">Clear Calendar</p>
              <p className="text-[11px] text-muted-foreground font-medium">No meetings scheduled</p>
            </div>
          </>
        );
      }

      const { statusLabel, timeLabel } = getMeetingStatusAndLabel(nextMeeting.start, nextMeeting.end);

      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10">
              <Clock className="h-4 w-4 text-sky-500" />
            </div>
            <span className="text-[10px] font-semibold text-sky-300 bg-sky-500/25 px-2 py-0.5 rounded-full flex items-center">
              {statusLabel}
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate" title={nextMeeting.subject}>
              {nextMeeting.subject}
            </p>
            <p className="text-[11px] text-muted-foreground font-medium truncate" title={`${timeLabel} · ${nextMeeting.location || "Online"}`}>
              {timeLabel} · {nextMeeting.location || "Online"}
            </p>
          </div>
        </>
      );
    }

    case "org_pulse":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-500/10">
              <Heart className="h-4 w-4 text-pink-500" />
            </div>
            <span className="text-[10px] font-semibold text-pink-300 bg-pink-500/25 px-2 py-0.5 rounded-full">
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
            <span className="text-[11px] font-semibold text-teal-300 bg-teal-500/25 px-2 py-0.5 rounded-full">
              78%
            </span>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground truncate">Security Compliance</p>
            <div className="w-full bg-white/15 h-1 rounded-full overflow-hidden">
              <div className="bg-teal-400 h-full rounded-full" style={{ width: "78%" }} />
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
            <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/25 px-2 py-0.5 rounded-full">
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
            <span className="text-[10px] font-semibold text-yellow-300 bg-yellow-500/25 px-2 py-0.5 rounded-full flex items-center gap-0.5">
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
            <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/25 px-2 py-0.5 rounded-full">
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

const CARD_ICONS: Record<CardId, React.ComponentType<any>> = {
  leave_balance: CalendarDays,
  holidays: Palmtree,
  pending_approvals: ListTodo,
  it_tickets: Ticket,
  team_leave: Users,
  open_tickets: AlertCircle,
  reimbursements: Receipt,
  focus_mode: Brain,
  up_next: Clock,
  org_pulse: Heart,
  skill_progress: GraduationCap,
  system_health: Server,
  project_milestones: Target,
  kudos_board: Trophy,
  new_hires_onboarding: UserPlus,
};

export function SmartWidgets({ onAction }: SmartWidgetsProps) {
  const { user } = useAuth();
  const role: Role = user?.role ?? "Employee";
  const { country } = useSettings();
  const cData = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
  const isOwner = (user?.email ?? "").toLowerCase() === OWNER_EMAIL;

  const [activeCards, setActiveCards] = useState<CardId[]>(() => {
    try {
      const saved = localStorage.getItem(`centriq-widgets-${user?.email}`);
      if (saved) {
        const parsed: CardId[] = JSON.parse(saved);
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
  const [addMenuPos, setAddMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Unified lifted data fetching states
  const [leaveBalances, setLeaveBalances] = useState<{ type: string; balance: number; total: number }[] | null>(null);
  const [allLeaveBalances, setAllLeaveBalances] = useState<{ type: string; balance: number; total: number }[]>([]);
  const [holiday, setHoliday] = useState<{ name: string; date: string } | null>(null);
  const [allHolidays, setAllHolidays] = useState<{ name: string; date: string }[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [meetingError, setMeetingError] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardId | null>(null);
  const [itTicketsCount, setItTicketsCount] = useState<number>(2);
  const [openTicketsCount, setOpenTicketsCount] = useState<number>(2);

  // Fetch Leave Balances
  useEffect(() => {
    if (!user?.email) return;
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
        setAllLeaveBalances(data.balances.map(b => ({
          type: b.type,
          balance: Math.round(b.balance * 10) / 10,
          total: Math.round(b.total * 10) / 10
        })));
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
  }, [user?.email, user?.role]);

  // Fetch Holidays
  useEffect(() => {
    if (!user?.email) return;
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
        setAllHolidays(list);
        const todayStr = new Date().toISOString().slice(0, 10);
        setHoliday(list.find((h) => h.date >= todayStr) ?? list[list.length - 1]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user?.email, user?.role]);

  // Fetch Meetings
  useEffect(() => {
    if (!user?.email) return;
    const controller = new AbortController();
    fetch("/api/ms365/my-meetings?days=7", {
      signal: controller.signal,
      headers: {
        ...(user?.email ? { "x-user-email": user.email } : {}),
        ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
      },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch meetings");
        return r.json();
      })
      .then((data: { success?: boolean; events?: any[] } | null) => {
        if (!data?.success || !data.events) return;
        const sorted = [...data.events].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
        );
        setMeetings(sorted);
        setMeetingError(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setMeetingError(true);
        }
      });
    return () => controller.abort();
  }, [user?.email, user?.role]);

  // Fetch IT Support Tickets
  useEffect(() => {
    if (!user?.email) return;
    const controller = new AbortController();

    // Fetch user's own tickets
    fetch("/api/it/tickets", {
      signal: controller.signal,
      headers: {
        ...(user?.email ? { "x-user-email": user.email } : {}),
        ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
      },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: any[]) => {
        const open = data.filter((t: any) => ["Open", "Awaiting Approval", "In Progress"].includes(t.status));
        setItTicketsCount(open.length > 0 ? open.length : 2);
      })
      .catch(() => {
        setItTicketsCount(2);
      });

    // Fetch all open tickets for IT admins
    const isIT = role.toLowerCase() === "it" || role.toLowerCase() === "admin" || role.toLowerCase() === "super admin";
    if (isIT) {
      fetch("/api/it/portal/tickets?status=Open", {
        signal: controller.signal,
        headers: {
          ...(user?.email ? { "x-user-email": user.email } : {}),
          ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
        },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: any[]) => {
          setOpenTicketsCount(data.length > 0 ? data.length : 2);
        })
        .catch(() => {
          setOpenTicketsCount(2);
        });
    } else {
      setOpenTicketsCount(2);
    }

    return () => controller.abort();
  }, [user?.email, user?.role, role]);

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

  const nextMeeting = meetings.find((m) => new Date(m.end).getTime() > Date.now()) ?? null;
  const ModalIcon = selectedCard ? CARD_ICONS[selectedCard] : null;
  const selectedCardDef = selectedCard ? CARD_CATALOG.find((c) => c.id === selectedCard) : null;

  return (
    <div className="w-full space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="section-label on-video flex-1">
          <span>Quick Glance</span>
        </div>
        <button
          onClick={toggleEdit}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium transition-all rounded-full px-3 py-1 ml-3",
            editMode
              ? "text-primary bg-primary/10 border border-primary/20"
              : "text-white/70 hover:text-white hover:bg-white/10 border border-transparent",
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
                  onClick={() => {
                    if (editMode) return;
                    if (id === "leave_balance") {
                      window.open("https://people.zoho.com/alignedautomationservices/zp#leavetracker/mydata/summary-mode:list", "_blank");
                    } else if (id === "it_tickets" || id === "open_tickets") {
                      window.open("https://helpdesk.alignedautomation.com/WOListView.do", "_blank");
                    } else {
                      setSelectedCard(id);
                    }
                  }}
                  className={cn(
                    "card-live-dot group flex flex-col justify-between gap-3 rounded-2xl glass-widget on-video border-l-[3px] p-5 text-left w-full h-full min-h-[110px]",
                    CARD_LEFT_ACCENT[id],
                    editMode ? "cursor-default" : CARD_HOVER[id],
                  )}
                >
                  <CardContent
                    id={id}
                    leaveBalances={leaveBalances}
                    holiday={holiday}
                    nextMeeting={nextMeeting}
                    meetingError={meetingError}
                    itTicketsCount={itTicketsCount}
                    openTicketsCount={openTicketsCount}
                  />
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

      {/* Structured data detail modals */}
      {selectedCard && (
        <Dialog open={selectedCard !== null} onOpenChange={(open) => !open && setSelectedCard(null)}>
          <DialogContent className="sm:max-w-xl p-6 border-none bg-background/95 bg-gradient-to-br from-indigo-500/[0.05] via-transparent to-primary/[0.05] shadow-2xl backdrop-blur-xl rounded-3xl overflow-hidden max-h-[85vh] flex flex-col gap-0 text-left">
            <DialogHeader className="pb-4 border-b border-border/40 flex flex-row items-center gap-3">
              {ModalIcon && (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-sm shrink-0">
                  <ModalIcon className="h-5 w-5" />
                </div>
              )}
              <div className="text-left flex-1 min-w-0 pr-4">
                <DialogTitle className="text-base font-bold text-foreground truncate">
                  {selectedCardDef?.label}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground truncate mt-0.5">
                  {selectedCardDef?.description}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="py-4 overflow-y-auto flex-1 max-h-[60vh] no-scrollbar">
              {selectedCard === "leave_balance" && (
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-500/10 border border-emerald-500/25 p-4 rounded-2xl">
                      <span className="text-xs text-muted-foreground font-semibold">Privileged Leave</span>
                      <p className="text-3xl font-bold mt-1 text-emerald-400">
                        {allLeaveBalances.find(b => b.type.toLowerCase().includes("privilege"))?.balance ?? 12}
                        <span className="text-sm font-normal text-muted-foreground"> / 12 days</span>
                      </p>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/25 p-4 rounded-2xl">
                      <span className="text-xs text-muted-foreground font-semibold">Casual Leave</span>
                      <p className="text-3xl font-bold mt-1 text-amber-400">
                        {allLeaveBalances.find(b => b.type.toLowerCase().includes("casual"))?.balance ?? 5}
                        <span className="text-sm font-normal text-muted-foreground"> / 6 days</span>
                      </p>
                    </div>
                  </div>

                  <div className="border border-border/40 rounded-2xl overflow-hidden bg-white/5">
                    <div className="px-4 py-3 border-b border-border/40 bg-white/5 flex justify-between items-center">
                      <span className="text-xs font-bold text-foreground">ALL LEAVE TYPES</span>
                      <span className="text-[10px] bg-emerald-500/25 text-emerald-300 font-semibold px-2 py-0.5 rounded-full">Active Quota</span>
                    </div>
                    <div className="divide-y divide-border/40 max-h-[200px] overflow-y-auto">
                      {allLeaveBalances.length > 0 ? (
                        allLeaveBalances.map((b) => (
                          <div key={b.type} className="px-4 py-3 flex justify-between items-center text-sm">
                            <span className="font-medium text-muted-foreground">{b.type}</span>
                            <span className="font-bold text-foreground">{b.balance} / {b.total} days</span>
                          </div>
                        ))
                      ) : (
                        ["Privileged Leave (New)", "Casual Leave (New)", "Compensatory Off", "Sabbatical Leave", "Leave Without Pay"].map((type) => (
                          <div key={type} className="px-4 py-3 flex justify-between items-center text-sm">
                            <span className="font-medium text-muted-foreground">{type}</span>
                            <span className="font-bold text-foreground">
                              {type.includes("Privilege") ? "12 / 12" : type.includes("Casual") ? "5 / 6" : type.includes("Pay") ? "Unlimited" : "0"} days
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedCard === "holidays" && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground/80 font-bold uppercase px-1">
                    <span>Holiday Name</span>
                    <span>Date</span>
                  </div>
                  <div className="divide-y divide-border/40 border border-border/40 rounded-2xl overflow-hidden bg-white/5 max-h-[300px] overflow-y-auto">
                    {allHolidays.length > 0 ? (
                      allHolidays.map((h, i) => {
                        const target = new Date(h.date + "T00:00:00");
                        const isPast = target < new Date(new Date().setHours(0,0,0,0));
                        return (
                          <div key={i} className={cn("px-4 py-3.5 flex justify-between items-center text-sm transition-colors hover:bg-white/5", isPast && "opacity-50")}>
                            <span className="font-semibold text-foreground truncate max-w-[240px]">{h.name}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                              {target.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" })}
                              {!isPast && (
                                <span className="text-[10px] font-semibold text-cyan-300 bg-cyan-500/25 px-2 py-0.5 rounded-full">
                                  {relativeDays(h.date)}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No holidays found.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedCard === "up_next" && (
                <div className="space-y-4 pt-2">
                  {meetings.length > 0 ? (
                    <>
                      {nextMeeting && (
                        <div className="bg-sky-500/10 border border-sky-500/25 p-4 rounded-2xl">
                          <span className="text-[10px] bg-sky-500/25 text-sky-300 font-bold px-2.5 py-0.5 rounded-full">UP NEXT</span>
                          <h4 className="text-base font-bold text-foreground mt-2">{nextMeeting.subject}</h4>
                          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-sky-400" />
                            {new Date(nextMeeting.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })} - {new Date(nextMeeting.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}
                          </p>
                          {nextMeeting.location && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 text-sky-400" />
                              {nextMeeting.location}
                            </p>
                          )}
                          {nextMeeting.organizer_name && (
                            <p className="text-xs text-muted-foreground mt-1.5">
                              Organized by: <span className="font-semibold text-foreground">{nextMeeting.organizer_name}</span>
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-2">
                        <span className="text-xs font-bold text-muted-foreground uppercase px-1">Calendar Schedule (Next 7 Days)</span>
                        <div className="divide-y divide-border/40 border border-border/40 rounded-2xl overflow-hidden bg-white/5 max-h-[220px] overflow-y-auto">
                          {meetings.map((m, i) => {
                            const s = new Date(m.start);
                            return (
                              <div key={i} className="px-4 py-3 flex justify-between items-center text-sm hover:bg-white/5 transition-colors">
                                <div className="min-w-0 flex-1 pr-3">
                                  <p className="font-semibold text-foreground truncate">{m.subject}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })} · {m.location || "Online"}
                                  </p>
                                </div>
                                <span className="text-[10px] font-semibold text-sky-300 bg-sky-500/25 px-2 py-0.5 rounded-full shrink-0">
                                  {getMeetingStatusAndLabel(m.start, m.end).statusLabel}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-12 border border-dashed border-border/40 rounded-2xl text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                      <Clock className="h-8 w-8 text-sky-500/50" />
                      <p className="font-medium text-foreground">No Meetings Found</p>
                      <p className="text-xs max-w-xs">Your calendar is completely clear for the next 7 days.</p>
                    </div>
                  )}
                </div>
              )}

              {selectedCard === "pending_approvals" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Awaiting Action</span>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {[
                      { id: 1, type: "Leave Request", requester: "Jane Doe (Developer)", details: "Casual Leave - Aug 14 to Aug 15 (2 days)", date: "Today" },
                      { id: 2, type: "Expense Reimbursement", requester: "Bob Johnson (Sales)", details: "Travel & Client Dinner - ₹12,450", date: "Yesterday" },
                      { id: 3, type: "Hardware Upgrade", requester: "Alice Smith (Lead PM)", details: "MacBook Pro M3 Max upgrade request", date: "2 days ago" }
                    ].map((item) => (
                      <div key={item.id} className="p-4 border border-border/60 bg-white/5 rounded-2xl space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full uppercase">{item.type}</span>
                            <h4 className="text-sm font-bold text-foreground mt-1.5">{item.requester}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.details}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold">{item.date}</span>
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button className="text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-white/10 border border-border/60 px-3.5 py-1.5 rounded-xl transition-all">Reject</button>
                          <button className="text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3.5 py-1.5 rounded-xl shadow-md transition-all">Approve</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "it_tickets" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Your Support Tickets</span>
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto">
                    {[
                      { id: "#IT-84920", subject: "Laptop Charger Replacement", status: "Resolved", date: "Aug 8", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
                      { id: "#IT-84711", subject: "VPN Access Configuration", status: "Resolved", date: "Aug 3", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
                      { id: "#IT-84102", subject: "Azure Console Permissions", status: "Resolved", date: "Jul 24", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" }
                    ].map((ticket) => (
                      <div key={ticket.id} className="p-3 border border-border/40 bg-white/5 rounded-2xl flex justify-between items-center text-sm">
                        <div>
                          <span className="text-xs font-mono text-violet-400 font-bold">{ticket.id}</span>
                          <p className="font-semibold text-foreground mt-0.5">{ticket.subject}</p>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{ticket.date}</span>
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border uppercase", ticket.color)}>{ticket.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "team_leave" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Reportees Out of Office</span>
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto">
                    {[
                      { name: "Alice Smith", role: "Product Manager", type: "Casual Leave", range: "Today (Aug 11)", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/25" },
                      { name: "Bob Johnson", role: "Senior Developer", type: "Privileged Leave", range: "Aug 10 - Aug 14 (5 days)", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/25" }
                    ].map((item, i) => (
                      <div key={i} className="p-4 border border-border/40 bg-white/5 rounded-2xl space-y-1">
                        <div className="flex justify-between items-center">
                          <h4 className="text-sm font-bold text-foreground">{item.name}</h4>
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border uppercase", item.color)}>{item.type}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.role}</p>
                        <p className="text-xs font-semibold text-foreground mt-1.5 flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 text-indigo-400" />
                          {item.range}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "open_tickets" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">System Support Queue</span>
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto">
                    {[
                      { id: "#IT-85122", subject: "WiFi Connectivity Issue in Conf Room A", priority: "High", requester: "Sara D.", color: "text-rose-400 bg-rose-500/10 border-rose-500/25" },
                      { id: "#IT-85110", subject: "Printer Offline on 3rd Floor", priority: "Medium", requester: "Dave M.", color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
                      { id: "#IT-85090", subject: "Reset Azure AD Password for onboarding", priority: "Low", requester: "HR Ops", color: "text-blue-400 bg-blue-500/10 border-blue-500/25" }
                    ].map((ticket) => (
                      <div key={ticket.id} className="p-3.5 border border-border/40 bg-white/5 rounded-2xl flex justify-between items-center text-sm">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-rose-400 font-bold">{ticket.id}</span>
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase", ticket.color)}>{ticket.priority}</span>
                          </div>
                          <p className="font-semibold text-foreground mt-1">{ticket.subject}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Requested by: {ticket.requester}</p>
                        </div>
                        <button className="text-[11px] font-semibold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1.5 rounded-lg shadow transition-all">Assign</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "reimbursements" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Expense Claim Activity</span>
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto">
                    {[
                      { title: "Client Lunch meeting", amount: "₹3,500", status: "Pending Approval", color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
                      { title: "Office Whiteboard Supplies", amount: "₹1,200", status: "Approved", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
                      { title: "Internet Bill Reimbursement", amount: "₹850", status: "Paid", color: "text-blue-400 bg-blue-500/10 border-blue-500/25" }
                    ].map((claim, i) => (
                      <div key={i} className="p-3.5 border border-border/40 bg-white/5 rounded-2xl flex justify-between items-center text-sm">
                        <div>
                          <p className="font-semibold text-foreground">{claim.title}</p>
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase mt-1 inline-block", claim.color)}>{claim.status}</span>
                        </div>
                        <span className="font-bold text-foreground text-base shrink-0">{claim.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "focus_mode" && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/25 rounded-2xl">
                    <Brain className="h-8 w-8 text-purple-400 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Active Focus Session Metrics</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">You have completed 2.5h of your 4.0h daily focus time goal (62%).</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2.5">
                    <span className="text-xs font-bold text-muted-foreground uppercase px-1">This Week's Daily Focus Time</span>
                    <div className="space-y-2 border border-border/40 rounded-2xl p-4 bg-white/5">
                      {[
                        { day: "Today (Thu)", hours: "2.5h / 4h", percent: 62 },
                        { day: "Wednesday", hours: "4.5h / 4h", percent: 100 },
                        { day: "Tuesday", hours: "3.5h / 4h", percent: 87 },
                        { day: "Monday", hours: "4.0h / 4h", percent: 100 }
                      ].map((day, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex justify-between text-xs font-medium">
                            <span className="text-muted-foreground">{day.day}</span>
                            <span className="text-foreground font-bold">{day.hours}</span>
                          </div>
                          <div className="w-full bg-white/15 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-purple-500 h-full rounded-full" style={{ width: `${day.percent}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedCard === "org_pulse" && (
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-pink-500/10 border border-pink-500/25 p-4 rounded-2xl">
                      <span className="text-xs text-muted-foreground font-semibold">Pulse Score</span>
                      <p className="text-3xl font-bold mt-1 text-pink-400">8.4 / 10</p>
                      <span className="text-[10px] text-pink-300 font-semibold bg-pink-500/20 px-1.5 py-0.5 rounded mt-1.5 inline-block">▲ +0.2 this week</span>
                    </div>
                    <div className="bg-rose-500/10 border border-rose-500/25 p-4 rounded-2xl">
                      <span className="text-xs text-muted-foreground font-semibold">Participation</span>
                      <p className="text-3xl font-bold mt-1 text-rose-400">92%</p>
                      <span className="text-[10px] text-rose-300 font-semibold bg-rose-500/20 px-1.5 py-0.5 rounded mt-1.5 inline-block">112 responses</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs font-bold text-muted-foreground uppercase px-1">Feedback Highlights</span>
                    <div className="space-y-2 border border-border/40 rounded-2xl p-4 bg-white/5 text-xs divide-y divide-border/40">
                      <div className="pb-2.5">
                        <span className="font-semibold text-emerald-400">Positive Feedback (84%)</span>
                        <p className="text-muted-foreground mt-1">"The team appreciates the flexible hybrid setup and clarity in milestone timelines."</p>
                      </div>
                      <div className="pt-2.5 pb-2.5">
                        <span className="font-semibold text-amber-400">Constructive Feedback (12%)</span>
                        <p className="text-muted-foreground mt-1">"A few developers requested standardizing the repository check-in pipelines to avoid delay."</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedCard === "skill_progress" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Compliance & Upskilling Status</span>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {[
                      { name: "Security & Data Compliance 2026", progress: 78, due: "in 5 days", color: "bg-teal-400" },
                      { name: "POSH Training & Conduct", progress: 100, due: "Completed", color: "bg-emerald-400" },
                      { name: "Advanced React & Architecture Patterns", progress: 25, due: "in 18 days", color: "bg-teal-400" }
                    ].map((course, i) => (
                      <div key={i} className="p-4 border border-border/40 bg-white/5 rounded-2xl space-y-2">
                        <div className="flex justify-between items-start text-sm">
                          <h4 className="font-semibold text-foreground max-w-[280px]">{course.name}</h4>
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 uppercase", course.progress === 100 ? "text-emerald-300 bg-emerald-500/20" : "text-teal-300 bg-teal-500/20")}>{course.due}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="text-foreground font-bold">{course.progress}%</span>
                          </div>
                          <div className="w-full bg-white/15 h-1.5 rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full", course.color)} style={{ width: `${course.progress}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "system_health" && (
                <div className="space-y-3.5 pt-2">
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl text-xs font-semibold text-emerald-400">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    ALL IT INFRASTRUCTURE OPERATING NORMALLY
                  </div>

                  <div className="divide-y divide-border/40 border border-border/40 rounded-2xl overflow-hidden bg-white/5">
                    {[
                      { name: "Frontend Client API Portal", status: "Operational", detail: "12ms latency · 0.0% loss", color: "text-emerald-400" },
                      { name: "Centriq Core Database cluster", status: "Operational", detail: "99.99% uptime · 4% connections", color: "text-emerald-400" },
                      { name: "Background Workers & Redis Server", status: "Operational", detail: "100% caching hit rate", color: "text-emerald-400" },
                      { name: "Email Delivery & Notifications API", status: "Operational", detail: "Avg queue delay: <1.2s", color: "text-emerald-400" }
                    ].map((srv, i) => (
                      <div key={i} className="px-4 py-3 flex justify-between items-center text-sm">
                        <div>
                          <p className="font-semibold text-foreground">{srv.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{srv.detail}</p>
                        </div>
                        <span className={cn("text-xs font-bold", srv.color)}>{srv.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "project_milestones" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Project Milestone Checklist</span>
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto">
                    {[
                      { title: "Sprint 4 Final Delivery & Demo", date: "Aug 15, 2026", status: "In Progress", color: "text-amber-300 bg-amber-500/25 border-amber-500/20" },
                      { title: "Beta Release Security Audit & Signing", date: "Aug 30, 2026", status: "Scheduled", color: "text-blue-300 bg-blue-500/25 border-blue-500/20" },
                      { title: "Production Deployment Phase 1", date: "Sep 10, 2026", status: "Scheduled", color: "text-blue-300 bg-blue-500/25 border-blue-500/20" },
                      { title: "Post-Launch Performance Review", date: "Sep 20, 2026", status: "Scheduled", color: "text-blue-300 bg-blue-500/25 border-blue-500/20" }
                    ].map((ms, i) => (
                      <div key={i} className="p-4 border border-border/40 bg-white/5 rounded-2xl space-y-1">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-foreground text-sm max-w-[280px]">{ms.title}</h4>
                          <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded border uppercase shrink-0", ms.color)}>{ms.status}</span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Due: {ms.date}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "kudos_board" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">Recent Team Recognition</span>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {[
                      { sender: "Alice Smith", receiver: "Bob Johnson", message: "Great delivery! Thanks for staying late to ensure the hotfix got deployed smoothly.", date: "Today" },
                      { sender: "Sarah Jenkins", receiver: "Dave Miller", message: "Awesome UX improvements on the search bar dashboard. It feels much faster and matches our style guide perfectly!", date: "Yesterday" },
                      { sender: "Marc Thomas", receiver: "HR Support Team", message: "Excellent coordination during the onboarding week. The new team members felt very welcome and set up quickly.", date: "3 days ago" }
                    ].map((kudos, i) => (
                      <div key={i} className="p-4 border border-border/40 bg-white/5 rounded-2xl space-y-2 flex flex-col">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-yellow-400">★ Kudos Awarded</span>
                          <span className="text-muted-foreground">{kudos.date}</span>
                        </div>
                        <p className="text-xs italic text-foreground leading-relaxed">"{kudos.message}"</p>
                        <div className="text-[11px] text-muted-foreground mt-1 pt-1.5 border-t border-white/5 flex items-center gap-1">
                          <span>From</span>
                          <span className="font-bold text-foreground">{kudos.sender}</span>
                          <span>to</span>
                          <span className="font-bold text-foreground">{kudos.receiver}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCard === "new_hires_onboarding" && (
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase px-1">New Hire Onboarding Tracker</span>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {[
                      { name: "Michael Chang", role: "Frontend Engineer", start: "Aug 17", steps: ["Laptop provisioning (Done)", "Email & Azure Setup (Done)", "Introductory Call (Pending)"] },
                      { name: "Sophia Martinez", role: "UX Designer", start: "Aug 17", steps: ["Software licenses (Done)", "Onboarding checklist (Done)", "Buddy assignment (Done)"] }
                    ].map((hire, i) => (
                      <div key={i} className="p-4 border border-border/40 bg-white/5 rounded-2xl space-y-2">
                        <div className="flex justify-between items-start text-sm">
                          <div>
                            <h4 className="font-bold text-foreground">{hire.name}</h4>
                            <p className="text-xs text-muted-foreground">{hire.role} · Starts: {hire.start}</p>
                          </div>
                        </div>
                        <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                          {hire.steps.map((step, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs">
                              <span className={cn("h-1.5 w-1.5 rounded-full", step.includes("Pending") ? "bg-amber-400" : "bg-emerald-400")} />
                              <span className={step.includes("Pending") ? "text-muted-foreground" : "text-foreground font-medium"}>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

