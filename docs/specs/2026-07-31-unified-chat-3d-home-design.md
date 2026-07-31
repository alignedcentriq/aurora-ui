# Unified 3D + chat home — retire Master Mode toggle

Date: 2026-07-31
Status: approved, pending implementation

## Context

Master Mode ([MasterModeLanding.tsx](../../src/components/three/MasterModeLanding.tsx))
is currently a separate landing page that replaces the chat home (`/`) when a
sidebar toggle is on ([master-mode-store.ts](../../src/lib/master-mode-store.ts)),
gated to the app owner (`shivam.sharma@alignedautomation.com`) via
[_layout.index.tsx](../../src/routes/_layout.index.tsx). It shows a 3D "Model
Council" scene (glowing core + four orbiting model-tier nodes) but has no chat
composer — so using it means giving up the actual chat interface. The normal
chat home ([AssistantView.tsx](../../src/components/assistant/AssistantView.tsx))
has its own empty-state backdrop ([AmbientField.tsx](../../src/components/three/AmbientField.tsx),
a plain particle field) plus a greeting, Morning Briefing, Smart Widgets, and
"Try asking…" suggestion chips.

Problem: this forces a choice between "pretty 3D view with no chat box" and
"working chat with cards/suggestions the owner doesn't want." The two should
be one screen: the chat interface, with the 3D scene as its empty-state
backdrop instead of the plain particle field.

## Scope

Owner-only change (`shivam.sharma@alignedautomation.com`). Every other
employee's chat home is unchanged — same `AmbientField`, same Morning
Briefing/Smart Widgets/chips, always expanded, no collapsible strip.

## 1. Extract a pure backdrop component

New: `src/components/three/ModelCouncilBackdrop.tsx`. Move `Scene`, `Core`,
`NodeAvatar`, `NodeGeometry`, `DataPulse`, `ModelBadge`, and the `MODELS`
table out of `MasterModeLanding.tsx` into this file, dropping everything that
made `MasterModeLanding` a standalone page (the full-screen wrapper div, the
hero copy/CTA, the `<Canvas>` camera/device-tier wiring stays but the
component now only renders the `<Canvas>` + `Scene`, sized to fill its
parent — same absolute-fill contract `AmbientField` already has).

```tsx
interface ModelCouncilBackdropProps {
  onOpenMemoryBrain: () => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}
```

Navigation and selection state move up to the caller (`AssistantView`) via
these props instead of being wired internally with `useNavigate`/`useState` —
`AssistantView` already owns thread/navigation state, so the backdrop stays a
dumb visual component with one clear job: render the scene.

`MasterModeLanding.tsx` and `master-mode-store.ts` are deleted once
`ModelCouncilBackdrop` is wired into `AssistantView`.

## 2. Wire into AssistantView's empty state

In the existing empty-state branch (`activeThread.turns.length === 0`,
non-copilot), where `<AmbientField />` renders today:

```tsx
{isOwner ? (
  <ModelCouncilBackdrop
    onOpenMemoryBrain={() => navigate({ to: "/control-hub", search: { tab: "memory-brain" } })}
    selectedNodeId={selectedNodeId}
    onSelectNode={setSelectedNodeId}
  />
) : (
  <AmbientField />
)}
```

`isOwner` is the same email check Master Mode uses today. Greeting text,
Morning Briefing, Smart Widgets, and chips stay exactly where they are in the
JSX — only the backdrop swaps, so none of the surrounding layout code changes
for non-owner users.

The selected-node side panel (confidence/status card, currently in
`MasterModeLanding`'s JSX) moves into `AssistantView`, rendered next to the
backdrop, only when `selectedNodeId` is set — desktop-only (`hidden lg:block`),
since Master Mode never had a mobile layout for it either.

## 3. Collapsible "quick start" strip

Morning Briefing + Smart Widgets + "Try asking…" chips move into a single
collapsible row for the owner only, placed directly below the composer,
collapsed by default:

```
[ Quick start  ⌄ ]   <- closed by default
```

Expanding reveals Morning Briefing, then Smart Widgets, then the chips, in
their current order/styling — no changes to those three components
themselves. Non-owner users keep them always-expanded, unchanged.

**Fallback**: if `useDeviceTier().canRender3D` is false for the owner (no
WebGL, reduced-motion, save-data, or weak hardware — same probe
`MasterModeLanding`/`AmbientField` already use), the backdrop renders nothing
and the quick-start strip renders **expanded by default** instead of
collapsed, since there's no scene to draw attention and the shortcuts
shouldn't be hidden behind an extra click.

## 4. Remove the toggle

- `_layout.tsx`: remove the Master Mode sidebar button (`canUseMasterMode`
  block, both collapsed and expanded variants) and the auto-collapse-on-
  Master-Mode effect added in the prior pass — replaced by "sidebar
  auto-collapses when `isOwner && activeThread.turns.length === 0` on `/`",
  restoring when a conversation starts.
- `_layout.index.tsx`: remove the `isMasterMode`/`useMasterModeStore` branch
  entirely — `/` always renders `AssistantView`.
- Delete `master-mode-store.ts` (no longer referenced anywhere).

## Lifecycle & behavior

- The backdrop only ever mounts inside the `turns.length === 0` branch, same
  as `AmbientField` today — sending the first message unmounts it. No new
  transition code; the existing `motion.section` wrapper's mount/unmount
  handles the fade.
- Core click → Memory Brain nav, badge click → side info panel — both
  unchanged in behavior, just relocated to props/parent state per above.
- No new error states: `ModelCouncilBackdrop` inherits the exact same
  WebGL-probe-and-degrade path `AmbientField`/`MasterModeLanding` use today,
  so a WebGL failure behaves identically (silently skip 3D).

## Testing

Manual verification only (dev server, `mock-email` dev bypass to switch
identity) — this wires together existing, already-functional pieces
(`Composer`, `MorningBriefing`, `SmartWidgets` are untouched):

- Owner's empty state shows the 3D scene; a non-owner mock email still shows
  the plain `AmbientField` empty state.
- Quick-start row expands/collapses; Morning Briefing/Smart Widgets/chips
  render correctly inside it.
- Scene disappears after sending the first message; sidebar collapses in the
  owner's empty state and restores once chatting.
- Core click opens Memory Brain; badge click opens/closes the side panel.
