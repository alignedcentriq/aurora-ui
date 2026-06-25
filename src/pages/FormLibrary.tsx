import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  FileText,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  EyeOff,
  Sparkles,
  Wand2,
  Lightbulb,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const FIELD_TYPES = [
  "text",
  "textarea",
  "date",
  "select",
  "number",
  "email",
  "checkbox",
  "user",
  "image",
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

// Identity attributes a field can pre-fill from the logged-in user's profile, so chat opens the
// form already populated and the user only confirms. "" = filled by hand (the default).
// Must stay in sync with _AUTOFILL_SOURCES in backend/app/services/form_library_service.py.
const AUTOFILL_SOURCES = [
  { value: "", label: "No auto-fill (manual)" },
  { value: "name", label: "Full name" },
  { value: "email", label: "Work email" },
  { value: "employee_id", label: "Employee ID" },
  { value: "department", label: "Department" },
  { value: "designation", label: "Designation" },
  { value: "location", label: "Location" },
  { value: "manager", label: "Manager" },
] as const;
type AutofillSource = (typeof AUTOFILL_SOURCES)[number]["value"];

interface BuilderField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string; // comma-separated in the editor
  placeholder: string;
  autofill: AutofillSource;
}

interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  autofill?: AutofillSource;
}

interface FormTemplate {
  id: number;
  name: string;
  description: string;
  category: string;
  fields: FormField[];
  enabled: boolean;
  trigger_keywords: string;
  notify_email: string;
  notify_domain: string;
  is_anonymous: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_embedding: boolean;
}

interface KeywordSuggestion {
  keyword: string;
  count: number;
  samples: string[];
}
interface FormSuggestions {
  form_id: number;
  form_name: string;
  near_miss_count: number;
  suggestions: KeywordSuggestion[];
}

interface Submission {
  id: number;
  reference_id: string;
  form_template_id: number;
  form_name: string;
  is_anonymous: boolean;
  employee_email: string | null;
  field_values: Record<string, unknown>;
  status: string;
  admin_remarks: string;
  reviewed_by: string | null;
  submitted_at: string | null;
}

const EMPTY_FIELD: BuilderField = {
  name: "",
  label: "",
  type: "text",
  required: false,
  options: "",
  placeholder: "",
  autofill: "",
};

type MetaState = {
  name: string;
  description: string;
  category: string;
  trigger_keywords: string;
  notify_email: string;
  notify_domain: string;
  is_anonymous: boolean;
};
const EMPTY_META: MetaState = {
  name: "",
  description: "",
  category: "",
  trigger_keywords: "",
  notify_email: "",
  notify_domain: "",
  is_anonymous: false,
};

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20";

