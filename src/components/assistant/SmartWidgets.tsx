import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type Role } from "@/lib/auth-store";

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

function CircularProgress({ value, size = 48, strokeWidth = 4, color = "var(--primary)" }: {
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
  | "reimbursements";

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
    allowedRoles: ["Employee", "HR", "PMO", "Admin", "Functional Manager"],
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
    allowedRoles: ["HR", "IT", "PMO", "Admin", "Functional Manager"],
    prompt: (role) =>
      role === "HR" || role === "Functional Manager"
        ? "Show pending leave approvals from my reportees"
        : "Show my pending tasks",
  },
  {
    id: "it_tickets",
    label: "IT Tickets",
    description: "Your open support tickets",
    allowedRoles: ["IT", "Admin", "Employee"],
    prompt: "What's the status of my IT tickets?",
  },
  {
    id: "team_leave",
    label: "Team Leave",
    description: "Leave status for your reportees",
    allowedRoles: ["HR", "Functional Manager", "Admin", "PMO"],
    prompt: "Show leave status for my reportees",
  },
  {
    id: "open_tickets",
    label: "Open Tickets",
    description: "All unresolved IT tickets",
    allowedRoles: ["IT", "Admin"],
    prompt: "Show all open IT tickets",
  },
  {
    id: "reimbursements",
    label: "Reimbursements",
    description: "Your pending expense claims",
    allowedRoles: ["Employee", "Admin"],
    prompt: "What's the status of my reimbursement requests?",
  },
];

const ROLE_DEFAULTS: Record<Role, CardId[]> = {
  Employee: ["leave_balance", "holidays", "it_tickets"],
  HR: ["pending_approvals", "leave_balance", "team_leave"],
  IT: ["it_tickets", "open_tickets", "pending_approvals"],
  PMO: ["pending_approvals", "leave_balance", "holidays"],
  Admin: ["pending_approvals", "it_tickets", "leave_balance", "holidays"],
  "Functional Manager": ["pending_approvals", "team_leave", "leave_balance"],
};

const CARD_HOVER: Record<CardId, string> = {
  leave_balance: "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20",
  holidays: "hover:shadow-lg hover:shadow-cyan-500/5 hover:border-cyan-500/20",
  pending_approvals: "hover:shadow-lg hover:shadow-amber-500/5 hover:border-amber-500/20",
  it_tickets: "hover:shadow-lg hover:shadow-violet-500/5 hover:border-violet-500/20",
  team_leave: "hover:shadow-lg hover:shadow-indigo-500/5 hover:border-indigo-500/20",
  open_tickets: "hover:shadow-lg hover:shadow-rose-500/5 hover:border-rose-500/20",
  reimbursements: "hover:shadow-lg hover:shadow-orange-500/5 hover:border-orange-500/20",
};

const CARD_LEFT_ACCENT: Record<CardId, string> = {
  leave_balance: "border-l-emerald-500",
  holidays: "border-l-cyan-500",
  pending_approvals: "border-l-amber-500",
  it_tickets: "border-l-violet-500",
  team_leave: "border-l-indigo-500",
  open_tickets: "border-l-rose-500",
  reimbursements: "border-l-orange-500",
};

function getPrompt(card: CardDef, role: Role): string {
  return typeof card.prompt === "function" ? card.prompt(role) : card.prompt;
}

function isCardAllowed(card: CardDef, role: Role): boolean {
  return card.allowedRoles === "all" || (card.allowedRoles as Role[]).includes(role);
}

// ── Card content ──────────────────────────────────────────────────────────────

function CardContent({ id }: { id: CardId }) {
  switch (id) {
    case "leave_balance":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
              <CalendarDays className="h-4 w-4 text-emerald-500" />
            </div>
            <CircularProgress value={60} size={36} strokeWidth={3} color="var(--accent-emerald)" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">12</p>
            <p className="text-[11px] text-muted-foreground font-medium">Leaves remaining</p>
          </div>
        </>
      );

    case "holidays":
      return (
        <>
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10">
              <Palmtree className="h-4 w-4 text-cyan-500" />
            </div>
            <span className="text-[11px] font-semibold text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded-full">
              Soon
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate">Independence Day</p>
            <p className="text-[11px] text-muted-foreground font-medium">Aug 15 · 2 months away</p>
          </div>
        </>
      );

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
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">All resolved</span>
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
            <p className="text-[11px] text-muted-foreground font-medium">Open tickets</p>
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
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">2 pending</span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">Expense claims</p>
          </div>
        </>
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface SmartWidgetsProps {
  onAction?: (prompt: string) => void;
}

export function SmartWidgets({ onAction }: SmartWidgetsProps) {
  const { user } = useAuth();
  const role: Role = user?.role ?? "Employee";

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
    return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS["Employee"];
  });

  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
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
    (c) => isCardAllowed(c, role) && !activeCards.includes(c.id)
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
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
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
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full"
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
                className="relative"
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
                      className="absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                      aria-label={`Remove ${def.label}`}
                    >
                      <X className="h-3 w-3" />
                    </motion.button>
                  )}
                </AnimatePresence>

                <motion.button
                  whileHover={editMode ? {} : { y: -4, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
                  whileTap={editMode ? {} : { scale: 0.97 }}
                  onClick={() => !editMode && onAction?.(getPrompt(def, role))}
                  className={cn(
                    "card-live-dot group flex flex-col gap-3 rounded-2xl glass-widget border-l-[3px] p-5 text-left w-full",
                    CARD_LEFT_ACCENT[id],
                    editMode ? "cursor-default" : CARD_HOVER[id]
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
              className="relative"
            >
              <div ref={addRef}>
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-card/30 p-4 w-full min-h-[100px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[11px] font-medium">Add card</span>
                </button>

                {/* Add dropdown */}
                <AnimatePresence>
                  {addOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full mt-1 left-0 z-20 w-52 rounded-xl border border-border bg-popover shadow-xl shadow-black/10 overflow-hidden"
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
                            <span className="text-[12px] font-medium text-foreground">{card.label}</span>
                            <span className="text-[11px] text-muted-foreground">{card.description}</span>
                          </button>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
