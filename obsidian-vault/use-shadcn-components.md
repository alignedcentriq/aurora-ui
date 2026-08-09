---
name: use-shadcn-components
description: Always build UI from the existing shadcn/ui components, not raw div/Tailwind reimplementations
metadata:
  type: feedback
---

When building or fixing UI, use the project's existing high-level shadcn/ui components instead of hand-rolling layouts from raw `<div>` + Tailwind. The user pushed back: "why are we using div if we have shadcn and tailwind — always use high level components and beautiful components."

**Why:** The component library at `src/components/ui/` is already complete and themed; raw `<div>` grids duplicate it, look less polished, and reintroduce bugs the components already solve (e.g. a `<div>`-grid table overflowed the screen because plain `fr` tracks don't truncate — a real `<Table className="table-fixed">` does).

**How to apply:** Before writing markup, check `src/components/ui/*.tsx`. Reach for: `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` for tabular data; `Card`/`CardContent` for panels; `Badge` + `StatusBadge` for pills/status; `TableLoader`/`TableEmpty` for states; `Tooltip` (needs a `TooltipProvider` ancestor — none at app root, so wrap locally); `Input`/`Button`/`Select` for controls. Prefer theme tokens (`text-muted-foreground`, `bg-card`, `border-border`) over hardcoded hex. Reference refactor: [[url-library-ai]] table in `src/pages/UrlLibrary.tsx`.
