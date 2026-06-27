import {
  BarChart3,
  BookOpen,
  FolderSearch,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ModeKey = "analytics" | "training" | "project" | "resource";

export interface ChatMode {
  key: ModeKey;
  command: string;
  label: string;
  color: {
    badge: string;
    banner: string;
    dot: string;
  };
  Icon: LucideIcon;
  description: string;
  starters: string[];
  systemHint: string;
}

export const CHAT_MODES: Record<ModeKey, ChatMode> = {
  analytics: {
    key: "analytics",
    command: "/analytics",
    label: "Analytics Builder",
    color: {
      badge: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
      banner: "border-violet-300/60 bg-violet-50 text-violet-900 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300",
      dot: "bg-violet-500",
    },
    Icon: BarChart3,
    description: "Build dashboards, run NL queries, explore ROI metrics",
    starters: [
      "Show ROI metrics for Q2",
      "Build a headcount trend chart",
      "What is the attrition rate this year?",
      "Query leave data by department",
    ],
    systemHint: "ACTIVE MODE: Analytics Builder. Focus on analytics, dashboards, NL-to-data queries, ROI analysis, and data exploration. Prioritize analytics-related tools.",
  },
  training: {
    key: "training",
    command: "/training",
    label: "Learning Advisor",
    color: {
      badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
      banner: "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    Icon: BookOpen,
    description: "Course recommendations, skill gap analysis, learning plans",
    starters: [
      "Recommend a Python course for me",
      "What training is available for React?",
      "Show my team's skill gaps",
      "Create a learning plan for cloud skills",
    ],
    systemHint: "ACTIVE MODE: Learning Advisor. Focus on recommending courses (Udemy, TechElevate), building learning plans, mapping skill gaps to training resources.",
  },
  project: {
    key: "project",
    command: "/project",
    label: "Project IQ",
    color: {
      badge: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
      banner: "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300",
      dot: "bg-amber-500",
    },
    Icon: FolderSearch,
    description: "Find similar projects, lessons learned, experts, assets",
    starters: [
      "Find projects similar to Project Aurora",
      "What lessons did Project Phoenix have?",
      "Who are the React experts in the org?",
      "Find reusable assets for mobile dev",
    ],
    systemHint: "ACTIVE MODE: Project IQ. Focus on project insights, finding similar projects, lessons learned, subject matter experts, and reusable project assets.",
  },
  resource: {
    key: "resource",
    command: "/resource",
    label: "Resource Finder",
    color: {
      badge: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20 dark:text-cyan-400",
      banner: "border-cyan-300/60 bg-cyan-50 text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-950/40 dark:text-cyan-300",
      dot: "bg-cyan-500",
    },
    Icon: Users,
    description: "Match skills × availability for staffing needs",
    starters: [
      "Find available React devs for July",
      "Who has PowerBI skills and is free next month?",
      "Show bench availability for senior devs",
      "Match resources for a cloud project",
    ],
    systemHint: "ACTIVE MODE: Resource Finder. Focus on matching people to project needs based on skills and availability. Help find the right resources and support staffing decisions.",
  },
};

// Map from slash command → mode key
export const MODE_COMMANDS: Record<string, ModeKey> = {
  "/analytics": "analytics",
  "/training": "training",
  "/project": "project",
  "/resource": "resource",
};

/**
 * Returns the ModeKey if text is a mode-activate command,
 * "exit" if it's an exit command, or null otherwise.
 */
export function parseModeCommand(text: string): ModeKey | "exit" | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "/exit" || trimmed === "/mode off") return "exit";
  return MODE_COMMANDS[trimmed] ?? null;
}