export function FormLibrary() {
  const { user } = useAuth();
  const [tab, setTab] = useState("forms");
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [meta, setMeta] = useState<MetaState>(EMPTY_META);
  const [fields, setFields] = useState<BuilderField[]>([{ ...EMPTY_FIELD }]);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [aiPrompt, setAiPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestData, setSuggestData] = useState<{
    forms: FormSuggestions[];
    scanned: number;
    window_days: number;
  } | null>(null);
  const [addingKw, setAddingKw] = useState<Set<string>>(new Set());

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/form-library", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load forms");
      setForms(await res.json());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load forms");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  const loadSubmissions = useCallback(async () => {
    setSubsLoading(true);
    try {
      const res = await fetch("/api/admin/form-library/submissions", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load submissions");
      setSubmissions(await res.json());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load submissions");
    } finally {
      setSubsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  const isAuthorized = user?.role === "Admin" || user?.role === "Super Admin";

  useEffect(() => {
    if (isAuthorized) load();
  }, [user?.role, load]);

  useEffect(() => {
    if (isAuthorized && tab === "submissions") loadSubmissions();
  }, [user?.role, tab, loadSubmissions]);

  if (!isAuthorized) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to the Admin team.
      </div>
    );
  }

  const toggleEnabled = async (f: FormTemplate) => {
    setToggling((prev) => new Set(prev).add(f.id));
    try {
      const res = await fetch(`/api/admin/form-library/${f.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ enabled: !f.enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setForms((prev) => prev.map((t) => (t.id === f.id ? { ...t, enabled: !f.enabled } : t)));
      toast.success(f.enabled ? "Form disabled" : "Form enabled");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setToggling((prev) => {
        const s = new Set(prev);
        s.delete(f.id);
        return s;
      });
    }
  };

  const openAdd = () => {
    setEditId(null);
    setMeta(EMPTY_META);
    setFields([{ ...EMPTY_FIELD }]);
    setAiPrompt("");
    setDialogOpen(true);
  };

  const openEdit = (f: FormTemplate) => {
    setEditId(f.id);
    setMeta({
      name: f.name,
      description: f.description,
      category: f.category || "",
      trigger_keywords: f.trigger_keywords || "",
      notify_email: f.notify_email || "",
      notify_domain: f.notify_domain || "",
      is_anonymous: f.is_anonymous ?? false,
    });
    setFields(
      (f.fields || []).map((fld) => ({
        name: fld.name,
        label: fld.label || "",
        type: fld.type,
        required: Boolean(fld.required),
        options: (fld.options || []).join(", "),
        placeholder: fld.placeholder || "",
        autofill: (fld.autofill as AutofillSource) || "",
      })),
    );
    setAiPrompt("");
    setDialogOpen(true);
  };

  // Draft a new form (POST /generate) or revise the one being edited (POST /generate-edit)
  // from a plain-English prompt, then load the result into the builder for review. Nothing
  // is persisted until the admin hits Save.
  const runAi = async () => {
    const text = aiPrompt.trim();
    if (!text) return;
    const isEdit = editId !== null;
    setDrafting(true);
    try {
      const res = await fetch(
        isEdit ? "/api/admin/form-library/generate-edit" : "/api/admin/form-library/generate",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(isEdit ? { form_id: editId, instruction: text } : { prompt: text }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't draft the form");
      setMeta((m) => ({
        ...m,
        name: data.name || m.name,
        description: data.description || m.description,
        category: data.category || m.category,
      }));
      const drafted: BuilderField[] = (data.fields || []).map(
        (f: {
          name?: string;
          label?: string;
          type?: string;
          required?: boolean;
          options?: string[];
          placeholder?: string;
        }) => ({
          name: f.name || "",
          label: f.label || "",
          type: (FIELD_TYPES as readonly string[]).includes(f.type || "")
            ? (f.type as FieldType)
            : "text",
          required: Boolean(f.required),
          options: Array.isArray(f.options) ? f.options.join(", ") : "",
          placeholder: f.placeholder || "",
          autofill: "",
        }),
      );
      if (drafted.length) setFields(drafted);
      setAiPrompt("");
      toast.success(isEdit ? "Form revised — review and save." : "Drafted — review and save.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft the form");
    } finally {
      setDrafting(false);
    }
  };

  const openSuggest = async () => {
    setSuggestOpen(true);
    setSuggesting(true);
    setSuggestData(null);
    try {
      const res = await fetch("/api/admin/form-library/keyword-suggestions?window_days=30", {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't load suggestions");
      setSuggestData(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't load suggestions");
      setSuggestOpen(false);
    } finally {
      setSuggesting(false);
    }
  };

  const addSuggestedKeyword = async (formId: number, keyword: string) => {
    const f = forms.find((x) => x.id === formId);
    if (!f) return;
    const key = `${formId}:${keyword}`;
    setAddingKw((prev) => new Set(prev).add(key));
    try {
      const existing = f.trigger_keywords
        ? f.trigger_keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [];
      const seen = new Set(existing.map((k) => k.toLowerCase()));
      if (!seen.has(keyword.toLowerCase())) existing.push(keyword);
      const merged = existing.join(", ");
      const res = await fetch(`/api/admin/form-library/${formId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ trigger_keywords: merged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't add keyword");
      setForms((prev) =>
        prev.map((x) => (x.id === formId ? { ...x, trigger_keywords: merged } : x)),
      );
      setSuggestData((prev) =>
        prev
          ? {
              ...prev,
              forms: prev.forms
                .map((s) =>
                  s.form_id === formId
                    ? { ...s, suggestions: s.suggestions.filter((y) => y.keyword !== keyword) }
                    : s,
                )
                .filter((s) => s.suggestions.length > 0),
            }
          : prev,
      );
      toast.success(`Added "${keyword}" to ${f.name}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't add keyword");
    } finally {
      setAddingKw((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
  };

  const updateField = (idx: number, patch: Partial<BuilderField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const addField = () => setFields((prev) => [...prev, { ...EMPTY_FIELD }]);
  const removeField = (idx: number) => setFields((prev) => prev.filter((_, i) => i !== idx));
  const moveField = (idx: number, dir: -1 | 1) =>
    setFields((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const validFields = fields.filter((f) => f.name.trim());
  const valid =
    meta.name.trim().length > 0 &&
    meta.description.trim().length > 0 &&
    validFields.length > 0 &&
    validFields.every((f) => f.type !== "select" || f.options.split(",").some((o) => o.trim()));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payloadFields: FormField[] = validFields.map((f) => {
        const out: FormField = {
          name: f.name.trim(),
          label: f.label.trim() || f.name.trim(),
          type: f.type,
          required: f.required,
        };
        if (f.placeholder.trim()) out.placeholder = f.placeholder.trim();
        if (f.autofill) out.autofill = f.autofill;
        if (f.type === "select")
          out.options = f.options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean);
        return out;
      });
      const isEdit = editId !== null;
      const res = await fetch(
        isEdit ? `/api/admin/form-library/${editId}` : "/api/admin/form-library",
        {
          method: isEdit ? "PUT" : "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: meta.name.trim(),
            description: meta.description.trim(),
            category: meta.category.trim(),
            trigger_keywords: meta.trigger_keywords.trim(),
            notify_email: meta.notify_email.trim(),
            notify_domain: meta.notify_domain.trim(),
            is_anonymous: meta.is_anonymous,
            fields: payloadFields,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Save failed");
      toast.success(isEdit ? "Form updated" : "Form created");
      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    const id = deleteId;
    setDeleteId(null);
    try {
      const res = await fetch(`/api/admin/form-library/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed");
      }
      toast.success("Form deleted");
      setForms((prev) => prev.filter((f) => f.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const review = async (sub: Submission, status: "Approved" | "Rejected") => {
    try {
      const res = await fetch(`/api/admin/form-library/submissions/${sub.id}/review`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ status, remarks: "" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Review failed");
      }
      toast.success(`Marked ${status}`);
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status } : s)));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    }
  };

  const statusBadge = (status: string) => {
    const cls =
      status === "Approved"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
        : status === "Rejected"
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    return (
      <span
        className={cn(
          "inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
          cls,
        )}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f5f7fa] dark:bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
            Assets & Config
          </p>
          <h1 className="text-[22px] font-bold text-[#0f172a] dark:text-white tracking-tight flex items-center gap-2">
            Form Library
          </h1>
          <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
            Build fillable forms (visitor pass, parking, …). When a user's question matches a form,
            Centriq renders it inline in chat — no code change needed for new forms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => (tab === "forms" ? load() : loadSubmissions())}
            disabled={loading || subsLoading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card text-[#64748b] dark:text-white/60 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", (loading || subsLoading) && "animate-spin")} />
          </button>
          {tab === "forms" && (
            <>
              <button
                onClick={openSuggest}
                disabled={forms.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/[0.06] px-3.5 py-2 text-[13px] font-semibold text-[#7c3aed] dark:text-violet-300 hover:bg-[#8B5CF6]/[0.12] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Mine recent chat questions for trigger keywords your forms are missing"
              >
                <Lightbulb className="h-4 w-4" />
                Suggest keywords
              </button>
              <button
                onClick={openAdd}
                className="flex items-center gap-1.5 rounded-xl bg-[#00a29a] dark:bg-[#00c4bb] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
              >
                <Plus className="h-4 w-4" />
                New form
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex items-center px-8 py-3 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-white/[0.04] p-1">
          <button
            onClick={() => setTab("forms")}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all cursor-pointer",
              tab === "forms"
                ? "bg-white dark:bg-slate-800 text-[#0f172a] dark:text-white shadow-sm font-semibold"
                : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80",
            )}
          >
            Forms
          </button>
          <button
            onClick={() => setTab("submissions")}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all cursor-pointer",
              tab === "submissions"
                ? "bg-white dark:bg-slate-800 text-[#0f172a] dark:text-white shadow-sm font-semibold"
                : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80",
            )}
          >
            Submissions
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-[#f5f7fa] dark:bg-background">
        {tab === "forms" ? (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-[#64748b] dark:text-white/50">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : forms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl bg-white dark:bg-card shadow-sm max-w-xl mx-auto">
                <FileText className="h-10 w-10 mb-3 text-[#94a3b8] dark:text-white/40" />
                <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                  No forms yet.
                </h3>
                <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1">
                  Create a form so users can fill it directly from chat.
                </p>
                <button
                  onClick={openAdd}
                  className="mt-5 flex items-center gap-1.5 rounded-xl bg-[#00a29a] dark:bg-[#00c4bb] px-5 py-2.5 text-[13px] font-semibold text-white transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  Create your first form
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-card">
                      {["Form", "Fields", "Category", "Status", ""].map((h) => (
                        <th
                          key={h}
                          className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {forms.map((f) => (
                      <tr
                        key={f.id}
                        className="border-b border-[#f1f5f9] dark:border-white/[0.05] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-white/[0.02]"
                      >
                        <td className="py-3.5 px-4 align-top">
                          <div className="font-semibold text-[#0f172a] dark:text-white">
                            {f.name}
                          </div>
                          <div className="text-[12px] text-[#64748b] dark:text-white/50 max-w-[360px] mt-0.5 leading-normal">
                            {f.description}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 align-top text-[#64748b] dark:text-white/60 font-medium">
                          {(f.fields || []).length} fields
                        </td>
                        <td className="py-3.5 px-4 align-top text-[#64748b] dark:text-white/60">
                          {f.category || "—"}
                        </td>
                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold border",
                              f.enabled
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20",
                            )}
                          >
                            {f.enabled ? "Enabled" : "Disabled"}
                          </span>
                          {f.is_anonymous && (
                            <span
                              className="ml-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20"
                              title="Submissions are anonymous — submitter identity is not recorded"
                            >
                              <EyeOff className="h-2.5 w-2.5" /> Anon
                            </span>
                          )}
                          {!f.has_embedding && (
                            <span
                              className="ml-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              title="Embedding pending — back-fills automatically; won't surface in chat until then"
                            >
                              indexing
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 align-top">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => toggleEnabled(f)}
                              disabled={toggling.has(f.id)}
                              className={cn(
                                "rounded-lg p-1.5 transition-colors",
                                f.enabled
                                  ? "text-emerald-500 hover:bg-rose-500/10 hover:text-rose-500"
                                  : "text-zinc-400 dark:text-zinc-600 hover:bg-emerald-500/10 hover:text-emerald-600",
                              )}
                              title={f.enabled ? "Disable" : "Enable"}
                            >
                              {toggling.has(f.id) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : f.enabled ? (
                                <ToggleRight className="h-3.5 w-3.5" />
                              ) : (
                                <ToggleLeft className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => openEdit(f)}
                              className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] hover:text-[#00a29a] dark:hover:text-[#00c4bb] transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteId(f.id)}
                              className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div>
            {subsLoading ? (
              <div className="flex items-center justify-center py-20 text-[#64748b] dark:text-white/50">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : submissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl bg-white dark:bg-card shadow-sm max-w-xl mx-auto">
                <FileText className="h-10 w-10 mb-3 text-[#94a3b8] dark:text-white/40" />
                <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                  No submissions yet.
                </h3>
                <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1">
                  Submissions from users filling out forms will appear here.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-card">
                      {["", "Reference", "Form", "Submitted by", "When", "Status", ""].map(
                        (h, i) => (
                          <th
                            key={i}
                            className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <Fragment key={s.id}>
                        <tr className="border-b border-[#f1f5f9] dark:border-white/[0.05] hover:bg-[#f8fafc] dark:hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-4 w-10">
                            <button
                              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                              className="text-[#94a3b8] hover:text-[#0f172a] dark:hover:text-white transition-colors"
                            >
                              {expanded === s.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-4 font-mono text-[12px] font-semibold text-[#0f172a] dark:text-white">
                            {s.reference_id}
                          </td>
                          <td className="py-3 px-4 font-semibold text-[#0f172a] dark:text-white">
                            {s.form_name}
                          </td>
                          <td className="py-3 px-4 text-[#64748b] dark:text-white/60">
                            {s.is_anonymous ? (
                              <span className="inline-flex items-center gap-1 text-violet-500 dark:text-violet-400 font-medium">
                                <EyeOff className="h-3 w-3" /> Anonymous
                              </span>
                            ) : (
                              s.employee_email || "—"
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#94a3b8] dark:text-white/40">
                            {s.submitted_at
                              ? new Date(s.submitted_at).toLocaleString("en-IN", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="py-3 px-4">{statusBadge(s.status)}</td>
                          <td className="py-3 px-4">
                            {s.status === "Pending" && (
                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => review(s, "Approved")}
                                  className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => review(s, "Rejected")}
                                  className="rounded-lg border border-rose-500/30 px-2.5 py-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {expanded === s.id && (
                          <tr className="bg-[#f8fafc]/50 dark:bg-white/[0.01]">
                            <td
                              colSpan={7}
                              className="py-4 px-8 border-b border-[#f1f5f9] dark:border-white/[0.05]"
                            >
                              <div className="max-w-2xl bg-white dark:bg-background rounded-xl border border-[#e2e8f0] dark:border-white/[0.06] p-4 shadow-sm space-y-2.5">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1">
                                  Form Data Values
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
                                  {Object.entries(s.field_values || {}).map(([k, v]) => (
                                    <div
                                      key={k}
                                      className="flex flex-col gap-0.5 border-b border-dashed border-[#e2e8f0] dark:border-white/[0.05] pb-1.5 last:border-0 last:pb-0"
                                    >
                                      <span className="text-[11px] text-[#94a3b8] dark:text-white/40 uppercase font-semibold tracking-wide">
                                        {k.replace(/_/g, " ")}
                                      </span>
                                      <span className="text-[#0f172a] dark:text-white font-medium break-all">
                                        {String(v) || "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editId !== null ? (
                <Pencil className="h-4 w-4 text-primary" />
              ) : (
                <Plus className="h-4 w-4 text-primary" />
              )}
              {editId !== null ? "Edit form" : "New form"}
            </DialogTitle>
            <DialogDescription>
              The name + description are what Centriq matches against user questions — be
              descriptive.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.04] p-3 mb-4">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#7c3aed] dark:text-violet-300">
              {editId !== null ? (
                <Wand2 className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {editId !== null ? "Refine with AI" : "Describe it, let AI build it"}
            </label>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              {editId !== null
                ? 'Describe a change in plain English — e.g. "add a phone number field and make the date required".'
                : 'Describe the form in a sentence — e.g. "a parking sticker request for 2- and 4-wheelers, routed to admin". AI drafts the fields below for you to review.'}
            </p>
            <div className="flex items-start gap-2 mt-2">
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !drafting &&
                    aiPrompt.trim()
                  ) {
                    e.preventDefault();
                    runAi();
                  }
                }}
                placeholder={
                  editId !== null ? "What should change?" : "What should this form collect?"
                }
                disabled={drafting}
                className="flex-1 min-h-[40px] max-h-[120px]"
              />
              <Button
                type="button"
                onClick={runAi}
                disabled={drafting || !aiPrompt.trim()}
                className="bg-[#8B5CF6] hover:bg-[#7c3aed] text-white shrink-0"
              >
                {drafting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editId !== null ? (
                  <Wand2 className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {drafting ? "Drafting…" : editId !== null ? "Refine" : "Draft"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Name</label>
                <Input
                  value={meta.name}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                  placeholder="e.g. Visitor Pass"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  Category <span className="opacity-60">(optional)</span>
                </label>
                <Input
                  value={meta.category}
                  onChange={(e) => setMeta({ ...meta, category: e.target.value })}
                  placeholder="e.g. Admin"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Description</label>
              <Textarea
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                placeholder="What is this form for? Include phrasings users might say, e.g. 'register a visitor, guest gate pass'."
                className="mt-1 min-h-[64px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">
                Chat trigger keywords <span className="opacity-60">(optional)</span>
              </label>
              <Input
                value={meta.trigger_keywords}
                onChange={(e) => setMeta({ ...meta, trigger_keywords: e.target.value })}
                placeholder="e.g. visitor pass, visitor, guest entry"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Comma-separated. When a user's message contains any of these words, this form opens
                inline in chat automatically. Use specific phrases (e.g. "visitor pass", "guest
                entry") — single generic words like "form", "requests", or "status" are not allowed
                and will be rejected.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  Notify email <span className="opacity-60">(optional)</span>
                </label>
                <Input
                  value={meta.notify_email}
                  onChange={(e) => setMeta({ ...meta, notify_email: e.target.value })}
                  placeholder="who gets new submissions"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  Notify domain <span className="opacity-60">(optional)</span>
                </label>
                <Input
                  value={meta.notify_domain}
                  onChange={(e) => setMeta({ ...meta, notify_domain: e.target.value })}
                  placeholder="admin / hr / it"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Anonymous toggle */}
            <div className="flex items-start gap-3 rounded-xl border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-500/5 px-4 py-3">
              <input
                type="checkbox"
                id="is_anonymous"
                checked={meta.is_anonymous}
                onChange={(e) => setMeta({ ...meta, is_anonymous: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-border accent-violet-600"
              />
              <div>
                <label
                  htmlFor="is_anonymous"
                  className="text-[13px] font-semibold text-violet-700 dark:text-violet-300 cursor-pointer flex items-center gap-1.5"
                >
                  <EyeOff className="h-3.5 w-3.5" /> Anonymous form
                </label>
                <p className="text-[11px] text-violet-600/70 dark:text-violet-400/70 mt-0.5">
                  Submitter identity (name and email) will not be recorded. Admins only see the form
                  responses.
                </p>
              </div>
            </div>

            {/* Field builder */}
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Fields
                </span>
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add field
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((f, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                      <span className="text-[11px] text-muted-foreground">Field {idx + 1}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveField(idx, -1)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                          disabled={idx === 0}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(idx, 1)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                          disabled={idx === fields.length - 1}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(idx)}
                          className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={f.name}
                        onChange={(e) => updateField(idx, { name: e.target.value })}
                        placeholder="field name (e.g. visitor_name)"
                        className={inputClass}
                      />
                      <input
                        value={f.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        placeholder="label (e.g. Visitor Name)"
                        className={inputClass}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 items-center">
                      <select
                        value={f.type}
                        onChange={(e) => updateField(idx, { type: e.target.value as FieldType })}
                        className={inputClass}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                        Required
                      </label>
                    </div>
                    {f.type === "select" && (
                      <input
                        value={f.options}
                        onChange={(e) => updateField(idx, { options: e.target.value })}
                        placeholder="options, comma-separated (e.g. Car, Bike, Other)"
                        className={`${inputClass} mt-2`}
                      />
                    )}
                    <div className="mt-2">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Auto-fill from profile <span className="opacity-60">(optional)</span>
                      </label>
                      <select
                        value={f.autofill}
                        onChange={(e) =>
                          updateField(idx, { autofill: e.target.value as AutofillSource })
                        }
                        className={`${inputClass} mt-1`}
                      >
                        {AUTOFILL_SOURCES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">
                        Pre-fills from the logged-in user's profile — they just confirm. Skipped on
                        anonymous forms.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editId !== null ? "Save changes" : "Create form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keyword suggestions dialog */}
      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-[#8B5CF6]" />
              Learn keywords from chat
            </DialogTitle>
            <DialogDescription>
              Real questions from the last 30 days that{" "}
              <span className="font-medium">matched a form</span> but didn't contain any of its
              trigger keywords — so it never auto-opened inline. Add the ones that fit.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {suggesting ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Scanning recent questions…
              </div>
            ) : !suggestData || suggestData.forms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 mb-3">
                  <Check className="h-6 w-6" />
                </div>
                <p className="text-[14px] font-semibold text-foreground">
                  No new keyword suggestions.
                </p>
                <p className="text-[12px] text-muted-foreground mt-1 max-w-sm">
                  {suggestData
                    ? `Scanned ${suggestData.scanned} recent questions — they're already matching your forms, or there's nothing distinctive to add.`
                    : "Nothing to suggest right now."}
                </p>
              </div>
            ) : (
              <div className="space-y-5 py-1">
                {suggestData.forms.map((f) => (
                  <div
                    key={f.form_id}
                    className="rounded-xl border border-[#e2e8f0] dark:border-white/[0.08] p-4"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="font-bold text-[14px] text-foreground">{f.form_name}</h4>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {f.near_miss_count} question{f.near_miss_count === 1 ? "" : "s"} matched
                        without a keyword
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {f.suggestions.map((s) => {
                        const key = `${f.form_id}:${s.keyword}`;
                        const busy = addingKw.has(key);
                        return (
                          <button
                            key={s.keyword}
                            onClick={() => addSuggestedKeyword(f.form_id, s.keyword)}
                            disabled={busy}
                            title={
                              s.samples.length ? `e.g. "${s.samples.join('"  •  "')}"` : undefined
                            }
                            className="group inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/[0.06] pl-3 pr-2 py-1 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-500/[0.14] transition-colors disabled:opacity-50"
                          >
                            {s.keyword}
                            <span className="text-[10px] text-violet-500/70">×{s.count}</span>
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be triggerable in chat. Existing submissions are also removed. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
