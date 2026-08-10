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

export type CountryCode = "US" | "UK" | "IN" | "DE" | "SG" | "AE" | "JP" | "AU" | "IE";

export interface CountryDef {
  code: CountryCode;
  name: string;
  flag: string;
  office: string;
  timezone: string;
  holiday: {
    name: string;
    date: string;
    relative: string;
  };
  leave: {
    amount: number;
    label: string;
  };
  helpdesk: string;
}

export const COUNTRIES: CountryDef[] = [
  {
    code: "US",
    name: "United States",
    flag: "🇺🇸",
    office: "New York HQ",
    timezone: "America/New_York",
    holiday: { name: "Independence Day", date: "Jul 4", relative: "1 month away" },
    leave: { amount: 15, label: "PTO Days" },
    helpdesk: "ext 9111",
  },
  {
    code: "UK",
    name: "United Kingdom",
    flag: "🇬🇧",
    office: "London Office",
    timezone: "Europe/London",
    holiday: { name: "Bank Holiday", date: "Aug 31", relative: "3 months away" },
    leave: { amount: 28, label: "Annual Leave" },
    helpdesk: "ext 4444",
  },
  {
    code: "IN",
    name: "India",
    flag: "🇮🇳",
    office: "Bengaluru Hub",
    timezone: "Asia/Kolkata",
    holiday: { name: "Independence Day", date: "Aug 15", relative: "2 months away" },
    leave: { amount: 18, label: "Earned Leaves" },
    helpdesk: "ext 1000",
  },
  {
    code: "DE",
    name: "Germany",
    flag: "🇩🇪",
    office: "Berlin Tech Hub",
    timezone: "Europe/Berlin",
    holiday: { name: "Unity Day", date: "Oct 3", relative: "4 months away" },
    leave: { amount: 30, label: "Urlaub Days" },
    helpdesk: "ext 2200",
  },
  {
    code: "SG",
    name: "Singapore",
    flag: "🇸🇬",
    office: "Marina Office",
    timezone: "Asia/Singapore",
    holiday: { name: "National Day", date: "Aug 9", relative: "2 months away" },
    leave: { amount: 21, label: "Vacation Days" },
    helpdesk: "ext 8888",
  },
  {
    code: "AE",
    name: "United Arab Emirates",
    flag: "🇦🇪",
    office: "Dubai Internet City",
    timezone: "Asia/Dubai",
    holiday: { name: "National Day", date: "Dec 2", relative: "6 months away" },
    leave: { amount: 30, label: "Annual Vacation" },
    helpdesk: "ext 7000",
  },
  {
    code: "JP",
    name: "Japan",
    flag: "🇯🇵",
    office: "Tokyo Office",
    timezone: "Asia/Tokyo",
    holiday: { name: "Mountain Day", date: "Aug 11", relative: "2 months away" },
    leave: { amount: 20, label: "Paid Leave" },
    helpdesk: "ext 3300",
  },
  {
    code: "AU",
    name: "Australia",
    flag: "🇦🇺",
    office: "Sydney Office",
    timezone: "Australia/Sydney",
    holiday: { name: "Australia Day", date: "Jan 26", relative: "8 months away" },
    leave: { amount: 20, label: "Annual Leave" },
    helpdesk: "ext 6100",
  },
  {
    code: "IE",
    name: "Ireland",
    flag: "🇮🇪",
    office: "Dublin Office",
    timezone: "Europe/Dublin",
    holiday: { name: "St. Patrick's Day", date: "Mar 17", relative: "9 months away" },
    leave: { amount: 20, label: "Annual Leave" },
    helpdesk: "ext 3530",
  },
];

/** A single world clock the user has pinned to the Office Clocks overlay. */
export interface WorldClock {
  /** Stable unique id — the IANA timezone works well as the id. */
  id: string;
  /** Display name, usually the city (e.g. "New York"). */
  label: string;
  /** Subtitle line (e.g. "US HQ" or a country/region). */
  region: string;
  /** Flag/emoji shown on the card. */
  flag: string;
  /** IANA timezone string (e.g. "America/New_York"). */
  timezone: string;
}

/** Flags for well-known timezones; everything else falls back to 🌍. */
const TZ_FLAGS: Record<string, string> = {
  "America/New_York": "🇺🇸",
  "America/Chicago": "🇺🇸",
  "America/Denver": "🇺🇸",
  "America/Los_Angeles": "🇺🇸",
  "America/Toronto": "🇨🇦",
  "America/Sao_Paulo": "🇧🇷",
  "America/Mexico_City": "🇲🇽",
  "Europe/London": "🇬🇧",
  "Europe/Dublin": "🇮🇪",
  "Europe/Paris": "🇫🇷",
  "Europe/Berlin": "🇩🇪",
  "Europe/Amsterdam": "🇳🇱",
  "Europe/Madrid": "🇪🇸",
  "Europe/Zurich": "🇨🇭",
  "Europe/Moscow": "🇷🇺",
  "Africa/Johannesburg": "🇿🇦",
  "Africa/Cairo": "🇪🇬",
  "Asia/Dubai": "🇦🇪",
  "Asia/Kolkata": "🇮🇳",
  "Asia/Karachi": "🇵🇰",
  "Asia/Singapore": "🇸🇬",
  "Asia/Hong_Kong": "🇭🇰",
  "Asia/Shanghai": "🇨🇳",
  "Asia/Tokyo": "🇯🇵",
  "Asia/Seoul": "🇰🇷",
  "Australia/Sydney": "🇦🇺",
  "Pacific/Auckland": "🇳🇿",
  UTC: "🌐",
};

