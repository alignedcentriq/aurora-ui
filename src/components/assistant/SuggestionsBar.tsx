import { Sparkles, Users, Wrench, FileText, Megaphone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export type SuggestionCategory = "hr" | "it" | "admin" | "org" | "all";

interface Suggestion {
  id: string;
  text: string;
  category: SuggestionCategory;
  minRole?: "employee" | "manager" | "admin";
}

import { useAuth } from "@/lib/auth-store";

const SUGGESTIONS: Suggestion[] = [
  { id: "1", text: "Apply for leave", category: "hr" },
  { id: "2", text: "View payslip", category: "hr" },
  { id: "3", text: "Team performance", category: "hr", minRole: "manager" },
  { id: "4", text: "Reset VPN", category: "it" },
  { id: "5", text: "Request Software Install", category: "it" },
  { id: "7", text: "Office policies", category: "admin" },
  { id: "8", text: "Book a room", category: "admin" },
  { id: "10", text: "Company news", category: "org" },
  { id: "11", text: "Holiday list", category: "org" },
  { id: "12", text: "Financial reports", category: "org", minRole: "admin" },
];

const CABINS: Record<string, { id: string; text: string; category: SuggestionCategory }[]> = {
  pune: [
    { id: "c1", text: "Go to Cabin 402 (Pune)", category: "admin" },
    { id: "c2", text: "IT Lab Floor 2 (Pune)", category: "admin" },
  ],
  us: [
    { id: "c3", text: "Go to Suite 10 (NYC)", category: "admin" },
    { id: "c4", text: "Tech Hub (SF)", category: "admin" },
  ],
};

const CATEGORIES = [
  { id: "all", label: "All", icon: Sparkles },
  { id: "hr", label: "HR", icon: Users },
  { id: "it", label: "IT", icon: Wrench },
  { id: "admin", label: "Admin", icon: FileText },
  { id: "org", label: "Org", icon: Megaphone },
] as const;

interface Props {
  activeCategory: SuggestionCategory;
  onCategoryChange: (cat: SuggestionCategory) => void;
  onSelect: (text: string) => void;
}

export function SuggestionsBar({ activeCategory, onCategoryChange, onSelect }: Props) {
  const { user } = useAuth();
  // 1. Role-based filtering
  const rolePriority: Record<string, number> = { Employee: 1, HR: 2, IT: 2, PMO: 2, Admin: 3 };
  const userPriority = user ? rolePriority[user.role] || 1 : 1;

  let filtered = SUGGESTIONS.filter((s) => {
    const categoryMatch = activeCategory === "all" || s.category === activeCategory;
    const roleMatch = !s.minRole || rolePriority[s.minRole] <= userPriority;
    return categoryMatch && roleMatch;
  });

  // 2. Location-aware cabin suggestions (integrated into admin or all)
  if (activeCategory === "admin" || activeCategory === "all") {
    const localCabins = CABINS["pune"] || []; // Defaulting to pune for now since user location isn't in AuthContext
    filtered = [...filtered, ...localCabins];
  }

  const finalItems = filtered.slice(0, 4);

  return (
    <div className="flex flex-col gap-3">
      {/* Category Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <motion.button
              key={cat.id}
              whileTap={{ scale: 0.93 }}
              onClick={() => onCategoryChange(cat.id as SuggestionCategory)}
              className={cn(
                "relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[11px] font-bold transition-colors z-10",
                isActive ? "text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="suggestion-cat"
                  className="absolute inset-0 rounded-full bg-primary shadow-sm shadow-primary/20"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 h-3.5 w-3.5",
                  isActive ? "text-white" : "text-primary",
                )}
              />
              <span className="relative z-10">{cat.label}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Curated Suggestions */}
      <motion.div
        key={activeCategory}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-wrap items-center gap-2"
      >
        {finalItems.map((s, idx) => (
          <motion.button
            key={s.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05, type: "spring", stiffness: 400, damping: 25 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(s.text)}
            className="flex h-9 items-center rounded-xl border border-[var(--border)] bg-card/40 backdrop-blur-sm px-4 text-xs font-semibold text-foreground/70 transition-all hover:border-primary/40 hover:bg-card/80 hover:text-primary shadow-sm whitespace-nowrap"
          >
            {s.text.includes("Cabin") && <MapPin className="mr-1.5 h-3 w-3 text-emerald-500" />}
            {s.text}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
