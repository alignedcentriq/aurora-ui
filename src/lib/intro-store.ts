import { create } from "zustand";
import { persist } from "zustand/middleware";

interface IntroState {
  /** Whether the user has ever finished/skipped the intro on this device. */
  hasSeenIntro: boolean;
  /** Whether the intro overlay is currently visible. */
  isOpen: boolean;
  /** Open the intro tour (used by the "Watch intro" replay button). */
  open: () => void;
  /** Close + mark as seen (finished or skipped). */
  close: () => void;
  /** Auto-play once on first visit. Returns true if it opened. */
  maybeAutoPlay: () => boolean;
}

export const useIntroStore = create<IntroState>()(
  persist(
    (set, get) => ({
      hasSeenIntro: false,
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false, hasSeenIntro: true }),
      maybeAutoPlay: () => {
        if (get().hasSeenIntro) return false;
        set({ isOpen: true });
        return true;
      },
    }),
    { name: "centriq-intro-tour" },
  ),
);