/** Popular cities surfaced first in the "add clock" picker. */
export const POPULAR_CLOCK_TZS: string[] = [
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

/** Default clocks shown before the user customizes anything. */
export const DEFAULT_WORLD_CLOCKS: WorldClock[] = [
  { id: "America/New_York", label: "New York", region: "US HQ", flag: "🇺🇸", timezone: "America/New_York" },
  { id: "Europe/Dublin", label: "Dublin", region: "Ireland Office", flag: "🇮🇪", timezone: "Europe/Dublin" },
  { id: "Asia/Dubai", label: "Dubai", region: "UAE Office", flag: "🇦🇪", timezone: "Asia/Dubai" },
  { id: "Asia/Kolkata", label: "Bengaluru", region: "India Hub", flag: "🇮🇳", timezone: "Asia/Kolkata" },
];

/** Build a WorldClock from any IANA timezone id. */
export function clockFromTimezone(tz: string): WorldClock {
  const parts = tz.split("/");
  const label = (parts[parts.length - 1] || tz).replace(/_/g, " ");
  const region = (parts.length > 1 ? parts[0] : "Universal").replace(/_/g, " ");
  return { id: tz, label, region, flag: TZ_FLAGS[tz] ?? "🌍", timezone: tz };
}

/** Every IANA timezone the browser knows about (falls back to the popular list). */
export function listAllTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    // older engine — fall through
  }
  return POPULAR_CLOCK_TZS;
}

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

  /** Buddy enabled status */
  buddyEnabled: boolean;
  setBuddyEnabled: (enabled: boolean) => void;

  /** Buddy gender preference */
  buddyGender: "male" | "female" | "auto";
  setBuddyGender: (gender: "male" | "female" | "auto") => void;

  /** Active country context */
  country: CountryCode;
  setCountry: (country: CountryCode) => void;

  /** Selected clocks codes (legacy — kept for backward compat) */
  clocks: CountryCode[];
  toggleClock: (code: CountryCode) => void;

  /** World clocks pinned to the Office Clocks overlay */
  worldClocks: WorldClock[];
  addClock: (clock: WorldClock) => void;
  removeClock: (id: string) => void;
  resetClocks: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (theme) => set({ theme }),

      loadingCharId: "centriq",
      loadingCharCustom: "",
      setLoadingCharId: (id) => set({ loadingCharId: id }),
      setLoadingCharCustom: (char) => set({ loadingCharCustom: char }),

      buddyColorId: "blue",
      setBuddyColorId: (id) => set({ buddyColorId: id }),

      buddyCharId: "robot",
      setBuddyCharId: (id) => set({ buddyCharId: id }),

      buddyEnabled: false,
      setBuddyEnabled: (enabled) => set({ buddyEnabled: enabled }),

      buddyGender: "auto",
      setBuddyGender: (gender) => set({ buddyGender: gender }),

      country: "US",
      setCountry: (country) => set({ country }),

      clocks: ["US", "IN", "AE", "IE"],
      toggleClock: (code) =>
        set((state) => ({
          clocks: state.clocks.includes(code)
            ? state.clocks.filter((c) => c !== code)
            : [...state.clocks, code],
        })),

      worldClocks: DEFAULT_WORLD_CLOCKS,
      addClock: (clock) =>
        set((state) =>
          state.worldClocks.some((c) => c.id === clock.id)
            ? state
            : { worldClocks: [...state.worldClocks, clock] },
        ),
      removeClock: (id) =>
        set((state) => ({ worldClocks: state.worldClocks.filter((c) => c.id !== id) })),
      resetClocks: () => set({ worldClocks: DEFAULT_WORLD_CLOCKS }),
    }),
    {
      name: "aurora-settings",
      version: 2,
      migrate: (persisted: any, version) => {
        // v0 stores had no worldClocks — seed the defaults.
        if (version < 1 && persisted && !persisted.worldClocks) {
          persisted.worldClocks = DEFAULT_WORLD_CLOCKS;
        }
        // v2: switch everyone's default theme to dark, one time.
        if (version < 2 && persisted) {
          persisted.theme = "dark";
        }
        return persisted as SettingsState;
      },
    },
  ),
);

/** Helper to resolve the current preset (falls back to blue) */
export function useBuddyColors(): BuddyColorPreset {
  const id = useSettings((s) => s.buddyColorId);
  return BUDDY_PRESETS.find((p) => p.id === id) ?? BUDDY_PRESETS[0];
}

/** Infer the user's country code from their browser timezone. */
export function detectCountryFromTimezone(): CountryCode {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "IN";
  if (tz === "Asia/Dubai") return "AE";
  if (tz === "Europe/London") return "UK";
  if (tz.startsWith("Europe/Berlin") || tz === "Europe/Amsterdam") return "DE";
  if (tz === "Asia/Singapore") return "SG";
  if (tz === "Asia/Tokyo") return "JP";
  if (tz.startsWith("Australia/")) return "AU";
  if (tz === "Europe/Dublin") return "IE";
  if (tz.startsWith("America/")) return "US";
  return "US";
}
