---
name: react19-frontend-constraints
description: Frontend is React 19 — avoid libs using ReactDOM.findDOMNode (e.g. react-grid-layout)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 20adc1ee-c367-45c8-8180-9c58de383bf0
---

The frontend runs **React 19** (`react: ^19.2.5` in package.json), with TanStack Router,
recharts ^3.8.1, Radix/shadcn UI, and lucide-react icons. API calls are plain `fetch` with
`x-user-email` / `x-user-role: user.role.toLowerCase()` headers (no axios wrapper).

**Why:** React 19 removed `ReactDOM.findDOMNode`. Libraries that still call it crash at
runtime — notably `react-grid-layout`. Picked this up while building [[analytics-roi-feature]]:
planned to use react-grid-layout for a drag-and-drop board, switched to a native HTML5
drag-reorder + width-toggle grid instead (layout persisted per widget).

**How to apply:** before adding a frontend dep, check it supports React 19 / doesn't use
findDOMNode. Prefer `@dnd-kit` or native pointer/drag events for drag-and-drop. Typecheck
with `npx tsc --noEmit -p tsconfig.json`.
