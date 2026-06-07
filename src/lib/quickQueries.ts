import {
  Car,
  Monitor,
  Headphones,
  Wifi,
  Package,
  Receipt,
  CalendarDays,
  UserPlus,
  CalendarX2,
  Home,
  FileSearch,
  Search,
  Sparkles,
  Bookmark,
} from "lucide-react";

export const ICON_MAP = {
  Car,
  Monitor,
  Headphones,
  Wifi,
  Package,
  Receipt,
  CalendarDays,
  UserPlus,
  CalendarX2,
  Home,
  FileSearch,
  Search,
  Sparkles,
  Bookmark,
};

export type IconName = keyof typeof ICON_MAP;

export type QuickQuery = {
  label: string;
  prompt: string;
  icon: IconName;
  iconColor: string;
  category: "it" | "admin" | "hr";
  isCustom?: boolean;
};

export const QUICK_QUERIES: QuickQuery[] = [
  // IT
  { label: "Request parking sticker", prompt: "I need a parking sticker", icon: "Car", iconColor: "text-amber-500", category: "it" },
  { label: "Install software", prompt: "I need to install software on my laptop", icon: "Monitor", iconColor: "text-violet-500", category: "it" },
  { label: "IT support ticket", prompt: "I need to raise an IT support ticket", icon: "Headphones", iconColor: "text-blue-500", category: "it" },
  { label: "Request VPN access", prompt: "I need VPN access", icon: "Wifi", iconColor: "text-emerald-500", category: "it" },
  { label: "Asset request", prompt: "I need to request a new asset (laptop/equipment)", icon: "Package", iconColor: "text-rose-500", category: "it" },
  // Admin
  { label: "Expense reimbursement", prompt: "I want to submit an expense reimbursement", icon: "Receipt", iconColor: "text-orange-500", category: "admin" },
  { label: "Book a meeting room", prompt: "I want to book a meeting room", icon: "CalendarDays", iconColor: "text-cyan-500", category: "admin" },
  { label: "Request visitor pass", prompt: "I need to request a visitor pass", icon: "UserPlus", iconColor: "text-indigo-500", category: "admin" },
  // HR
  { label: "Apply for leave", prompt: "I want to apply for leave", icon: "CalendarX2", iconColor: "text-green-500", category: "hr" },
  { label: "Request WFH", prompt: "I want to request work from home", icon: "Home", iconColor: "text-sky-500", category: "hr" },
  { label: "HR policy question", prompt: "I have a question about HR policy", icon: "FileSearch", iconColor: "text-amber-600", category: "hr" },
];

export const QUERY_CATEGORY_LABELS: Record<QuickQuery["category"], string> = {
  it: "IT Support",
  admin: "Admin",
  hr: "HR",
};
