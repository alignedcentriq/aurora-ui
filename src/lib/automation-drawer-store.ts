import { create } from "zustand";

interface AutomationDrawerStore {
  isOpen: boolean;
  portalId: string | undefined;
  portalLabel: string | undefined;
  openDrawer: (portalId?: string, portalLabel?: string) => void;
  closeDrawer: () => void;
}

export const useAutomationDrawer = create<AutomationDrawerStore>((set) => ({
  isOpen: false,
  portalId: undefined,
  portalLabel: undefined,
  openDrawer: (portalId, portalLabel) => set({ isOpen: true, portalId, portalLabel }),
  closeDrawer: () => set({ isOpen: false }),
}));
