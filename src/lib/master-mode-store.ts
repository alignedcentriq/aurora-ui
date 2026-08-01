import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MasterModeState {
  /** When on, the chat hub ("/") renders the 3D model round-table landing instead of chat. */
  isMasterMode: boolean;
  toggle: () => void;
  set: (on: boolean) => void;
}

export const useMasterModeStore = create<MasterModeState>()(
  persist(
    (set, get) => ({
      // Defaults on: the cockpit is the intended home page for the owner account.
      // Harmless for everyone else — Master Mode only ever renders when
      // canUseMasterMode (owner-email check) also passes, in _layout.tsx / _layout.index.tsx.
      isMasterMode: true,
      toggle: () => set({ isMasterMode: !get().isMasterMode }),
      set: (on: boolean) => set({ isMasterMode: on }),
    }),
    { name: "centriq-master-mode" },
  ),
);
