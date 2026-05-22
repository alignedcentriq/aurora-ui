import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Palmtree,
  ListTodo,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    transition: { type: "spring", stiffness: 300, damping: 30 },
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

interface SmartWidgetsProps {
  onAction?: (prompt: string) => void;
}

export function SmartWidgets({ onAction }: SmartWidgetsProps) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full"
    >
      {/* Leave Balance */}
      <motion.button
        variants={item}
        whileHover={{ y: -3, transition: { duration: 0.2 } }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onAction?.("How many leave days do I have left?")}
        className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-4 text-left transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20"
      >
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
      </motion.button>

      {/* Upcoming Holidays */}
      <motion.button
        variants={item}
        whileHover={{ y: -3, transition: { duration: 0.2 } }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onAction?.("Show me upcoming holidays")}
        className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-4 text-left transition-shadow duration-300 hover:shadow-lg hover:shadow-cyan-500/5 hover:border-cyan-500/20"
      >
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
      </motion.button>

      {/* Pending Tasks */}
      <motion.button
        variants={item}
        whileHover={{ y: -3, transition: { duration: 0.2 } }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onAction?.("Show my pending tasks")}
        className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-4 text-left transition-shadow duration-300 hover:shadow-lg hover:shadow-amber-500/5 hover:border-amber-500/20"
      >
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
            <ListTodo className="h-4 w-4 text-amber-500" />
          </div>
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.6, type: "spring", stiffness: 400, damping: 15 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white"
          >
            3
          </motion.span>
        </div>
        <div>
          <p className="text-2xl font-bold tracking-tight text-foreground">3</p>
          <p className="text-[11px] text-muted-foreground font-medium">Pending approvals</p>
        </div>
      </motion.button>

      {/* IT Ticket Status */}
      <motion.button
        variants={item}
        whileHover={{ y: -3, transition: { duration: 0.2 } }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onAction?.("What's the status of my IT tickets?")}
        className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-4 text-left transition-shadow duration-300 hover:shadow-lg hover:shadow-violet-500/5 hover:border-violet-500/20"
      >
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
      </motion.button>
    </motion.div>
  );
}
