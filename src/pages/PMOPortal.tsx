import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Check,
  X,
  Loader2,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  GraduationCap,
  UserCheck,
  BookOpen,
  Layers,
  FolderKanban,
  AlertTriangle,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/10 text-amber-500 border border-amber-500/20 dark:bg-amber-500/5",
  Approved: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 dark:bg-emerald-500/5",
  Rejected: "bg-rose-500/10 text-rose-500 border border-rose-500/20 dark:bg-rose-500/5",
};

// Generates beautiful gradients based on unique employee names
const getAvatarGradient = (name: string) => {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradients = [
    "from-pink-500 to-violet-600",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-indigo-500 to-purple-600",
    "from-rose-500 to-red-600",
  ];
  return gradients[hash % gradients.length];
};

interface ProjectRow {
  id: number;
  name: string;
  status: string;
  completion_pct: number | null;
  owner: string | null;
  team_size: number | null;
}

interface ProjectDetail {
  name: string;
  start_date: string | null;
  owner: string | null;
  members: string[];
  source: "allocation" | "manual";
}

interface UdemyRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  platform: string;
  course_name: string;
  justification: string;
  status: string;
  decided_by: string;
  decision_reason: string;
  created_at: string | null;
}

const TABS = [
  { key: "projects", label: "Projects" },
  { key: "bench-upskill", label: "Bench → Upskill" },
  { key: "udemy", label: "License Requests" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_SUBTITLE: Record<TabKey, string> = {
  projects: "Track active engagements — create and monitor delivery status and milestones.",
  "bench-upskill":
    "Turn idle bench time into capability — each person matched to a course teaching an in-demand skill they lack.",
  udemy: "Review, approve or decline training-program license requests (Udemy, Coursera).",
};

const TAB_ICON: Record<TabKey, typeof GraduationCap> = {
  projects: FolderKanban,
  "bench-upskill": GraduationCap,
  udemy: BookOpen,
};

export function PMOPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("projects");

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user],
  );

  if (user?.role !== "PMO" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#f5f7fa] to-[#e8eef8] dark:from-[#020d1a] dark:to-[#071428] px-6 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md p-8 rounded-3xl border border-slate-200/60 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-2xl shadow-elevated"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <XCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            This operational dashboard is restricted to the Program Management Office (PMO) team.
            Please log in with a PMO or Administrator profile to gain access.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120] relative">
      {/* Visual background lights */}
      <div className="absolute top-0 right-0 w-[450px] h-[350px] bg-gradient-to-br from-violet-500/5 to-indigo-500/5 rounded-full blur-[110px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-gradient-to-tr from-cyan-500/3 to-primary/3 rounded-full blur-[90px] pointer-events-none" />

      {/* Modern Header */}
      <div className="px-8 pt-6 pb-2 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/10">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent">
              Program Management Office
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
            {TAB_SUBTITLE[tab]}
          </p>
        </div>

        {/* Tab Selector pills with Framer Motion backdrop slider */}
        <div className="bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-zinc-800 p-1 rounded-xl flex gap-1 self-start sm:self-center relative shadow-inner">
          {TABS.map((t) => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative px-4.5 py-2 text-[12px] font-bold transition-all duration-200 rounded-lg select-none z-10 cursor-pointer",
                  isActive
                    ? "text-foreground dark:text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="pmoTabActive"
                    className="absolute inset-0 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-slate-200/50 dark:border-zinc-700/50"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-20 flex items-center gap-1.5">
                  {(() => {
                    const Icon = TAB_ICON[t.key];
                    return <Icon className="h-3.5 w-3.5" />;
                  })()}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-auto px-8 py-6 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="h-full"
          >
            {tab === "projects" ? (
              <ProjectsTab authHeaders={authHeaders} />
            ) : tab === "bench-upskill" ? (
              <BenchUpskillTab authHeaders={authHeaders} />
            ) : (
              <UdemyTab authHeaders={authHeaders} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Projects Subtab Component ────────────────────────────────────────────────
const PROJECT_STATUS_BADGE: Record<string, string> = {
  "in progress": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  "on hold": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  blocked: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
};

const EMPTY_PROJECT_FORM = { name: "", status: "In Progress", owner: "" };
const EMPTY_MEMBER_FORM = { employee_name: "", efforts_percent: "100" };

function ProjectsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_PROJECT_FORM);

  const [detailProject, setDetailProject] = useState<ProjectRow | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);
  const [addingMember, setAddingMember] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pmo/projects?page_size=100`, { headers: authHeaders });
      const data = await res.json();
      setRows(data.items ?? []);
    } catch {
      toast.error("Failed to load projects");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(rows.length / pageSize);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows.length, pageSize]);

  const createProject = async () => {
    if (!form.name.trim()) {
      toast.error("Project name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/pmo/projects`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`Project "${form.name}" created`);
      setDialogOpen(false);
      setForm(EMPTY_PROJECT_FORM);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  const fetchDetail = useCallback(async (name: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/pmo/projects/detail?name=${encodeURIComponent(name)}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed");
      setDetail(await res.json());
    } catch {
      toast.error("Failed to load project detail");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [authHeaders]);

  const openDetail = (r: ProjectRow) => {
    setDetailProject(r);
    setMemberForm(EMPTY_MEMBER_FORM);
    fetchDetail(r.name);
  };

  const addMember = async () => {
    if (!detailProject || !memberForm.employee_name.trim()) {
      toast.error("Employee name is required");
      return;
    }
    setAddingMember(true);
    try {
      const res = await fetch(`/api/employees/allocations/manual`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          employee_name: memberForm.employee_name.trim(),
          project_name: detailProject.name,
          efforts_percent: Number(memberForm.efforts_percent) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`Added ${memberForm.employee_name.trim()} to ${detailProject.name}`);
      setMemberForm(EMPTY_MEMBER_FORM);
      fetchDetail(detailProject.name);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const exportRows = rows.map((r) => ({
    Name: r.name,
    Status: r.status,
    "Completion %": r.completion_pct ?? "",
    Owner: r.owner ?? "",
    "Team Size": r.team_size ?? "",
  }));

  if (loading) {
    return (
      <div className="flex flex-col h-60 items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        <span className="text-xs text-muted-foreground/80 font-medium">Loading projects...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Table Title / Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Active Projects ({rows.length})
        </h2>
        <div className="flex items-center gap-2">
          <ExportCsvButton rows={exportRows} filename="pmo-projects.csv" />
          <button
            onClick={fetch_}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            New Project
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col h-56 items-center justify-center text-center p-8 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/40 bg-white/20 dark:bg-zinc-950/10 backdrop-blur-sm select-none">
          <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <FolderKanban className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground">No projects yet</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm">
            Create the first project to start tracking delivery status.
          </p>
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-zinc-950/20 backdrop-blur-lg border border-slate-200/60 dark:border-white/[0.04] rounded-2xl overflow-hidden shadow-elevated">
          <div className="overflow-x-auto">
            <Table paginate itemsPerPage={10} className="w-full min-w-[860px] border-collapse text-left text-xs">
              <TableHeader>
                <TableRow className="border-b border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.3] dark:bg-zinc-900/[0.2] select-none">
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Project
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Status
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Completion
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Owner
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-center">
                    Team Size
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-200/40 dark:divide-white/[0.03]">
                {paginatedRows.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => openDetail(r)}
                    className="hover:bg-slate-500/[0.03] dark:hover:bg-white/[0.02] transition-colors duration-150 align-middle cursor-pointer"
                  >
                    <TableCell className="py-4 px-6">
                      <div className="font-bold text-sm text-foreground tracking-tight flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
                        {r.name}
                      </div>
                    </TableCell>
                    <TableCell className="py-4 px-6">
                      <span
                        className={cn(
                          "inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider select-none",
                          PROJECT_STATUS_BADGE[r.status?.toLowerCase()] ??
                            "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
                        )}
                      >
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="py-4 px-6">
                      {r.completion_pct == null ? (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      ) : (
                        <div className="flex flex-col gap-1 max-w-[130px]">
                          <span className="text-xs font-bold text-foreground">
                            {Math.round(r.completion_pct)}%
                          </span>
                          <div className="w-full h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner">
                            <div
                              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(Math.round(r.completion_pct), 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-4 px-6 text-muted-foreground">
                      {r.owner || "—"}
                    </TableCell>
                    <TableCell className="py-4 px-6 text-center text-muted-foreground">
                      {r.team_size ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {rows.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.1] dark:bg-zinc-900/[0.05]">
              <div className="text-[11px] text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{Math.min(rows.length, (currentPage - 1) * pageSize + 1)}</span> to{" "}
                <span className="font-semibold text-foreground">{Math.min(rows.length, currentPage * pageSize)}</span> of{" "}
                <span className="font-semibold text-foreground">{rows.length}</span> entries
              </div>

              <div className="flex items-center gap-4.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="text-xs bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-zinc-300"
                  >
                    {[5, 10, 20].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                    const isCurrent = p === currentPage;
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={cn(
                          "h-7 w-7 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center border",
                          isCurrent
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                            : "bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Project Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                <FolderKanban className="h-4.5 w-4.5" />
              </div>
              New Project
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground/85">Project Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Client Portal Revamp"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground/85">Status</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full h-9 text-sm bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-lg px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {["In Progress", "On Hold", "Blocked", "Completed"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground/85">Owner</Label>
                <Input
                  value={form.owner}
                  onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                  placeholder="Owner name"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              className="rounded-xl font-semibold border-slate-200 dark:border-zinc-800"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!form.name.trim() || saving}
              onClick={createProject}
              className="rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-md shadow-indigo-500/10"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Detail Dialog */}
      <Dialog open={!!detailProject} onOpenChange={(open) => !open && setDetailProject(null)}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                <FolderKanban className="h-4.5 w-4.5" />
              </div>
              {detailProject?.name}
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground/70 uppercase text-[10px] font-bold tracking-wider mb-0.5">
                    Start Date
                  </div>
                  <div className="font-semibold text-foreground font-mono">
                    {detail?.start_date || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground/70 uppercase text-[10px] font-bold tracking-wider mb-0.5">
                    Owner
                  </div>
                  <div className="font-semibold text-foreground">{detail?.owner || "—"}</div>
                </div>
              </div>

              <div>
                <div className="text-muted-foreground/70 uppercase text-[10px] font-bold tracking-wider mb-1.5">
                  Members ({detail?.members.length ?? 0})
                </div>
                {!detail?.members.length ? (
                  <p className="text-xs text-muted-foreground/60">No members staffed yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {detail.members.map((m) => (
                      <span
                        key={m}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200/60 dark:border-zinc-800/60 space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground/85">Add Member</Label>
                <div className="flex gap-2">
                  <Input
                    value={memberForm.employee_name}
                    onChange={(e) =>
                      setMemberForm((f) => ({ ...f, employee_name: e.target.value }))
                    }
                    placeholder="Employee name"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={memberForm.efforts_percent}
                    onChange={(e) =>
                      setMemberForm((f) => ({ ...f, efforts_percent: e.target.value }))
                    }
                    placeholder="%"
                    className="w-16"
                  />
                  <Button
                    size="sm"
                    disabled={!memberForm.employee_name.trim() || addingMember}
                    onClick={addMember}
                    className="rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 text-white border-0 shrink-0"
                  >
                    {addingMember ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Bench → Upskill Tab Component ────────────────────────────────────────────
interface BenchSuggestion {
  employee_id: number | null;
  employee_name: string;
  employee_email: string | null;
  department: string | null;
  free_pct: number;
  reason: string;
  rolloff_date: string | null;
  current_projects: string[];
  recommended_training_id: number;
  recommended_training: string;
  teaches_skills: string[];
  demand_score: number;
  recommendation_reason: string | null;
  suggested_due_date: string;
}

interface BenchResult {
  ok: boolean;
  generated_on?: string;
  count?: number;
  rows?: BenchSuggestion[];
  summary?: { bench: number; rolling_off: number };
}

function BenchUpskillTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<BenchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const rowKey = (r: BenchSuggestion) => r.employee_email || r.employee_name;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/pmo/bench-upskill?limit=50`, { headers: authHeaders });
      setData(await res.json());
    } catch {
      toast.error("Failed to load bench-upskill suggestions");
      setData({ ok: false });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const assign = async (r: BenchSuggestion) => {
    const key = rowKey(r);
    setActing(key);
    try {
      const res = await fetch(`/api/portal/pmo/bench-upskill/assign`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          employee_id: r.employee_id,
          email: r.employee_email,
          training_id: r.recommended_training_id,
          due_date: r.suggested_due_date,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`Assigned ${r.recommended_training} to ${r.employee_name}`);
      setAssigned((prev) => new Set(prev).add(key));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to assign training");
    } finally {
      setActing(null);
    }
  };

  const rows = data?.rows ?? [];
  const s = data?.summary ?? { bench: 0, rolling_off: 0 };

  const totalPages = Math.ceil(rows.length / pageSize);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows.length, pageSize]);

  if (loading) {
    return (
      <div className="flex flex-col h-60 items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        <span className="text-xs text-muted-foreground/80 font-medium">
          Matching bench capacity to in-demand skills...
        </span>
      </div>
    );
  }

  const cards = [
    {
      label: "On Bench",
      n: s.bench ?? 0,
      desc: "Free capacity now — ready to upskill",
      icon: UserCheck,
      iconCls: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/15",
    },
    {
      label: "Rolling Off Soon",
      n: s.rolling_off ?? 0,
      desc: "Capacity arriving within 45 days",
      icon: RefreshCw,
      iconCls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/15",
    },
    {
      label: "Suggestions",
      n: rows.length,
      desc: "Manager-approved before any enrollment",
      icon: GraduationCap,
      iconCls: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {cards.map((c, idx) => {
          const CardIcon = c.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
              key={c.label}
              className="relative overflow-hidden rounded-2xl border p-5 bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] shadow-sm"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  {c.label}
                </span>
                <div className={cn("p-2 rounded-xl", c.iconCls)}>
                  <CardIcon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-3xl font-black tracking-tight text-foreground">{c.n}</span>
                <span className="text-[11px] font-medium text-muted-foreground">people</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">{c.desc}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Bench-to-Upskill Suggestions
        </h2>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            rows={rows.map((r) => ({
              Employee: r.employee_name,
              Email: r.employee_email ?? "",
              Department: r.department ?? "",
              Status: r.reason,
              "Recommended Course": r.recommended_training,
              "Skills to Gain": r.teaches_skills.join("; "),
              "Due By": r.suggested_due_date,
            }))}
            filename="bench-upskill.csv"
          />
          <button
            onClick={fetch_}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col h-56 items-center justify-center text-center p-8 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/40 bg-white/20 dark:bg-zinc-950/10 backdrop-blur-sm select-none">
          <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <UserCheck className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground">No bench suggestions right now</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm">
            Either no one is on the bench, or those who are already hold the in-demand skills.
            Suggestions appear once a synced directory and skill profiles are present.
          </p>
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-zinc-950/20 backdrop-blur-lg border border-slate-200/60 dark:border-white/[0.04] rounded-2xl overflow-hidden shadow-elevated">
          <div className="overflow-x-auto">
            <Table paginate itemsPerPage={10} className="w-full min-w-[860px] border-collapse text-left text-xs">
              <TableHeader>
                <TableRow className="border-b border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.3] dark:bg-zinc-900/[0.2] select-none">
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Employee
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Status
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Recommended Course
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Skills to Gain
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-center">
                    Due By
                  </TableHead>
                  <TableHead className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-right">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-200/40 dark:divide-white/[0.03]">
                {paginatedRows.map((r) => {
                  const initials = r.employee_name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);
                  const key = rowKey(r);
                  const isAssigned = assigned.has(key);
                  return (
                    <TableRow
                      key={key}
                      className="hover:bg-slate-500/[0.015] dark:hover:bg-white/[0.01] transition-colors duration-150 align-middle"
                    >
                      <TableCell className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex items-center justify-center h-7 w-7 rounded-full text-[10px] font-black text-white bg-gradient-to-br from-indigo-500 to-violet-600 shadow-inner">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-foreground truncate">
                              {r.employee_name}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {r.department || r.employee_email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-6">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border",
                            r.reason === "On bench"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                              : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
                          )}
                        >
                          {r.reason === "On bench" ? `${r.free_pct}% free` : `Off ${r.rolloff_date}`}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 px-6">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-semibold text-foreground leading-snug">
                            {r.recommended_training}
                          </span>
                          {r.recommendation_reason && (
                            <span className="text-[10px] text-muted-foreground/70 leading-snug max-w-[240px]">
                              {r.recommendation_reason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-6">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {r.teaches_skills.slice(0, 3).map((sk) => (
                            <span
                              key={sk}
                              className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/15"
                            >
                              {sk}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-6 text-center font-mono text-[11px] text-muted-foreground">
                        {r.suggested_due_date}
                      </TableCell>
                      <TableCell className="py-4 px-6 text-right">
                        <button
                          onClick={() => assign(r)}
                          disabled={acting === key || isAssigned}
                          className={cn(
                            "inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-3.5 text-xs font-bold transition-all duration-200 disabled:opacity-60 active:scale-95 cursor-pointer shadow-sm border",
                            isAssigned
                              ? "bg-slate-100 dark:bg-zinc-800 text-muted-foreground border-slate-200/50 dark:border-zinc-700/50 cursor-default"
                              : "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {acting === key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isAssigned ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <GraduationCap className="h-3.5 w-3.5" />
                          )}
                          {isAssigned ? "Assigned" : "Approve & Assign"}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {rows.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.1] dark:bg-zinc-900/[0.05]">
              <div className="text-[11px] text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{Math.min(rows.length, (currentPage - 1) * pageSize + 1)}</span> to{" "}
                <span className="font-semibold text-foreground">{Math.min(rows.length, currentPage * pageSize)}</span> of{" "}
                <span className="font-semibold text-foreground">{rows.length}</span> entries
              </div>
              
              <div className="flex items-center gap-4.5">
                {/* Rows per page selector */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="text-xs bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-zinc-300"
                  >
                    {[5, 10, 20].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Page buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                    const isCurrent = p === currentPage;
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={cn(
                          "h-7 w-7 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center border",
                          isCurrent
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                            : "bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 select-none">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        <span>
          Demand computed in-house from skills held by people on billable work. Deadlines scale with
          free capacity. Nothing is enrolled until a manager approves.
        </span>
        {data?.generated_on ? ` • Generated: ${data.generated_on}` : ""}
      </div>
    </div>
  );
}

// ── Udemy/Coursera Tab Component ─────────────────────────────────────────────
function UdemyTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<UdemyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/pmo/udemy${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch {
      toast.error("Failed to load learning requests");
    } finally {
      setLoading(false);
    }
  }, [filter, authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, [fetch_]);

  const totalPages = Math.ceil(items.length / pageSize);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, pageSize]);

  const approve = async (id: number, platform: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/approve`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`${platform || "Udemy"} license approved`);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to approve license");
    } finally {
      setActing(null);
    }
  };

  const reject = async (id: number, reason: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/reject`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Request declined successfully");
      setRejectDialogOpen(false);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to reject request");
    } finally {
      setActing(null);
    }
  };

  // Modern segmented category selector
  const filterCards = [
    {
      key: "Pending",
      label: "Pending Queue",
      desc: "Requires active PMO review",
      icon: Clock,
      activeBg:
        "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-500/5 dark:bg-amber-950/20 dark:border-amber-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-amber-500/20 hover:text-amber-500",
      glowColor: "from-amber-500/10 to-transparent",
    },
    {
      key: "Approved",
      label: "Approved Licenses",
      desc: "Licenses ready for upskilling",
      icon: CheckCircle2,
      activeBg:
        "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/5 dark:bg-emerald-950/20 dark:border-emerald-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-emerald-500/20 hover:text-emerald-500",
      glowColor: "from-emerald-500/10 to-transparent",
    },
    {
      key: "Rejected",
      label: "Declined Requests",
      desc: "Requests declined with reasons",
      icon: XCircle,
      activeBg:
        "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 shadow-sm shadow-rose-500/5 dark:bg-rose-950/20 dark:border-rose-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-rose-500/20 hover:text-rose-500",
      glowColor: "from-rose-500/10 to-transparent",
    },
    {
      key: "All",
      label: "All Requests",
      desc: "Complete history overview",
      icon: Layers,
      activeBg:
        "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shadow-sm shadow-indigo-500/5 dark:bg-indigo-950/20 dark:border-indigo-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-indigo-500/20 hover:text-indigo-500",
      glowColor: "from-indigo-500/10 to-transparent",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Category selector grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {filterCards.map((c, idx) => {
          const CardIcon = c.icon;
          const isActive = filter === c.key;
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 shadow-sm cursor-pointer select-none",
                isActive ? c.activeBg : c.inactiveBg,
              )}
            >
              {/* Radial glow background on hover/active */}
              <div
                className={cn(
                  "absolute -right-10 -top-10 w-28 h-28 bg-gradient-radial blur-2xl opacity-20 pointer-events-none",
                  c.glowColor,
                )}
              />

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <span className="text-[11px] font-bold uppercase tracking-wider">{c.label}</span>
                <div
                  className={cn(
                    "p-1.5 rounded-lg border",
                    isActive ? "border-current/25" : "border-slate-200/60 dark:border-zinc-800",
                  )}
                >
                  <CardIcon className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-2xl font-black tracking-tight">
                  {isActive ? items.length : "—"}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase">
                  Filter
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">{c.desc}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Sync bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Active Requests ({items.length})
        </h2>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            rows={items.map((r) => ({
              Employee: r.employee_name,
              Email: r.employee_email,
              Platform: r.platform,
              Course: r.course_name,
              Status: r.status,
              "Decided By": r.decided_by ?? "",
              "Decision Reason": r.decision_reason ?? "",
            }))}
            filename="license-requests.csv"
          />
          <button
            onClick={fetch_}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Sync Inbox
          </button>
        </div>
      </div>

      {/* Requests Card Grid */}
      {loading ? (
        <div className="flex flex-col h-40 items-center justify-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
          <span className="text-xs text-muted-foreground/80 font-medium">
            Fetching request registry...
          </span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col h-56 items-center justify-center text-center p-8 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/40 bg-white/20 dark:bg-zinc-950/10 backdrop-blur-sm select-none">
          <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <CheckCircle2 className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground">No license requests found</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
            There are no {filter.toLowerCase()} learning license requests matching this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedItems.map((r, cardIdx) => {
              const initials = r.employee_name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              return (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: cardIdx * 0.03, duration: 0.3 }}
                  key={r.id}
                  className="relative overflow-hidden rounded-2xl border bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] p-5 flex flex-col justify-between hover:shadow-md hover:border-slate-300 dark:hover:border-white/[0.08] transition-all duration-300 backdrop-blur-sm group"
                >
                  {/* Visual platform accent tag */}
                  <div
                    className={cn(
                      "absolute top-0 right-0 w-2 h-16 rounded-bl-lg pointer-events-none",
                      r.platform?.toLowerCase() === "coursera" ? "bg-blue-500" : "bg-violet-500",
                    )}
                  />

                  <div>
                    {/* User profile row */}
                    <div className="flex items-center gap-3">
                      <div
                        className="inline-flex items-center justify-center h-8 w-8 rounded-full text-xs font-black text-white bg-gradient-to-br shadow-inner"
                        style={{
                          background:
                            getAvatarGradient(r.employee_name) === "from-pink-500 to-violet-600"
                              ? "linear-gradient(135deg, #ec4899, #8b5cf6)"
                              : getAvatarGradient(r.employee_name) === "from-blue-500 to-cyan-500"
                                ? "linear-gradient(135deg, #3b82f6, #06b6d4)"
                                : getAvatarGradient(r.employee_name) ===
                                    "from-emerald-500 to-teal-600"
                                  ? "linear-gradient(135deg, #10b981, #059669)"
                                  : getAvatarGradient(r.employee_name) ===
                                      "from-amber-500 to-orange-600"
                                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                                    : getAvatarGradient(r.employee_name) ===
                                        "from-indigo-500 to-purple-600"
                                      ? "linear-gradient(135deg, #6366f1, #a855f7)"
                                      : "linear-gradient(135deg, #ec4899, #f43f5e)",
                        }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-foreground truncate">
                          {r.employee_name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {r.employee_email}
                        </div>
                      </div>
                    </div>

                    {/* Course specs */}
                    <div className="mt-4">
                      <div className="flex items-center gap-1.5 select-none">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border",
                            r.platform?.toLowerCase() === "coursera"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                              : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
                          )}
                        >
                          {r.platform || "Udemy"}
                        </span>
                        <span className="text-[9px] text-muted-foreground/70 font-semibold font-mono">
                          {r.created_at
                            ? new Date(r.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </span>
                      </div>

                      <h3
                        className="text-sm font-bold text-foreground mt-2.5 line-clamp-2 min-h-[38px] leading-snug group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors"
                        title={r.course_name}
                      >
                        {r.course_name || "Untitled Learning Course"}
                      </h3>
                    </div>

                    {/* Justification block */}
                    <div className="mt-3.5 bg-slate-50/50 dark:bg-zinc-950/20 border border-slate-100 dark:border-zinc-800/40 rounded-xl p-3.5 relative">
                      <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1 select-none">
                        Rationale Justification
                      </div>
                      <p className="text-xs text-muted-foreground dark:text-zinc-400 italic line-clamp-3 leading-relaxed">
                        "{r.justification || "No justification provided."}"
                      </p>
                    </div>
                  </div>

                  {/* Footer and Actions */}
                  <div>
                    {r.status === "Pending" ? (
                      <div className="mt-5 pt-4 border-t border-slate-200/50 dark:border-zinc-800/60 flex items-center gap-3">
                        <button
                          onClick={() => approve(r.id, r.platform)}
                          disabled={acting === r.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-all duration-200 disabled:opacity-50 active:scale-95 cursor-pointer shadow-sm shadow-emerald-500/5"
                        >
                          {acting === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setRejectId(r.id);
                            setRejectReason("");
                            setRejectDialogOpen(true);
                          }}
                          disabled={acting === r.id}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-rose-600 dark:text-rose-400 transition-all duration-200 disabled:opacity-50 active:scale-95 cursor-pointer shadow-sm shadow-rose-500/5"
                        >
                          <X className="h-3.5 w-3.5" />
                          Decline
                        </button>
                      </div>
                    ) : (
                      <div className="mt-5 pt-4 border-t border-slate-200/50 dark:border-zinc-800/60 text-xs">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-muted-foreground/60 text-[9px] font-bold uppercase tracking-wider mb-1.5 select-none">
                          <span>Decision Registry</span>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-md text-[8px] font-extrabold uppercase border",
                              STATUS_BADGE[r.status],
                            )}
                          >
                            {r.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-foreground/80 font-semibold mb-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          <span>
                            Reviewed by{" "}
                            <span className="font-bold text-foreground">
                              {r.decided_by || "System Admin"}
                            </span>
                          </span>
                        </div>

                        {r.decision_reason && (
                          <p className="mt-1 text-[11px] text-muted-foreground bg-slate-50 dark:bg-zinc-950/20 p-2 rounded-lg border border-slate-100 dark:border-zinc-800/30 leading-snug">
                            Reason: {r.decision_reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {items.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl bg-white/60 dark:bg-zinc-900/[0.05] backdrop-blur-sm">
              <div className="text-[11px] text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{Math.min(items.length, (currentPage - 1) * pageSize + 1)}</span> to{" "}
                <span className="font-semibold text-foreground">{Math.min(items.length, currentPage * pageSize)}</span> of{" "}
                <span className="font-semibold text-foreground">{items.length}</span> entries
              </div>
              
              <div className="flex items-center gap-4.5">
                {/* Rows per page selector */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">Cards per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="text-xs bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-zinc-300"
                  >
                    {[3, 6, 9, 12].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Page buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                    const isCurrent = p === currentPage;
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={cn(
                          "h-7 w-7 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center border",
                          isCurrent
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                            : "bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-zinc-800 text-muted-foreground hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-all cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decline modal redesign */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              Decline License Request
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-xs font-semibold text-muted-foreground/85 block">
              Reason for Declining (Sent to Employee) *
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Please state why this training license request is declined..."
                className="mt-1.5 w-full rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 px-4 py-3 text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-zinc-900 transition-all leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
              className="rounded-xl font-semibold border-slate-200 dark:border-zinc-800"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!rejectReason.trim() || acting === rejectId}
              onClick={() => {
                if (rejectId) {
                  reject(rejectId, rejectReason.trim());
                }
              }}
              className="rounded-xl font-semibold bg-rose-500 hover:bg-rose-600 text-white border-0 shadow-md shadow-rose-500/10"
            >
              {acting === rejectId && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Decline Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
