import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Network,
  RefreshCw,
  Search,
  Users,
  ChevronRight,
  ChevronDown,
  Building2,
  Briefcase,
  MapPin,
  X,
  AlertCircle,
  List,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

interface OrgNode {
  email: string;
  name: string;
  job_title: string;
  department: string;
  office_location: string;
  manager_email: string;
  manager_name: string;
}

interface HierarchyResponse {
  count: number;
  root_emails: string[];
  nodes: OrgNode[];
  synced_at: string | null;
}

interface TreeNode extends OrgNode {
  children: TreeNode[];
  reportCount: number; // total reports in the subtree
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");

// Deterministic accent per department so teams read as colour-coded clusters.
const DEPT_COLORS = [
  "#3B82F6", "#16A34A", "#8B5CF6", "#F59E0B", "#EC4899",
  "#14B8A6", "#6366F1", "#EF4444", "#0EA5E9", "#A855F7",
];
function deptColor(dept: string): string {
  if (!dept) return "#64748B";
  let h = 0;
  for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) >>> 0;
  return DEPT_COLORS[h % DEPT_COLORS.length];
}

// Profile photo with initials fallback. The <img> hits the public photo proxy
// (`/api/ms365/users/{email}/photo`); browsers lazy-load only on-screen avatars
// and cache them, and we fall back to a coloured initials tile on 404/error.
function Avatar({
  email,
  name,
  color,
  className,
  textClassName = "text-[11px]",
}: {
  email: string;
  name: string;
  color: string;
  className?: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!email && !failed;
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden", className)}
      style={{ background: color }}
    >
      {showPhoto ? (
        <img
          src={`/api/ms365/users/${encodeURIComponent(email)}/photo`}
          alt={name}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-bold text-white",
            textClassName,
          )}
        >
          {initials(name) || "?"}
        </span>
      )}
    </div>
  );
}

function buildForest(nodes: OrgNode[], rootEmails: string[]): TreeNode[] {
  const byEmail = new Map<string, TreeNode>();
  for (const n of nodes) byEmail.set(n.email, { ...n, children: [], reportCount: 0 });

  const rootSet = new Set(rootEmails);
  const roots: TreeNode[] = [];
  for (const node of byEmail.values()) {
    const mgr = node.manager_email ? byEmail.get(node.manager_email) : undefined;
    if (rootSet.has(node.email) || !mgr || mgr.email === node.email) roots.push(node);
    else mgr.children.push(node);
  }

  const computeCounts = (node: TreeNode, seen: Set<string>): number => {
    if (seen.has(node.email)) return 0;
    seen.add(node.email);
    node.children.sort(
      (a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name),
    );
    let total = node.children.length;
    for (const c of node.children) total += computeCounts(c, seen);
    node.reportCount = total;
    return total;
  };
  for (const r of roots) computeCounts(r, new Set());
  roots.sort((a, b) => b.reportCount - a.reportCount || a.name.localeCompare(b.name));
  return roots;
}

// ── Layout constants ─────────────────────────────────────────────────────────
const FULL_W = 224; // full name/title card width
const FULL_H = 56;  // full card height
const TILE = 46;    // compact photo-tile edge (non-focused columns)

interface Placed {
  node: TreeNode;
  depth: number;
  row: number; // fractional leaf-row index (vertical position)
}

function layoutForest(roots: TreeNode[], expanded: Set<string>) {
  const placed: Placed[] = [];
  let row = 0;
  let maxDepth = 0;
  const visit = (node: TreeNode, depth: number): Placed => {
    maxDepth = Math.max(maxDepth, depth);
    const showKids = expanded.has(node.email) && node.children.length > 0;
    let r: number;
    if (showKids) {
      const kids = node.children.map((k) => visit(k, depth + 1));
      r = (kids[0].row + kids[kids.length - 1].row) / 2; // centre on children
    } else {
      r = row++;
    }
    const p: Placed = { node, depth, row: r };
    placed.push(p);
    return p;
  };
  roots.forEach((rt) => visit(rt, 0));
  return { placed, rows: Math.max(row, 1), maxDepth };
}

