import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText,
  Search,
  Loader2,
  Download,
  Sparkles,
  ShieldCheck,
  UserRound,
  Award,
  Home,
  LogOut,
  GraduationCap,
  ThumbsUp,
  Plane,
  Presentation,
  CheckCircle2,
  Clock,
  ScrollText,
  Settings2,
  RefreshCw,
  Save,
  Library,
  Upload,
  Trash2,
  FileSpreadsheet,
  FilePieChart,
  FileImage,
  FileArchive,
  Tag,
  X,
  ExternalLink,
  Mail,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { flyBanner } from "@/lib/fly-banner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/_layout/documents")({
  component: DocumentsPage,
});

const HR_ROLES = new Set(["HR", "Admin"]);
const LIBRARY_ADMIN_ROLES = new Set(["HR", "Admin", "Super Admin"]);

type FieldType = "text" | "textarea" | "date" | "select";

interface DocField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  source: "user" | "auto";
  options?: string[];
}

interface DocTemplate {
  id: number;
  doc_type: string;
  label: string;
  filename: string;
  source_format: string | null;
  source_key: string;
  enabled: boolean;
  requires_approval: boolean;
  setup_status: string; // needs_review | ready
  fields: DocField[];
  updated_at: string | null;
}


function DocumentsPage() {
  const { user } = useAuth();
  const isHr = !!user && HR_ROLES.has(user.role);
  // Which roles may approve & release is configurable in Document settings (HR always; Admin opt-in).
  // approverRoles holds the lowercase role names returned by the backend.
  const [approverRoles, setApproverRoles] = useState<string[]>([]);
  const canRelease = !!user && approverRoles.includes(user.role.toLowerCase());

  const authHeaders = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [mode, setMode] = useState<"manage" | "library" | "hr-letters">("hr-letters");
  const isLibraryAdmin = !!user && LIBRARY_ADMIN_ROLES.has(user.role);

  // Approver-role config (only HR/Admin can read this endpoint).
  const fetchCatalogue = useCallback(() => {}, []);

  const fetchApprovers = useCallback(() => {
    if (!isHr) return;
    fetch("/api/documents/settings", { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setApproverRoles(d.approver_roles || []))
      .catch(() => {});
  }, [isHr, authHeaders]);

  useEffect(() => {
    fetchApprovers();
  }, [fetchApprovers]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header band */}
      <div className="shrink-0 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-4 py-4 sm:px-8 sm:py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm"
              style={{ background: "color-mix(in oklab, var(--connectivity) 14%, transparent)" }}
            >
              <FileText className="h-5 w-5" style={{ color: "var(--connectivity)" }} />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">
                Request letters and certificates, or browse the shared document library.
              </p>
            </div>
          </div>

          <div className="flex rounded-xl border border-[var(--border)] bg-card p-1 overflow-x-auto no-scrollbar max-w-full shrink-0">
            <PillTab active={mode === "hr-letters"} onClick={() => setMode("hr-letters")}>
              <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Letters &amp; Certificates
            </PillTab>
            <PillTab active={mode === "library"} onClick={() => setMode("library")}>
              <Library className="mr-1.5 h-3.5 w-3.5" /> Document Library
            </PillTab>
            {isHr && (
              <PillTab active={mode === "manage"} onClick={() => setMode("manage")}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage templates
              </PillTab>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isHr && mode === "manage" ? (
          <ManageTemplates
            authHeaders={authHeaders}
            onChanged={fetchCatalogue}
            onApproversChanged={fetchApprovers}
          />
        ) : mode === "library" ? (
          <DocumentLibrary authHeaders={authHeaders} isLibraryAdmin={isLibraryAdmin} />
        ) : (
          <ZohoHRLetters />
        )}
      </div>
    </div>
  );
}

// ── Zoho HR Letters ───────────────────────────────────────────────────────────

const ZOHO_ORG = "alignedautomationservices";
const ZOHO_BASE = `https://people.zoho.com/${ZOHO_ORG}/zp#hrservices`;

interface HRLetterDef {
  key: string;
  label: string;
  desc: string;
  icon: typeof FileText;
  /** Zoho People hrservices URL slug. null = not yet enabled in Zoho instance. */
  zohoPath: string | null;
  fields?: string[];
  category: "employment" | "certification" | "separation" | "admin";
}

const HR_LETTER_DEFS: HRLetterDef[] = [
  // ── Employment proofs (most requested) ────────────────────────
  {
    key: "bonafide",
    label: "Bonafide Letter",
    desc: "Confirms current employment status for official or external use (bank account, higher studies, visa).",
    icon: ShieldCheck,
    zohoPath: "bonafideletter",
    fields: ["Reason for request"],
    category: "employment",
  },
  {
    key: "experience",
    label: "Experience Letter",
    desc: "Certifies tenure, designation and function — required by future employers or background checks.",
    icon: Award,
    zohoPath: "experienceletter",
    fields: ["Reason for request"],
    category: "employment",
  },
  {
    key: "employment_verification",
    label: "Employment Verification Letter",
    desc: "Formal letter verifying you are an active employee, issued to third parties on request.",
    icon: UserRound,
    zohoPath: null,
    category: "employment",
  },
  {
    key: "address_proof",
    label: "Address Proof Letter",
    desc: "Company-certified address verification for banks, government offices, or visa applications.",
    icon: Home,
    zohoPath: null,
    fields: ["Purpose"],
    category: "employment",
  },
  {
    key: "noc",
    label: "No Objection Certificate",
    desc: "States the company has no objection to you pursuing a specific activity (studies, travel, side project).",
    icon: CheckCircle2,
    zohoPath: null,
    fields: ["Purpose"],
    category: "employment",
  },
  // ── Certifications ─────────────────────────────────────────────
  {
    key: "internship",
    label: "Internship Completion Certificate",
    desc: "Certifies successful completion of your internship, including duration and role.",
    icon: GraduationCap,
    zohoPath: null,
    fields: ["Internship duration"],
    category: "certification",
  },
  {
    key: "recommendation",
    label: "Recommendation Letter",
    desc: "Professional recommendation from the company for higher studies or career opportunities.",
    icon: ThumbsUp,
    zohoPath: null,
    fields: ["Purpose", "Recipient"],
    category: "certification",
  },
  // ── Separation ─────────────────────────────────────────────────
  {
    key: "relieving",
    label: "Relieving Letter",
    desc: "Issued upon separation — confirms last working date, role, and formal clearance.",
    icon: LogOut,
    zohoPath: null,
    fields: ["Last working date"],
    category: "separation",
  },
  // ── Other admin letters ────────────────────────────────────────
  {
    key: "travel_support",
    label: "Travel / Visa Support Letter",
    desc: "Official letter supporting your visa application or business travel abroad.",
    icon: Plane,
    zohoPath: null,
    fields: ["Destination", "Travel purpose", "Travel dates"],
    category: "admin",
  },
];

const CATEGORY_LABELS: Record<HRLetterDef["category"], string> = {
  employment: "Employment Proofs",
  certification: "Certificates",
  separation: "Separation Letters",
  admin: "Other Letters",
};

function ZohoHRLetters() {
  const categories = Array.from(
    new Set(HR_LETTER_DEFS.map((d) => d.category)),
  ) as HRLetterDef["category"][];

  const availableCount = HR_LETTER_DEFS.filter((d) => !!d.zohoPath).length;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8 py-6">
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Letters &amp; Certificates</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Clicking "Request" opens the form — your details are pre-filled there.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {availableCount} of {HR_LETTER_DEFS.length} available now
        </span>
      </div>

      <div className="space-y-6">
        {categories.map((cat) => {
          const defs = HR_LETTER_DEFS.filter((d) => d.category === cat);
          return (
            <div key={cat}>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {defs.map((def) => {
                  const Icon = def.icon;
                  const available = !!def.zohoPath;
                  const zohoUrl = available ? `${ZOHO_BASE}/${def.zohoPath}/add` : null;

                  return (
                    <div
                      key={def.key}
                      className={cn(
                        "relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-4 shadow-sm transition-shadow",
                        available
                          ? "border-[var(--border)] bg-card/70 hover:shadow-md"
                          : "border-[var(--border)]/50 bg-muted/20",
                      )}
                    >
                      {available && (
                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px]"
                          style={{ background: "var(--gradient-primary)" }}
                        />
                      )}

                      <div className="flex items-start gap-3 pt-0.5">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            background: available
                              ? "color-mix(in oklab, var(--connectivity) 12%, transparent)"
                              : "color-mix(in oklab, var(--muted-foreground) 6%, transparent)",
                          }}
                        >
                          <Icon
                            className="h-4.5 w-4.5"
                            style={{
                              color: available ? "var(--connectivity)" : "var(--muted-foreground)",
                              opacity: available ? 1 : 0.5,
                            }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p
                              className={cn(
                                "text-[13px] font-semibold leading-snug",
                                available ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {def.label}
                            </p>
                            {!available && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70">
                                Coming soon
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                            {def.desc}
                          </p>
                          {def.fields && def.fields.length > 0 && (
                            <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                              You'll need: {def.fields.join(", ")}
                            </p>
                          )}
                        </div>
                      </div>

                      {zohoUrl ? (
                        <a
                          href={zohoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold text-white transition-all hover:opacity-90 sm:w-auto sm:self-start"
                          style={{ background: "var(--gradient-primary)" }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Request in Zoho People
                        </a>
                      ) : (
                        <button
                          disabled
                          className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[var(--border)]/50 px-4 py-2 text-[12px] font-semibold text-muted-foreground/40 sm:w-auto sm:self-start"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Request in Zoho People
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--border)]/60 bg-muted/30 p-4">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Submitted requests follow the HR approval workflow in Zoho People. You'll receive an email
          once your letter is ready to download.
        </p>
      </div>
    </div>
  );
}

// ── HR: manage document templates ─────────────────────────────────────────────

function ManageTemplates({
  authHeaders,
  onChanged,
  onApproversChanged,
}: {
  authHeaders: Record<string, string>;
  onChanged: () => void;
  onApproversChanged?: () => void;
}) {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [edits, setEdits] = useState<Record<number, Partial<DocTemplate>>>({});
  const [saving, setSaving] = useState<number | null>(null);

  // Approver-role settings
  const [approverRoles, setApproverRoles] = useState<string[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<string[]>([]);
  const [canEditApprovers, setCanEditApprovers] = useState(false);
  const [savingApprovers, setSavingApprovers] = useState(false);

  const loadApprovers = useCallback(() => {
    fetch("/api/documents/settings", { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setApproverRoles(d.approver_roles || []);
        setAssignableRoles(d.assignable_roles || []);
        setCanEditApprovers(!!d.can_edit);
      })
      .catch(() => {});
  }, [authHeaders]);

  useEffect(() => {
    loadApprovers();
  }, [loadApprovers]);

  const toggleApprover = (role: string) => {
    if (!canEditApprovers || role === "hr") return; // HR is always an approver
    setApproverRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));
  };

  const saveApprovers = async () => {
    setSavingApprovers(true);
    try {
      const res = await fetch("/api/documents/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ approver_roles: approverRoles }),
      });
      if (!res.ok) throw new Error("Save failed");
      const d = await res.json();
      setApproverRoles(d.approver_roles || []);
      flyBanner("Approval settings updated");
      onApproversChanged?.();
    } catch {
      toast.error("Could not save approval settings.");
    } finally {
      setSavingApprovers(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/documents/admin/templates", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => toast.error("Failed to load templates"))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const merged = (t: DocTemplate): DocTemplate => ({ ...t, ...edits[t.id] });

  const patch = (id: number, p: Partial<DocTemplate>) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));

  const patchField = (id: number, name: string, p: Partial<DocField>) => {
    const t = merged(templates.find((x) => x.id === id)!);
    const fields = t.fields.map((f) => (f.name === name ? { ...f, ...p } : f));
    patch(id, { fields });
  };

  const isDirty = (id: number) => !!edits[id] && Object.keys(edits[id]).length > 0;

  const save = async (t: DocTemplate) => {
    const m = merged(t);
    setSaving(t.id);
    try {
      const res = await fetch(`/api/documents/admin/templates/${t.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          enabled: m.enabled,
          requires_approval: m.requires_approval,
          label: m.label,
          fields: m.fields,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      flyBanner("Template updated");
      setEdits((e) => {
        const n = { ...e };
        delete n[t.id];
        return n;
      });
      load();
      onChanged();
    } catch {
      toast.error("Could not save the template.");
    } finally {
      setSaving(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/documents/admin/templates/sync", {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Sync failed");
      toast.success("Sync started — new templates will appear shortly. Refreshing…");
      setTimeout(() => {
        load();
        onChanged();
      }, 2500);
    } catch {
      toast.error("Could not start the sync.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Document templates</h2>
          <p className="text-[12px] text-muted-foreground">
            Synced from SharePoint. Enable a template to add it to the dropdown, set whether it
            needs approval, and review the fields the app detected.
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3.5 py-2 text-[12px] font-semibold text-foreground hover:bg-muted/60 w-full sm:w-auto shrink-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          Sync from SharePoint
        </button>
      </div>

      {/* ── Who can approve & release ── */}
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-card/60 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" style={{ color: "var(--connectivity)" }} />
          <h3 className="text-[14px] font-semibold text-foreground">
            Who can approve &amp; release
          </h3>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Select which roles may approve a draft and release the final document. HR is always an
          approver. {canEditApprovers ? "" : "Only HR can change this."}
        </p>
        <div className="mt-3 flex flex-wrap gap-6">
          {assignableRoles.map((role) => {
            const checked = approverRoles.includes(role);
            const locked = role === "hr" || !canEditApprovers;
            return (
              <label
                key={role}
                className={cn(
                  "flex items-center gap-2 text-[12px] capitalize text-foreground",
                  locked ? "cursor-default opacity-90" : "cursor-pointer",
                )}
              >
                <Switch
                  checked={checked}
                  disabled={locked}
                  onCheckedChange={() => toggleApprover(role)}
                />
                {role}
                {role === "hr" && (
                  <span className="text-[10px] text-muted-foreground">(always)</span>
                )}
              </label>
            );
          })}
        </div>
        {canEditApprovers && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={saveApprovers}
              disabled={savingApprovers}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white transition-all hover:opacity-90 w-full sm:w-auto"
              style={{ background: "var(--gradient-primary)" }}
            >
              {savingApprovers ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save approval settings
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No templates yet. Drop PDF/DOCX files into the SharePoint templates folder and click “Sync
          from SharePoint”.
        </p>
      ) : (
        <div className="space-y-4">
          {templates.map((t0) => {
            const t = merged(t0);
            return (
              <div
                key={t.id}
                className="rounded-2xl border border-[var(--border)] bg-card/60 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      value={t.label}
                      onChange={(e) => patch(t.id, { label: e.target.value })}
                      className="w-full rounded-lg border border-transparent bg-transparent text-[14px] font-semibold text-foreground hover:border-[var(--border)] focus:border-[var(--border)] focus:outline-none focus:ring-0 px-1 py-0.5"
                    />
                    <div className="mt-0.5 px-1 font-mono text-[11px] text-muted-foreground">
                      {t.filename}
                      {t.updated_at ? ` · synced ${new Date(t.updated_at).toLocaleString()}` : ""}
                    </div>
                  </div>
                  {t.setup_status === "needs_review" && (
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      Needs review
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <Switch
                      checked={t.enabled}
                      onCheckedChange={(v) => patch(t.id, { enabled: v })}
                    />
                    Enabled (show in dropdown)
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <Switch
                      checked={t.requires_approval}
                      onCheckedChange={(v) => patch(t.id, { requires_approval: v })}
                    />
                    Requires approval
                  </label>
                </div>

                {t.fields.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-muted/20 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Detected fields
                    </div>
                    <div className="space-y-3">
                      {t.fields.map((f) => (
                        <div
                          key={f.name}
                          className="flex flex-col gap-2 p-2.5 rounded-xl bg-card border border-[var(--border)]/30 sm:flex-row sm:items-center sm:bg-transparent sm:border-0 sm:p-0 sm:gap-2"
                        >
                          <span className="w-full sm:w-40 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                            {`{{${f.name}}}`}
                          </span>
                          <div className="flex flex-col gap-2 w-full sm:flex-row sm:flex-1 sm:items-center">
                            <Input
                              value={f.label}
                              onChange={(e) => patchField(t.id, f.name, { label: e.target.value })}
                              className="h-8 w-full text-[12px]"
                            />
                            <div className="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:gap-2 sm:w-auto">
                              <select
                                value={f.type}
                                onChange={(e) =>
                                  patchField(t.id, f.name, { type: e.target.value as FieldType })
                                }
                                className="h-8 rounded-md border border-[var(--border)] bg-background px-2 text-[11px] w-full sm:w-auto sm:min-w-[85px]"
                              >
                                <option value="text">text</option>
                                <option value="textarea">textarea</option>
                                <option value="date">date</option>
                                <option value="select">select</option>
                              </select>
                              <select
                                value={f.source}
                                onChange={(e) =>
                                  patchField(t.id, f.name, {
                                    source: e.target.value as "auto" | "user",
                                  })
                                }
                                className="h-8 rounded-md border border-[var(--border)] bg-background px-2 text-[11px] w-full sm:w-auto sm:min-w-[110px]"
                                title="auto = filled from employee record; user = entered at generation"
                              >
                                <option value="user">user-entered</option>
                                <option value="auto">auto-filled</option>
                              </select>
                              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0 select-none px-1 w-full sm:w-auto">
                                <input
                                  type="checkbox"
                                  checked={f.required}
                                  onChange={(e) =>
                                    patchField(t.id, f.name, { required: e.target.checked })
                                  }
                                  className="rounded border-[var(--border)] text-primary focus:ring-primary h-3.5 w-3.5"
                                />
                                required
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => save(t0)}
                    disabled={!isDirty(t.id) || saving === t.id}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white transition-all w-full sm:w-auto",
                      isDirty(t.id) ? "hover:opacity-90" : "cursor-not-allowed opacity-40",
                    )}
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    {saving === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Document Library ─────────────────────────────────────────────────────────

interface LibraryDoc {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  filename: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string | null;
  source?: "upload" | "sharepoint";
}

const FILE_TYPE_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  ppt: FilePieChart,
  pptx: FilePieChart,
  doc: FileText,
  docx: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  zip: FileArchive,
  rar: FileArchive,
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentLibrary({
  authHeaders,
  isLibraryAdmin,
}: {
  authHeaders: Record<string, string>;
  isLibraryAdmin: boolean;
}) {
  const [uploadedDocs, setUploadedDocs] = useState<LibraryDoc[]>([]);
  const [spDocs, setSpDocs] = useState<LibraryDoc[]>([]);
  const [filterCat, setFilterCat] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  // upload form
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadCat, setUploadCat] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const baseHeaders = useMemo(() => {
    const { "Content-Type": _, ...rest } = authHeaders;
    return rest;
  }, [authHeaders]);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const [uploadedRes, spRes] = await Promise.all([
        fetch("/api/document-library", { headers: baseHeaders }),
        fetch("/api/document-library/policies", { headers: baseHeaders }),
      ]);
      const uploadedData = await uploadedRes.json();
      const spData = await spRes.json();
      const uploaded: LibraryDoc[] = (uploadedData.documents || []).map((d: LibraryDoc) => ({
        ...d,
        source: "upload" as const,
      }));
      const sp: LibraryDoc[] = (spData.documents || []).map((d: LibraryDoc) => ({
        ...d,
        source: "sharepoint" as const,
      }));
      setUploadedDocs(uploaded);
      setSpDocs(sp);
    } catch {
      toast.error("Failed to load document library");
    } finally {
      setLoading(false);
    }
  }, [baseHeaders]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Combine and derive categories from all docs
  const allDocs = useMemo(
    () => [...uploadedDocs, ...spDocs],
    [uploadedDocs, spDocs],
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allDocs.forEach((d) => {
      if (d.category) cats.add(d.category);
    });
    return Array.from(cats).sort();
  }, [allDocs]);

  const handleUpload = async () => {
    if (!uploadTitle.trim() || !uploadFile) {
      toast.error("Title and file are required.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("title", uploadTitle.trim());
      fd.append("description", uploadDesc.trim());
      fd.append("category", uploadCat.trim());
      fd.append("file", uploadFile);
      const r = await fetch("/api/document-library/upload", {
        method: "POST",
        headers: baseHeaders,
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      flyBanner("Document uploaded to the library!");
      setUploadOpen(false);
      setUploadTitle("");
      setUploadDesc("");
      setUploadCat("");
      setUploadFile(null);
      fetchDocs();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: LibraryDoc) => {
    try {
      const endpoint =
        doc.source === "sharepoint"
          ? `/api/document-library/policies/${doc.id}/download`
          : `/api/document-library/${doc.id}/download`;
      const r = await fetch(endpoint, { headers: baseHeaders });
      if (!r.ok) throw new Error("Download failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const r = await fetch(`/api/document-library/${id}`, {
        method: "DELETE",
        headers: baseHeaders,
      });
      if (!r.ok) throw new Error("Delete failed");
      toast.success("Document removed from library");
      setUploadedDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const handleView = async (doc: LibraryDoc) => {
    const endpoint =
      doc.source === "sharepoint"
        ? `/api/document-library/policies/${doc.id}/download`
        : `/api/document-library/${doc.id}/download`;
    try {
      const r = await fetch(endpoint, { headers: baseHeaders });
      if (!r.ok) throw new Error("Failed to load document");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (doc.file_type === "pdf") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.error("Could not open the document.");
    }
  };

  const filtered = allDocs.filter(
    (d) =>
      (!filterCat || d.category === filterCat) &&
      (!searchQ ||
        d.title.toLowerCase().includes(searchQ.toLowerCase()) ||
        (d.category || "").toLowerCase().includes(searchQ.toLowerCase()) ||
        d.filename.toLowerCase().includes(searchQ.toLowerCase())),
  );

  return (
    <TooltipProvider>
      <div className="min-h-full">
        {/* ── Page header ────────────────────────────────────────────────── */}
        <div className="border-b border-border bg-card/60 backdrop-blur-sm px-4 sm:px-8 py-5">
          <div className="mx-auto max-w-5xl flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-bold text-foreground">Document Library</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {loading ? (
                  <Skeleton className="h-4 w-28" />
                ) : (
                  <span className="text-[12px] text-muted-foreground">
                    {allDocs.length} document{allDocs.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>

            {isLibraryAdmin && (
              <Sheet
                open={uploadOpen}
                onOpenChange={(open) => {
                  setUploadOpen(open);
                  if (!open) setUploadFile(null);
                }}
              >
                <SheetTrigger asChild>
                  <Button size="sm" className="shrink-0 gap-2">
                    <Upload className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Upload</span>
                  </Button>
                </SheetTrigger>

                <SheetContent
                  side="right"
                  className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
                >
                  <SheetHeader className="border-b border-border px-6 py-5">
                    <SheetTitle>Upload document</SheetTitle>
                    <SheetDescription>
                      Add a file to the shared document library.
                    </SheetDescription>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="ul-title">
                          Title <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="ul-title"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          placeholder="e.g. Q1 Company Overview"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ul-cat">Category</Label>
                        <Input
                          id="ul-cat"
                          value={uploadCat}
                          onChange={(e) => setUploadCat(e.target.value)}
                          placeholder="e.g. Policies, Training"
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label htmlFor="ul-desc">Description</Label>
                        <Textarea
                          id="ul-desc"
                          value={uploadDesc}
                          onChange={(e) => setUploadDesc(e.target.value)}
                          placeholder="Brief description of this document…"
                          className="resize-none"
                          rows={3}
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label>
                          File <span className="text-destructive">*</span>
                        </Label>
                        <label
                          className={cn(
                            "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 cursor-pointer transition-colors",
                            dragOver
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40 hover:bg-muted/30",
                          )}
                          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            const f = e.dataTransfer.files?.[0];
                            if (f) setUploadFile(f);
                          }}
                        >
                          <input
                            type="file"
                            accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.zip"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          {uploadFile ? (
                            <>
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                                <FileText className="h-5 w-5 text-primary" />
                              </div>
                              <p className="text-[13px] font-semibold text-foreground">
                                {uploadFile.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatBytes(uploadFile.size)}
                              </p>
                              <span className="text-[11px] text-primary">Click to change</span>
                            </>
                          ) : (
                            <>
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                                <Upload className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <p className="text-[13px] font-medium text-foreground">
                                Drag & drop or{" "}
                                <span className="font-semibold text-primary">browse files</span>
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                PDF, DOCX, PPTX, XLSX, PNG, ZIP · max 50 MB
                              </p>
                            </>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>

                  <SheetFooter className="border-t border-border px-6 py-4 gap-2 sm:gap-2">
                    <SheetClose asChild>
                      <Button variant="outline" className="w-full sm:w-auto">
                        Cancel
                      </Button>
                    </SheetClose>
                    <Button
                      onClick={handleUpload}
                      disabled={uploading}
                      className="w-full sm:w-auto gap-2"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploading ? "Uploading…" : "Upload document"}
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 sm:px-8 py-5 space-y-4">
          {/* ── Search ──────────────────────────────────────────────────── */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search by title, category or filename…"
              className="pl-10 h-10 rounded-xl"
            />
            {searchQ && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchQ("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* ── Category pills ──────────────────────────────────────────── */}
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Button
                size="sm"
                variant={!filterCat ? "default" : "secondary"}
                onClick={() => setFilterCat("")}
                className="shrink-0 rounded-full"
              >
                All
              </Button>
              {categories.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={filterCat === c ? "default" : "secondary"}
                  onClick={() => setFilterCat(filterCat === c ? "" : c)}
                  className="shrink-0 rounded-full whitespace-nowrap"
                >
                  {c}
                </Button>
              ))}
            </div>
          )}

          {/* ── Document grid ───────────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-2xl border border-border bg-card overflow-hidden"
                >
                  <Skeleton className="h-[3px] w-full rounded-none shrink-0" />
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    </div>
                    <Skeleton className="h-2.5 w-full" />
                    <Skeleton className="h-2.5 w-4/5" />
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-2.5 w-10" />
                      <Skeleton className="h-7 w-24 rounded-lg" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Library className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-[14px] font-semibold text-foreground">
                {allDocs.length === 0 ? "No documents yet" : "No results found"}
              </p>
              <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
                {allDocs.length === 0
                  ? isLibraryAdmin
                    ? "Upload the first document to get started."
                    : "No documents have been added yet."
                  : "Try different keywords or clear the active filters."}
              </p>
              {allDocs.length === 0 && isLibraryAdmin && (
                <Button
                  className="mt-5 gap-2"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="h-4 w-4" /> Upload document
                </Button>
              )}
              {(searchQ || filterCat) && (
                <Button
                  variant="link"
                  className="mt-2"
                  onClick={() => { setSearchQ(""); setFilterCat(""); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((doc) => {
                const Icon = FILE_TYPE_ICON[doc.file_type] ?? FileText;
                const canPreview = doc.file_type === "pdf";
                return (
                  <Card
                    key={`${doc.source ?? "upload"}-${doc.id}`}
                    className="group/card flex flex-col [&>div:last-child]:flex [&>div:last-child]:flex-col"
                  >
                    <div
                      className="h-[3px] w-full shrink-0"
                      style={{ background: "var(--gradient-primary)" }}
                    />

                    <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
                      {/* Icon + title */}
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <p className="line-clamp-2 flex-1 pt-0.5 text-[13px] font-semibold leading-snug text-foreground">
                          {doc.title}
                        </p>
                      </div>

                      {/* Category badge */}
                      {doc.category && (
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="default">{doc.category}</Badge>
                        </div>
                      )}

                      {/* Description */}
                      {doc.description && (
                        <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                          {doc.description}
                        </p>
                      )}

                      {/* Footer */}
                      <div className="mt-auto">
                        <Separator className="mb-3" />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {doc.file_type.toUpperCase()}
                            {doc.file_size > 0 && (
                              <span className="text-muted-foreground/60">
                                {" · "}{formatBytes(doc.file_size)}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            {isLibraryAdmin && doc.source !== "sharepoint" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(doc.id)}
                                    disabled={deleting === doc.id}
                                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover/card:opacity-100 transition-opacity"
                                  >
                                    {deleting === doc.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete document</TooltipContent>
                              </Tooltip>
                            )}
                            {canPreview && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleView(doc)}
                                className="h-7 gap-1.5 px-3 text-[11px]"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                View
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownload(doc)}
                              className="h-7 gap-1.5 px-3 text-[11px]"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── PillTab ───────────────────────────────────────────────────────────────────

function PillTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0",
        active ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

