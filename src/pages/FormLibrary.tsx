import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, Fragment, useMemo } from "react";
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
  Search,
  CheckCircle2,
  XCircle,
  FormInput,
  Send,
  Clock,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";

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
  options: string;
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

function getAppGradient(name: string): string {
  const palettes = [
    "from-violet-500 to-purple-600",
    "from-teal-500 to-emerald-600",
    "from-blue-500 to-indigo-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-cyan-500 to-sky-600",
    "from-fuchsia-500 to-purple-600",
    "from-green-500 to-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}

function AppAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const gradient = getAppGradient(name);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl bg-gradient-to-br text-white font-bold shrink-0",
        gradient,
        size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-[13px]",
      )}
    >
      {initials || <FileText className="h-4 w-4" />}
    </div>
  );
}

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
  const [expandedFormId, setExpandedFormId] = useState<number | null>(null);

  // Search & filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [subSearch, setSubSearch] = useState("");
  const [subStatusFilter, setSubStatusFilter] = useState<"all" | "Pending" | "Approved" | "Rejected">("all");

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
          : status === "Pending"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
            : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20";
    return (
      <Badge variant="outline" className={cn("px-2 py-0.5 font-semibold", cls)}>
        {status}
      </Badge>
    );
  };

  const filteredForms = forms.filter((form) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      form.name.toLowerCase().includes(q) ||
      form.description.toLowerCase().includes(q) ||
      form.category?.toLowerCase().includes(q) ||
      (form.trigger_keywords || "").toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && form.enabled) ||
      (statusFilter === "inactive" && !form.enabled);
    return matchesSearch && matchesStatus;
  });

  const activeFormsCount = forms.filter((f) => f.enabled).length;
  const inactiveFormsCount = forms.filter((f) => !f.enabled).length;

  const filteredSubmissions = submissions.filter((sub) => {
    const q = subSearch.toLowerCase();
    const matchesSearch =
      !q ||
      sub.reference_id.toLowerCase().includes(q) ||
      sub.form_name.toLowerCase().includes(q) ||
      (sub.employee_email || "").toLowerCase().includes(q);
    const matchesStatus =
      subStatusFilter === "all" || sub.status === subStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingSubsCount = submissions.filter((s) => s.status === "Pending").length;
  const approvedSubsCount = submissions.filter((s) => s.status === "Approved").length;
  const rejectedSubsCount = submissions.filter((s) => s.status === "Rejected").length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f5f7fa] dark:bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-2 px-8 py-5 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
            Assets & Config
          </p>
          <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5 max-w-[650px]">
            Build fillable forms (visitor pass, parking, …). When a user's question matches a form,
            Centriq renders it inline in chat — no code change needed for new forms.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => (tab === "forms" ? load() : loadSubmissions())}
            disabled={loading || subsLoading}
          >
            <RefreshCw className={cn("h-4 w-4", (loading || subsLoading) && "animate-spin")} />
          </Button>
          {tab === "forms" && (
            <>
              <Button
                variant="outline"
                onClick={openSuggest}
                disabled={forms.length === 0}
                className="gap-1.5 text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/20 hover:text-violet-700 dark:hover:text-violet-300"
              >
                <Lightbulb className="h-4 w-4" />
                Suggest keywords
              </Button>
              <Button
                onClick={openAdd}
                className="gap-1.5 bg-[#00a29a] text-white hover:bg-[#008f88] dark:bg-[#00c4bb] dark:hover:bg-[#00a29a]"
              >
                <Plus className="h-4 w-4" />
                New form
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex items-center px-8 py-3 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
          <TabsList className="bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-white/[0.04]">
            <TabsTrigger value="forms" className="text-[13px]">Forms</TabsTrigger>
            <TabsTrigger value="submissions" className="text-[13px]">Submissions</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 bg-[#f5f7fa] dark:bg-background">
          <TabsContent value="forms" className="m-0 h-full flex flex-col gap-5 border-none p-0 outline-none">
            {loading ? (
               <div className="space-y-4">
               <div className="grid grid-cols-3 gap-4">
                 {[1, 2, 3].map((i) => (
                   <Card key={i} className="animate-pulse shadow-sm h-20" />
                 ))}
               </div>
               <Card className="animate-pulse shadow-sm h-[400px]" />
             </div>
            ) : forms.length === 0 ? (
              <Card className="flex flex-col items-center justify-center py-20 text-center shadow-sm max-w-xl mx-auto border-dashed">
                <FileText className="h-10 w-10 mb-3 text-[#94a3b8] dark:text-white/40" />
                <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                  No forms yet.
                </h3>
                <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1">
                  Create a form so users can fill it directly from chat.
                </p>
                <Button
                  onClick={openAdd}
                  className="mt-5 gap-1.5 bg-[#00a29a] text-white hover:bg-[#008f88] dark:bg-[#00c4bb] dark:hover:bg-[#00a29a]"
                >
                  <Plus className="h-4 w-4" />
                  Create your first form
                </Button>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00a29a]/10 text-[#00a29a] shrink-0">
                        <FormInput className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {forms.length}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">
                          Total forms
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {activeFormsCount}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">Active</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-500/10 text-zinc-500 shrink-0">
                        <XCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {inactiveFormsCount}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">Inactive</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name, description, category or keyword…"
                      className="pl-9 h-9 text-[13px]"
                    />
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                    {(["all", "active", "inactive"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={cn(
                          "px-3 py-1 rounded-md text-[11px] font-semibold transition-colors capitalize",
                          statusFilter === f
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f === "all" ? `All (${forms.length})` : f === "active" ? `Active (${activeFormsCount})` : `Inactive (${inactiveFormsCount})`}
                      </button>
                    ))}
                  </div>
                  <ExportCsvButton
                    rows={filteredForms.map((f) => ({
                      Form: f.name,
                      Description: f.description ?? "",
                      Fields: (f.fields || []).length,
                      Category: f.category || "",
                      Status: f.enabled ? "Enabled" : "Disabled",
                      Anonymous: f.is_anonymous ? "Yes" : "No",
                    }))}
                    filename="form-library.csv"
                  />
                </div>

                <Card className="shadow-sm overflow-hidden border-border">
                  <Table paginate itemsPerPage={10}>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-12 text-center lg:hidden"></TableHead>
                        <TableHead className="w-[300px] text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Form</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Fields</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Category</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                        <TableHead className="text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredForms.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <Search className="h-7 w-7 text-muted-foreground/30 mb-2" />
                              <p className="text-[13px] font-semibold">No forms match your search</p>
                              <Button variant="link" onClick={() => { setSearch(""); setStatusFilter("all"); }} className="mt-1 h-auto py-0 text-[12px]">
                                Clear filters
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredForms.map((f) => (
                          <Fragment key={f.id}>
                          <TableRow className="group align-top">
                            <TableCell className="w-12 text-center py-3.5 lg:hidden align-middle">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground group-hover:text-foreground"
                                onClick={() => setExpandedFormId(expandedFormId === f.id ? null : f.id)}
                              >
                                {expandedFormId === f.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </TableCell>
                            <TableCell className="py-3.5 w-full lg:w-auto">
                              <div className="flex items-start gap-3">
                                <AppAvatar name={f.name} size="md" />
                                <div className="min-w-0">
                                  <div className="font-semibold text-[13px] text-foreground truncate">{f.name}</div>
                                  <div className="text-[12px] text-muted-foreground max-w-[360px] mt-0.5 leading-relaxed line-clamp-2">
                                    {f.description}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-3.5 text-muted-foreground font-medium text-[13px]">
                              {(f.fields || []).length} fields
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-3.5 text-muted-foreground text-[13px]">
                              {f.category || "—"}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell py-3.5">
                              <div className="flex flex-col gap-1 items-start">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "px-2.5 py-0.5 text-[10px] font-semibold flex items-center gap-1.5",
                                    f.enabled
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                      : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20",
                                  )}
                                >
                                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", f.enabled ? "bg-emerald-500" : "bg-zinc-400")} />
                                  {f.enabled ? "Enabled" : "Disabled"}
                                </Badge>
                                {f.is_anonymous && (
                                  <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 flex items-center gap-1">
                                    <EyeOff className="h-2.5 w-2.5" /> Anon
                                  </Badge>
                                )}
                                {!f.has_embedding && (
                                  <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                    indexing…
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5 text-right">
                              <div className="flex items-center gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-8 w-8 rounded-lg transition-colors",
                                    f.enabled
                                      ? "text-emerald-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500"
                                      : "text-zinc-400 dark:text-zinc-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-600",
                                  )}
                                  onClick={() => toggleEnabled(f)}
                                  disabled={toggling.has(f.id)}
                                  title={f.enabled ? "Disable" : "Enable"}
                                >
                                  {toggling.has(f.id) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : f.enabled ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : (
                                    <XCircle className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                                  onClick={() => openEdit(f)}
                                  title="Edit"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setDeleteId(f.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {expandedFormId === f.id && (
                            <TableRow className="lg:hidden bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={6} className="p-4 border-b">
                                <div className="flex flex-col gap-4 text-[13px]">
                                  <div>
                                    <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Status</span>
                                    <div className="flex flex-wrap gap-2 items-center">
                                      <Badge variant="outline" className={cn("px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1.5", f.enabled ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-zinc-500/10 text-zinc-500 border-zinc-500/20")}>
                                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", f.enabled ? "bg-emerald-500" : "bg-zinc-400")} />
                                        {f.enabled ? "Enabled" : "Disabled"}
                                      </Badge>
                                      {f.is_anonymous && (
                                        <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold bg-violet-500/10 text-violet-600 border-violet-500/20 flex items-center gap-1">
                                          <EyeOff className="h-2.5 w-2.5" /> Anon
                                        </Badge>
                                      )}
                                      {!f.has_embedding && (
                                        <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-600 border-amber-500/20">
                                          indexing…
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Category</span>
                                    <span className="text-foreground">{f.category || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Fields</span>
                                    <span className="text-foreground">{(f.fields || []).length} fields</span>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          </Fragment>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Card>
                {filteredForms.length > 0 && (
                  <p className="text-[11px] text-muted-foreground px-1">
                    Showing {filteredForms.length} of {forms.length} form{forms.length !== 1 ? "s" : ""}
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="submissions" className="m-0 h-full flex flex-col gap-5 border-none p-0 outline-none">
            {subsLoading ? (
               <div className="space-y-4">
               <div className="grid grid-cols-4 gap-4">
                 {[1, 2, 3, 4].map((i) => (
                   <Card key={i} className="animate-pulse shadow-sm h-20" />
                 ))}
               </div>
               <Card className="animate-pulse shadow-sm h-[400px]" />
             </div>
            ) : submissions.length === 0 ? (
              <Card className="flex flex-col items-center justify-center py-20 text-center shadow-sm max-w-xl mx-auto border-dashed">
                <Send className="h-10 w-10 mb-3 text-[#94a3b8] dark:text-white/40" />
                <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                  No submissions yet.
                </h3>
                <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1">
                  Submissions from users filling out forms will appear here.
                </p>
              </Card>
            ) : (
              <>
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                        <Send className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {submissions.length}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">
                          Total Subs
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 shrink-0">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {pendingSubsCount}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">Pending</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {approvedSubsCount}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">Approved</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 shrink-0">
                        <XCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[22px] font-black text-[#0f172a] dark:text-white leading-none">
                          {rejectedSubsCount}
                        </p>
                        <p className="text-[11px] text-[#64748b] dark:text-white/50 mt-0.5">Rejected</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={subSearch}
                      onChange={(e) => setSubSearch(e.target.value)}
                      placeholder="Search by reference, form, or submitter email…"
                      className="pl-9 h-9 text-[13px]"
                    />
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                    {(["all", "Pending", "Approved", "Rejected"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setSubStatusFilter(f)}
                        className={cn(
                          "px-3 py-1 rounded-md text-[11px] font-semibold transition-colors",
                          subStatusFilter === f
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f === "all" ? `All (${submissions.length})` : f}
                      </button>
                    ))}
                  </div>
                  <ExportCsvButton
                    rows={filteredSubmissions.map((s) => ({
                      Reference: s.reference_id,
                      Form: s.form_name,
                      "Submitted By": s.is_anonymous ? "Anonymous" : (s.employee_email || ""),
                      When: s.submitted_at
                        ? new Date(s.submitted_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })
                        : "",
                      Status: s.status,
                    }))}
                    filename="form-submissions.csv"
                  />
                </div>

                <Card className="shadow-sm overflow-hidden border-border">
                  <Table paginate itemsPerPage={10}>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-12 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground"></TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Reference</TableHead>
                        <TableHead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Form</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Submitted By</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">When</TableHead>
                        <TableHead className="hidden lg:table-cell text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                        <TableHead className="text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSubmissions.length === 0 ? (
                         <TableRow>
                          <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <Search className="h-7 w-7 text-muted-foreground/30 mb-2" />
                              <p className="text-[13px] font-semibold">No submissions match your search</p>
                              <Button variant="link" onClick={() => { setSubSearch(""); setSubStatusFilter("all"); }} className="mt-1 h-auto py-0 text-[12px]">
                                Clear filters
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredSubmissions.map((s) => (
                          <Fragment key={s.id}>
                            <TableRow className="group">
                              <TableCell className="w-12 text-center py-3">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground group-hover:text-foreground"
                                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                                >
                                  {expanded === s.id ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="py-3 font-mono text-[12px] font-semibold">
                                {s.reference_id}
                              </TableCell>
                              <TableCell className="py-3 font-semibold text-[13px] w-full lg:w-auto">
                                {s.form_name}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell py-3 text-muted-foreground text-[13px]">
                                {s.is_anonymous ? (
                                  <span className="inline-flex items-center gap-1 text-violet-500 font-medium">
                                    <EyeOff className="h-3.5 w-3.5" /> Anonymous
                                  </span>
                                ) : (
                                  s.employee_email || "—"
                                )}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell py-3 text-muted-foreground text-[12px]">
                                {s.submitted_at
                                  ? new Date(s.submitted_at).toLocaleString("en-IN", {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })
                                  : "—"}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell py-3">
                                {statusBadge(s.status)}
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                {s.status === "Pending" && (
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] font-bold text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-700"
                                      onClick={() => review(s, "Approved")}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] font-bold text-rose-600 border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-700"
                                      onClick={() => review(s, "Rejected")}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                            {expanded === s.id && (
                              <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={7} className="p-0 border-b">
                                  <div className="p-4 sm:p-6 flex flex-col gap-5">
                                    <div className="lg:hidden grid grid-cols-2 gap-4 text-[13px] mb-2">
                                      <div>
                                        <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Status</span>
                                        {statusBadge(s.status)}
                                      </div>
                                      <div>
                                        <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Submitted By</span>
                                        {s.is_anonymous ? <span className="text-violet-500 font-medium"><EyeOff className="h-3 w-3 inline mr-1"/>Anon</span> : (s.employee_email || "—")}
                                      </div>
                                      <div className="col-span-2">
                                        <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">When</span>
                                        <span className="text-foreground">{s.submitted_at ? new Date(s.submitted_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                                      </div>
                                    </div>
                                    <Card className="max-w-3xl shadow-sm border-border bg-card">
                                      <CardHeader className="py-3 px-4 bg-muted/50 border-b border-border">
                                        <CardTitle className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                                          <span>Form Data Values</span>
                                          {s.reviewed_by && s.status !== "Pending" && (
                                            <span className="text-[10px] font-medium normal-case flex items-center gap-1">
                                              Reviewed by <span className="font-semibold text-foreground">{s.reviewed_by}</span>
                                            </span>
                                          )}
                                        </CardTitle>
                                      </CardHeader>
                                      <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                                        {Object.entries(s.field_values || {}).map(([k, v]) => (
                                          <div
                                            key={k}
                                            className="flex flex-col gap-1 border-b border-dashed border-border pb-2 last:border-0 last:pb-0"
                                          >
                                            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wide">
                                              {k.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-[13px] text-foreground font-medium break-words">
                                              {String(v) || "—"}
                                            </span>
                                          </div>
                                        ))}
                                      </CardContent>
                                    </Card>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Card>
                {filteredSubmissions.length > 0 && (
                  <p className="text-[11px] text-muted-foreground px-1">
                    Showing {filteredSubmissions.length} of {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
                  </p>
                )}
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>

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

          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3 mb-4">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-400">
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
                className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
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
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveField(idx, -1)}
                          className="h-6 w-6"
                          disabled={idx === 0}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveField(idx, 1)}
                          className="h-6 w-6"
                          disabled={idx === fields.length - 1}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeField(idx)}
                          className="h-6 w-6 hover:bg-rose-500/10 hover:text-rose-400"
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
              <Lightbulb className="h-4 w-4 text-violet-500" />
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
                    className="rounded-xl border border-border p-4"
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
                          <Button
                            key={s.keyword}
                            variant="outline"
                            size="sm"
                            onClick={() => addSuggestedKeyword(f.form_id, s.keyword)}
                            disabled={busy}
                            title={
                              s.samples.length ? `e.g. "${s.samples.join('"  •  "')}"` : undefined
                            }
                            className="h-7 text-[12px] font-medium text-violet-700 bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/20 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200 rounded-full px-3"
                          >
                            {s.keyword}
                            <span className="text-[10px] text-violet-500/70 ml-1">×{s.count}</span>
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin ml-1" />
                            ) : (
                              <Plus className="h-3.5 w-3.5 ml-1 opacity-60" />
                            )}
                          </Button>
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
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
