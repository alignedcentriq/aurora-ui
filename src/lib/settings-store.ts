import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Color preset for the buddy character */
export interface BuddyColorPreset {
  id: string;
  label: string;
  /** Primary fill (head, body) */
  primary: string;
  /** Darker accent (hands, keyboard, feet) */
  accent: string;
  /** Lighter shade (antenna glow, overlays) */
  light: string;
  /** Subtle glow (sound waves, soft highlights) */
  glow: string;
  /** Drop-shadow rgba */
  shadow: string;
  /** Preview swatch gradient */
  swatch: string;
}

export const BUDDY_PRESETS: BuddyColorPreset[] = [
  {
    id: "blue",
    label: "Ocean Blue",
    primary: "#2563eb",
    accent: "#1d4ed8",
    light: "#60a5fa",
    glow: "#93c5fd",
    shadow: "rgba(37,99,235,0.35)",
    swatch: "linear-gradient(135deg, #2563eb, #60a5fa)",
  },
  {
    id: "purple",
    label: "Royal Purple",
    primary: "#7c3aed",
    accent: "#6d28d9",
    light: "#8b5cf6",
    glow: "#a78bfa",
    shadow: "rgba(124,58,237,0.35)",
    swatch: "linear-gradient(135deg, #7c3aed, #a78bfa)",
  },
  {
    id: "emerald",
    label: "Emerald",
    primary: "#059669",
    accent: "#047857",
    light: "#34d399",
    glow: "#6ee7b7",
    shadow: "rgba(5,150,105,0.35)",
    swatch: "linear-gradient(135deg, #059669, #34d399)",
  },
  {
    id: "rose",
    label: "Rose Pink",
    primary: "#e11d48",
    accent: "#be123c",
    light: "#fb7185",
    glow: "#fda4af",
    shadow: "rgba(225,29,72,0.35)",
    swatch: "linear-gradient(135deg, #e11d48, #fb7185)",
  },
  {
    id: "amber",
    label: "Golden Amber",
    primary: "#d97706",
    accent: "#b45309",
    light: "#fbbf24",
    glow: "#fcd34d",
    shadow: "rgba(217,119,6,0.35)",
    swatch: "linear-gradient(135deg, #d97706, #fbbf24)",
  },
  {
    id: "cyan",
    label: "Cyan Frost",
    primary: "#0891b2",
    accent: "#0e7490",
    light: "#22d3ee",
    glow: "#67e8f9",
    shadow: "rgba(8,145,178,0.35)",
    swatch: "linear-gradient(135deg, #0891b2, #22d3ee)",
  },
];

interface SettingsState {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;

  /** Loading character customization */
  loadingCharId: string;
  loadingCharCustom: string;
  setLoadingCharId: (id: string) => void;
  setLoadingCharCustom: (char: string) => void;

  /** Buddy color preset id */
  buddyColorId: string;
  setBuddyColorId: (id: string) => void;

  /** Buddy character id */
  buddyCharId: string;
  setBuddyCharId: (id: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),

      loadingCharId: "centriq",
      loadingCharCustom: "",
      setLoadingCharId: (id) => set({ loadingCharId: id }),
      setLoadingCharCustom: (char) => set({ loadingCharCustom: char }),

      buddyColorId: "blue",
      setBuddyColorId: (id) => set({ buddyColorId: id }),

      buddyCharId: "robot",
      setBuddyCharId: (id) => set({ buddyCharId: id }),
    }),
    {
      name: "aurora-settings",
    },
  ),
);

/** Helper to resolve the current preset (falls back to blue) */
export function useBuddyColors(): BuddyColorPreset {
  const id = useSettings((s) => s.buddyColorId);
  return BUDDY_PRESETS.find((p) => p.id === id) ?? BUDDY_PRESETS[0];
}