// ── Graph canvas (column browser: each depth = one independently-scrollable strip) ──
// Left-to-right landscape layout. Every depth level is its own scrollable column
// so a column with 100+ reports scrolls vertically without moving adjacent columns.
// Focused person's column + their reports render as full name/title cards;
// all other columns render as compact photo tiles.
interface GraphProps {
  forest: TreeNode[];
  expanded: Set<string>;
  toggle: (email: string) => void;
  highlight: Set<string> | null;
  onSelect: (n: TreeNode) => void;
  selectedEmail: string | null;
  focusEmail: string | null;
}

function GraphCanvas({
  forest,
  expanded,
  toggle,
  highlight,
  onSelect,
  selectedEmail,
  focusEmail,
}: GraphProps) {
  const { placed, maxDepth } = useMemo(
    () => layoutForest(forest, expanded),
    [forest, expanded],
  );

  const pmap = useMemo(() => {
    const m = new Map<string, Placed>();
    placed.forEach((p) => m.set(p.node.email, p));
    return m;
  }, [placed]);

  const focusDepth = useMemo(
    () => (selectedEmail ? pmap.get(selectedEmail)?.depth ?? 0 : 0),
    [selectedEmail, pmap],
  );
  const isFull = useCallback(
    (d: number) => d === focusDepth || d === focusDepth + 1,
    [focusDepth],
  );

  // Group placed nodes by depth, preserving DFS order (gives correct top-to-bottom
  // stacking within each column: a manager's subtree stays together).
  const columns = useMemo(() => {
    const cols: Placed[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const p of placed) cols[p.depth]?.push(p);
    return cols;
  }, [placed, maxDepth]);

  // Per-column scroll refs so we can scroll the focused node into view.
  const colRefMap = useRef(new Map<number, HTMLDivElement>());
  const didScroll = useRef<string | null>(null);

  useEffect(() => {
    const target = selectedEmail ?? focusEmail;
    if (!target || didScroll.current === target) return;
    const p = pmap.get(target);
    if (!p) return;
    const col = colRefMap.current.get(p.depth);
    if (!col) return;
    const colNodes = columns[p.depth];
    const idx = colNodes.findIndex((c) => c.node.email === target);
    if (idx < 0) return;
    const itemH = isFull(p.depth) ? FULL_H + 8 : TILE + 6;
    col.scrollTo({
      top: Math.max(0, idx * itemH + itemH / 2 - col.clientHeight / 2),
      behavior: "smooth",
    });
    didScroll.current = target;
  }, [selectedEmail, focusEmail, pmap, columns, isFull]);

  return (
    <div
      className="flex h-full overflow-x-auto"
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklab, var(--border) 50%, transparent) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {columns.map((colNodes, depth) => {
        const full = isFull(depth);
        const colW = full ? FULL_W + 24 : TILE + 20;

        return (
          <div
            key={depth}
            ref={(el) => {
              if (el) colRefMap.current.set(depth, el);
              else colRefMap.current.delete(depth);
            }}
            className="flex-none overflow-y-auto border-r border-[var(--border)] px-2 py-4"
            style={{ width: colW, minWidth: colW }}
          >
            <div className="flex flex-col" style={{ gap: full ? 8 : 6 }}>
              {colNodes.map((p) => {
                const n = p.node;
                const accent = deptColor(n.department);
                const dimmed = highlight && !highlight.has(n.email);
                const hasKids = n.children.length > 0;
                const open = expanded.has(n.email);
                const sel = selectedEmail === n.email;

                const countBadge = hasKids && (
                  <button
                    onClick={() => toggle(n.email)}
                    className={cn(
                      "absolute -right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-full border border-[var(--border)] bg-card font-bold text-muted-foreground shadow-sm hover:text-foreground",
                      full ? "h-6 px-2 text-[10px] gap-1" : "h-5 px-1.5 text-[9px]",
                    )}
                    title={open ? "Collapse" : "Expand"}
                  >
                    {n.children.length}
                    {open ? (
                      <ChevronDown className={full ? "h-3 w-3" : "h-2.5 w-2.5"} />
                    ) : (
                      <ChevronRight className={full ? "h-3 w-3" : "h-2.5 w-2.5"} />
                    )}
                  </button>
                );

                if (!full) {
                  return (
                    <div
                      key={n.email}
                      data-node
                      title={`${n.name}${n.job_title ? " · " + n.job_title : ""}`}
                      className={cn(
                        "relative shrink-0 rounded-lg border bg-card shadow-sm transition-opacity",
                        sel
                          ? "border-primary/70 ring-2 ring-primary/30"
                          : "border-[var(--border)]",
                        dimmed && "opacity-30",
                      )}
                      style={{ width: TILE, height: TILE }}
                    >
                      <button onClick={() => onSelect(n)} className="block h-full w-full">
                        <Avatar
                          email={n.email}
                          name={n.name}
                          color={accent}
                          className="h-full w-full rounded-lg"
                          textClassName="text-[10px]"
                        />
                      </button>
                      {countBadge}
                    </div>
                  );
                }

                return (
                  <div
                    key={n.email}
                    data-node
                    className={cn(
                      "relative shrink-0 rounded-xl border bg-card shadow-sm transition-opacity",
                      sel ? "border-primary/60 ring-2 ring-primary/20" : "border-[var(--border)]",
                      dimmed && "opacity-30",
                    )}
                    style={{ height: FULL_H }}
                  >
                    <span
                      className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
                      style={{ background: accent }}
                    />
                    <button
                      onClick={() => onSelect(n)}
                      className="flex h-full w-full items-center gap-2.5 px-3 text-left"
                    >
                      <Avatar
                        email={n.email}
                        name={n.name}
                        color={accent}
                        className="h-10 w-10 rounded-lg"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
                          {n.name}
                        </p>
                        <p className="truncate text-[10.5px] leading-tight text-muted-foreground">
                          {n.job_title || "—"}
                        </p>
                        {n.department && (
                          <p
                            className="truncate text-[9.5px] font-medium leading-tight"
                            style={{ color: accent }}
                          >
                            {n.department}
                          </p>
                        )}
                      </div>
                    </button>
                    {countBadge}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Indented list view (alternate) ───────────────────────────────────────────
interface NodeCardProps {
  node: TreeNode;
  expanded: Set<string>;
  toggle: (email: string) => void;
  highlight: Set<string> | null;
  onSelect: (node: TreeNode) => void;
  selectedEmail: string | null;
}
function NodeCard({ node, expanded, toggle, highlight, onSelect, selectedEmail }: NodeCardProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.email);
  const dimmed = highlight && !highlight.has(node.email);
  const accent = deptColor(node.department);
  const isSelected = selectedEmail === node.email;
  return (
    <div className="flex flex-col">
      <div
        data-email={node.email}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-all scroll-mt-6",
          isSelected
            ? "border-primary/50 ring-2 ring-primary/15"
            : "border-[var(--border)] hover:border-[var(--border-strong)]",
          dimmed && "opacity-35",
        )}
      >
        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full" style={{ background: accent }} />
        <button
          onClick={() => hasChildren && toggle(node.email)}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
            hasChildren
              ? "text-muted-foreground hover:bg-muted hover:text-foreground"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
        </button>
        <button onClick={() => onSelect(node)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar
            email={node.email}
            name={node.name}
            color={accent}
            className="h-9 w-9 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">{node.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {node.job_title || "—"}
              {node.department ? ` · ${node.department}` : ""}
            </p>
          </div>
        </button>
        {hasChildren && (
          <button
            onClick={() => toggle(node.email)}
            className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
            title={`${node.reportCount} total in this branch`}
          >
            <Users className="h-3 w-3" />
            {node.children.length}
            {node.reportCount > node.children.length && (
              <span className="opacity-60">/{node.reportCount}</span>
            )}
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <div className="relative ml-5 mt-2 space-y-2 border-l border-dashed border-[var(--border)] pl-5">
          {node.children.map((child) => (
            <NodeCard
              key={child.email}
              node={child}
              expanded={expanded}
              toggle={toggle}
              highlight={highlight}
              onSelect={onSelect}
              selectedEmail={selectedEmail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function OrgHierarchy() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );
  const headersRef = useRef(authHeaders);
  headersRef.current = authHeaders;

  const [data, setData] = useState<HierarchyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [scope, setScope] = useState<"user" | "all">("user");
  const listScrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ms365/org-hierarchy", { headers: headersRef.current });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json: HierarchyResponse = await res.json();
      setData(json);
      // Initial expansion (focus on the logged-in user's chain) is set by an
      // effect once the forest + node index are built — see below.
    } catch (e: any) {
      setError(e?.message || "Failed to load org hierarchy");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = async () => {
    setSyncing(true);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      // limit=0 → whole company domain. The sync runs in the background (managers
      // take a minute to resolve under Graph throttling); we poll for completion.
      const res = await fetch("/api/ms365/users/sync?limit=0", {
        method: "POST",
        headers: headersRef.current,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || `Sync failed (${res.status})`);
      }
      const started = await res.json();
      const prevSynced: string | null = started?.last_synced_at ?? null;
      toast.info("Syncing the full org from Microsoft 365 — this can take a minute…");

      const deadline = Date.now() + 4 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(3000);
        const s = await fetch("/api/ms365/users/sync-status", {
          headers: headersRef.current,
        }).then((r) => r.json());
        const done = !s.running && (s.last_synced_at !== prevSynced || s.error);
        if (done) {
          if (s.error) throw new Error(s.error);
          toast.success(
            `Synced ${s.db_count} users (${s.db_with_manager} with managers)`,
          );
          await load();
          return;
        }
      }
      toast.message("Sync still running in the background — refreshing what's ready.");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Sync from Microsoft 365 failed");
    } finally {
      setSyncing(false);
    }
  };

  const forest = useMemo(
    () => (data ? buildForest(data.nodes, data.root_emails) : []),
    [data],
  );

  const { highlight } = useMemo(() => {
    if (!query.trim()) return { highlight: null as Set<string> | null };
    const q = query.toLowerCase();
    const parentOf = new Map<string, string>();
    const byEmail = new Map<string, TreeNode>();
    const index = (n: TreeNode, parent?: string) => {
      byEmail.set(n.email, n);
      if (parent) parentOf.set(n.email, parent);
      n.children.forEach((c) => index(c, n.email));
    };
    forest.forEach((r) => index(r));
    const hl = new Set<string>();
    for (const n of byEmail.values()) {
      if (
        n.name.toLowerCase().includes(q) ||
        n.email.toLowerCase().includes(q) ||
        n.job_title.toLowerCase().includes(q) ||
        n.department.toLowerCase().includes(q)
      ) {
        let cur: string | undefined = n.email;
        while (cur) {
          hl.add(cur);
          cur = parentOf.get(cur);
        }
      }
    }
    return { highlight: hl };
  }, [query, forest]);

  // Reveal the path to every match.
  useEffect(() => {
    if (highlight) setExpanded((prev) => new Set([...prev, ...highlight]));
  }, [highlight]);

  // Index for O(1) parent/children lookups (accordion + user-focus need these).
  const index = useMemo(() => {
    const byEmail = new Map<string, TreeNode>();
    const parentOf = new Map<string, string>();
    const walk = (n: TreeNode, parent?: string) => {
      byEmail.set(n.email, n);
      if (parent) parentOf.set(n.email, parent);
      n.children.forEach((c) => walk(c, n.email));
    };
    forest.forEach((r) => walk(r));
    return { byEmail, parentOf };
  }, [forest]);

  // The single top leader above the logged-in user (walk the manager chain up).
  const rootForUser = useMemo(() => {
    const me = user?.email?.toLowerCase();
    if (!me || !index.byEmail.has(me)) return null;
    let cur = me;
    let p = index.parentOf.get(cur);
    while (p) {
      cur = p;
      p = index.parentOf.get(cur);
    }
    return cur; // topmost ancestor email
  }, [user?.email, index]);

  // What the chart renders. "My org" = the single tree the user belongs to (one
  // apex → managers → reports), so it reads as a proper org chart even with
  // partial data. "Full org" = every root. If the user isn't in the directory,
  // fall back to the largest tree so it still has a single apex.
  const displayForest = useMemo(() => {
    if (scope === "all" || forest.length <= 1) return forest;
    if (rootForUser) {
      const r = forest.find((f) => f.email === rootForUser);
      if (r) return [r];
    }
    return [[...forest].sort((a, b) => b.reportCount - a.reportCount)[0]];
  }, [scope, forest, rootForUser]);

  // Initial view: open ONLY the logged-in user's own manager chain (root → … →
  // their manager → them), select them, and leave every other branch collapsed.
  // Falls back to the largest org's top level if the user isn't in the directory.
  const initedFor = useRef<HierarchyResponse | null>(null);
  useEffect(() => {
    if (!data || !forest.length || initedFor.current === data) return;
    initedFor.current = data;
    const me = user?.email?.toLowerCase();
    const exp = new Set<string>();
    if (me && index.byEmail.has(me)) {
      let cur: string | undefined = me; // expand self + every ancestor
      while (cur) {
        exp.add(cur);
        cur = index.parentOf.get(cur);
      }
      setSelected(index.byEmail.get(me)!);
    } else {
      const root = displayForest[0];
      if (root) {
        exp.add(root.email);
        root.children.forEach((c) => exp.add(c.email));
      }
    }
    setExpanded(exp);
  }, [data, forest, displayForest, index, user?.email]);

  // Accordion toggle: opening a node collapses its siblings' whole subtrees, so
  // only one branch is open per level and the tree stays narrow/readable.
  const toggle = (email: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const collapseSubtree = (node: TreeNode) => {
        next.delete(node.email);
        node.children.forEach(collapseSubtree);
      };
      if (next.has(email)) {
        const node = index.byEmail.get(email);
        node ? collapseSubtree(node) : next.delete(email);
      } else {
        const parentEmail = index.parentOf.get(email);
        const siblings = parentEmail
          ? index.byEmail.get(parentEmail)?.children ?? []
          : displayForest;
        for (const sib of siblings) if (sib.email !== email) collapseSubtree(sib);
        next.add(email);
      }
      return next;
    });

  // Keep the focused person scrolled into view in the tree.
  useEffect(() => {
    if (view !== "list" || !selected) return;
    const el = listScrollRef.current?.querySelector(
      `[data-email="${selected.email}"]`,
    );
    el?.scrollIntoView({ block: "center" });
  }, [selected, view, expanded]);

  const expandAll = () => {
    const all = new Set<string>();
    const walk = (n: TreeNode) => {
      all.add(n.email);
      n.children.forEach(walk);
    };
    displayForest.forEach(walk);
    setExpanded(all);
  };
  const collapseAll = () => setExpanded(new Set(displayForest.map((r) => r.email)));

  const totalPeople = data?.count ?? 0;
  const managerCount = useMemo(() => {
    if (!data) return 0;
    return new Set(data.nodes.map((n) => n.manager_email).filter(Boolean)).size;
  }, [data]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-background/80 px-6 py-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Network className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
                Org Hierarchy
              </h1>
              <p className="text-[12px] text-muted-foreground">
                Reporting graph from the Microsoft 365 directory
                {data?.synced_at && <> · synced {new Date(data.synced_at).toLocaleString()}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-card p-0.5">
              <button
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
                  view === "list" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-3.5 w-3.5" /> Tree
              </button>
              <button
                onClick={() => setView("graph")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
                  view === "graph" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <GitBranch className="h-3.5 w-3.5" /> Chart
              </button>
            </div>
            {/* Scope: my org (single apex) vs the whole directory */}
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-card p-0.5">
              <button
                onClick={() => setScope("user")}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
                  scope === "user" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
                )}
                title="Show the org I belong to (single leader at the top)"
              >
                My org
              </button>
              <button
                onClick={() => setScope("all")}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
                  scope === "all" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
                )}
                title="Show every reporting tree in the directory"
              >
                Full org
              </button>
            </div>
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-60"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync from Microsoft 365"}
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-[220px] flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, role, department…"
              className="w-full rounded-xl border border-[var(--border)] bg-card py-2 pl-9 pr-8 text-[13px] outline-none focus:border-primary/50"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={expandAll}
            className="rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Collapse all
          </button>
          <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[12px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {totalPeople} people
            </span>
            <span className="h-3 w-px bg-[var(--border)]" />
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5" /> {managerCount} managers
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading hierarchy…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive/60" />
              <p className="text-[13px] font-medium text-foreground">{error}</p>
              <button
                onClick={load}
                className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-[12px] font-medium hover:bg-muted"
              >
                Retry
              </button>
            </div>
          ) : forest.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Network className="mb-3 h-10 w-10 text-muted-foreground/25" />
              <p className="text-[13px] font-medium text-muted-foreground">No directory data yet</p>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Click “Sync from Microsoft 365” to pull the org from Azure AD.
              </p>
            </div>
          ) : view === "graph" ? (
            <GraphCanvas
              forest={displayForest}
              expanded={expanded}
              toggle={toggle}
              highlight={highlight}
              onSelect={setSelected}
              selectedEmail={selected?.email ?? null}
              focusEmail={user?.email?.toLowerCase() ?? null}
            />
          ) : (
            <div ref={listScrollRef} className="h-full overflow-y-auto px-6 py-5">
              <div className="space-y-3">
                {displayForest.map((root) => (
                  <NodeCard
                    key={root.email}
                    node={root}
                    expanded={expanded}
                    toggle={toggle}
                    highlight={highlight}
                    onSelect={setSelected}
                    selectedEmail={selected?.email ?? null}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="hidden w-80 shrink-0 flex-col border-l border-[var(--border)] bg-card/40 p-5 md:flex">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar
                  email={selected.email}
                  name={selected.name}
                  color={deptColor(selected.department)}
                  className="h-12 w-12 rounded-xl"
                  textClassName="text-[14px]"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-foreground">{selected.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {selected.job_title || "—"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-[12px]">
              <DetailRow icon={Briefcase} label="Email" value={selected.email} />
              <DetailRow icon={Building2} label="Department" value={selected.department} />
              <DetailRow icon={MapPin} label="Office" value={selected.office_location} />
              <DetailRow
                icon={ChevronRight}
                label="Reports to"
                value={selected.manager_name || selected.manager_email}
              />
              <DetailRow
                icon={Users}
                label="Direct reports"
                value={
                  selected.children.length > 0
                    ? `${selected.children.length} (${selected.reportCount} total)`
                    : "None"
                }
              />
            </div>

            {selected.children.length > 0 && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  Direct reports
                </p>
                <div className="space-y-1.5 overflow-y-auto">
                  {selected.children.map((c) => (
                    <button
                      key={c.email}
                      onClick={() => setSelected(c)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
                    >
                      <Avatar
                        email={c.email}
                        name={c.name}
                        color={deptColor(c.department)}
                        className="h-6 w-6 rounded-md"
                        textClassName="text-[9px]"
                      />
                      <span className="truncate text-[12px] text-foreground">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Briefcase;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {label}
        </p>
        <p className="break-words text-[12px] text-foreground">{value || "—"}</p>
      </div>
    </div>
  );
}
