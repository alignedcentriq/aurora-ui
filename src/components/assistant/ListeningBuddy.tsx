import { useBuddyColors, useSettings } from "@/lib/settings-store";
import { getCharacter } from "./characters";

/**
 * ListeningBuddy — Renders the user's chosen buddy character
 * in its "listening" pose. The character SVG comes from the registry.
 */
export function ListeningBuddy() {
  const colors = useBuddyColors();
  const charId = useSettings((s) => s.buddyCharId);
  const character = getCharacter(charId);
  const ListeningComponent = character.Listening;

  return <ListeningComponent colors={colors} />;
}
