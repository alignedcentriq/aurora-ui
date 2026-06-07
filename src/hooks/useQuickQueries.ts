import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { QUICK_QUERIES, QuickQuery } from "@/lib/quickQueries";

const STORAGE_PREFIX = "centriq_quick_queries_";

export function useQuickQueries() {
  const { user } = useAuth();
  const [queries, setQueries] = useState<QuickQuery[]>([]);

  const userEmail = user?.email || "anonymous";
  const storageKey = `${STORAGE_PREFIX}${userEmail}`;

  // Load from LocalStorage or initialize with defaults
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setQueries(JSON.parse(stored));
      } catch {
        setQueries(QUICK_QUERIES);
      }
    } else {
      setQueries(QUICK_QUERIES);
    }
  }, [storageKey]);

  const saveQueries = (newQueries: QuickQuery[]) => {
    setQueries(newQueries);
    localStorage.setItem(storageKey, JSON.stringify(newQueries));
  };

  const addQuery = (label: string, prompt: string, category: "it" | "admin" | "hr") => {
    // Check if prompt already exists to avoid duplicates
    if (queries.some((q) => q.prompt === prompt)) {
      return;
    }
    const newQuery: QuickQuery = {
      label,
      prompt,
      icon: "Search", // Default icon for custom searches
      iconColor: "text-primary",
      category,
      isCustom: true,
    };
    saveQueries([...queries, newQuery]);
  };

  const removeQuery = (prompt: string) => {
    const filtered = queries.filter((q) => q.prompt !== prompt);
    saveQueries(filtered);
  };

  const resetToDefaults = () => {
    saveQueries(QUICK_QUERIES);
  };

  return {
    queries,
    addQuery,
    removeQuery,
    resetToDefaults,
  };
}
