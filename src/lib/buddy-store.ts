import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BotState = "hidden" | "greeting" | "sitting";

interface BuddyState {
  botState: BotState;
  hasVisited: boolean;
  lastActive: number;
  setBotState: (state: BotState) => void;
  checkGreetingTrigger: () => boolean;
  updateActiveTime: () => void;
}

export const useBuddyStore = create<BuddyState>()(
  persist(
    (set, get) => ({
      botState: "hidden",
      hasVisited: false,
      lastActive: 0,
      setBotState: (botState) => set({ botState }),
      checkGreetingTrigger: () => {
        const { hasVisited, lastActive } = get();
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        // If first visit or inactive for > 1 day, trigger greeting
        const isFirstVisit = !hasVisited;
        const isInactiveOverDay = lastActive > 0 && (now - lastActive > oneDayMs);

        if (isFirstVisit || isInactiveOverDay) {
          set({ botState: "greeting", hasVisited: true, lastActive: now });
          return true;
        } else {
          // Normal visit — place the bot sitting in the sidebar straight away
          set({ botState: "sitting", lastActive: now });
          return false;
        }
      },
      updateActiveTime: () => {
        set({ lastActive: Date.now() });
      },
    }),
    {
      name: "aurora-buddy-store",
      partialize: (state) => ({
        hasVisited: state.hasVisited,
        lastActive: state.lastActive,
      }),
    }
  )
);
