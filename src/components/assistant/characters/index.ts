import type { ComponentType } from "react";
import type { BuddyColorPreset } from "@/lib/settings-store";

import { RobotThinking, RobotListening } from "./RobotBuddy";
import { DroneThinking, DroneListening } from "./DroneBuddy";
import { ChipThinking, ChipListening } from "./ChipBuddy";
import { AstroThinking, AstroListening } from "./AstroBuddy";

export interface BuddyCharacterDef {
  id: string;
  label: string;
  description: string;
  /** Emoji shown in picker */
  emoji: string;
  Thinking: ComponentType<{ colors: BuddyColorPreset }>;
  Listening: ComponentType<{ colors: BuddyColorPreset }>;
}

export const BUDDY_CHARACTERS: BuddyCharacterDef[] = [
  {
    id: "robot",
    label: "Robot",
    description: "Classic AI bot with antenna",
    emoji: "🤖",
    Thinking: RobotThinking,
    Listening: RobotListening,
  },
  {
    id: "drone",
    label: "Drone",
    description: "Hovering quadcopter with camera",
    emoji: "🛸",
    Thinking: DroneThinking,
    Listening: DroneListening,
  },
  {
    id: "chip",
    label: "Chip",
    description: "CPU microchip with circuit traces",
    emoji: "🔲",
    Thinking: ChipThinking,
    Listening: ChipListening,
  },
  {
    id: "astro",
    label: "Astro",
    description: "Astronaut helmet with visor",
    emoji: "🧑‍🚀",
    Thinking: AstroThinking,
    Listening: AstroListening,
  },
];

export function getCharacter(id: string): BuddyCharacterDef {
  return BUDDY_CHARACTERS.find((c) => c.id === id) ?? BUDDY_CHARACTERS[0];
}
