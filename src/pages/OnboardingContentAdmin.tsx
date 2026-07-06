import { useState, useEffect, useCallback, useRef, type ReactNode, type DragEvent } from "react";
import {
  Loader2,
  PlusCircle,
  Pencil,
  Trash2,
  Upload,
  Video,
  Link2,
  FileText,
  Download,
  CheckCircle2,
  FileX2,
  ListChecks,
  Link as LinkIcon,
  Bell,
  Zap,
  ArrowUpRight,
  MessageSquare,
  GripVertical,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Chapter {
  title: string;
  start: number;
}
interface InductionVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  chapters: Chapter[];
  uploaded_filename?: string | null;
  sort_order: number;
  is_active: boolean;
}

interface DocTemplate {
  doc_key: string;
  name: string;
  description: string;
  fields: string[];
  required: boolean;
  is_active: boolean;
  is_builtin: boolean;
  section_id: number | null;
  sort_order: number;
  has_template_file: boolean;
  template_filename: string | null;
}

// Mirrors backend `_placeholder_key` (onboarding_service.py) — the exact `{{ }}` token a
// Word/Excel template author must use for a given field label to mail-merge into it.
function placeholderHint(doc: DocTemplate): string {
  const tokens = doc.fields.map(
    (f) => `{{ ${f.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")} }}`,
  );
  tokens.push("{{ signature_image }}");
  return `Upload a .docx or .xlsx with these placeholders to mail-merge into it:\n${tokens.join(", ")}\n(Any other file type is just served as a static download.)`;
}

interface SectionDraft {
  doc_key?: string;
  name: string;
  description: string;
  fieldsText: string;
  required: boolean;
  is_active: boolean;
  is_builtin: boolean;
}

interface InductionDoc {
  id: string;
  title: string;
  description: string;
  url: string;
  uploaded_filename?: string | null;
  sort_order: number;
  is_active: boolean;
}

interface StepAdmin {
  step_key: string;
  title: string;
  description: string;
  category: string;
  kind: string; // manual | deeplink | documents | video
  cta_label: string;
  action_payload: { prompt?: string; route?: string };
  required: boolean;
  is_active: boolean;
  is_builtin: boolean;
  auto: boolean;
  sort_order: number;
}

interface StepDraft {
  step_key?: string;
  title: string;
  description: string;
  category: string;
  kind: string;
  cta_label: string;
  prompt: string;
  required: boolean;
  is_active: boolean;
  sort_order: number;
  is_builtin: boolean;
}

interface QuickLink {
  id: string;
  title: string;
  url: string;
  description: string;
  category: string;
  sort_order: number;
  is_active: boolean;
}

interface ReminderSettings {
  enabled: boolean;
  stall_days: number;
  remind_hire: boolean;
  remind_manager: boolean;
  remind_hr: boolean;
  hr_email: string;
}

interface Props {
  authHeaders: Record<string, string>;
}

const EMPTY: Partial<InductionVideo> = {
  title: "",
  description: "",
  url: "",
  chapters: [],
  sort_order: 0,
  is_active: true,
};

// ── Shared layout primitives ────────────────────────────────────────
// One card per content type with a consistent header band, so the three
// sections read as an aligned column even though their row actions differ.
function SectionCard({
  icon,
  iconGradient,
  title,
  count,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  iconGradient: string;
  title: string;
  count?: number;
  description: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-sm">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200/60 dark:border-white/[0.05] bg-white/50 dark:bg-zinc-950/20">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "h-8 w-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm bg-gradient-to-br",
                iconGradient,
              )}
            >
              {icon}
            </div>
            <h3 className="text-[14.5px] font-black text-foreground tracking-tight">{title}</h3>
            {count != null && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
            {description}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

interface DndProps {
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: (e: DragEvent) => void;
  dragging: boolean;
}

// A row with an optional drag handle, a fixed leading icon, flexible body, and a
// right-anchored action rail (divider makes the controls line up down the list).
function Row({
  icon,
  iconGradient,
  active,
  children,
  actions,
  dnd,
}: {
  icon: ReactNode;
  iconGradient: string;
  active: boolean;
  children: ReactNode;
  actions: ReactNode;
  dnd?: DndProps;
}) {
  return (
    <div
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors bg-white/70 dark:bg-zinc-900/50",
        active
          ? "border-slate-200/70 dark:border-white/[0.06]"
          : "border-dashed border-slate-300/70 dark:border-white/[0.08] opacity-60",
        dnd?.dragging && "ring-2 ring-violet-400/60 opacity-60",
      )}
    >
      {dnd && (
        <button
          draggable
          onDragStart={dnd.onDragStart}
          onDragEnd={dnd.onDragEnd}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          className="shrink-0 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div
        className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br",
          iconGradient,
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex items-center gap-1 shrink-0 pl-2.5 border-l border-slate-200/60 dark:border-white/[0.05]">
        {actions}
      </div>
    </div>
  );
}

// Consistent icon-button used across every row's action rail.
function IconBtn({
  onClick,
  title,
  disabled,
  tone = "violet",
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  tone?: "violet" | "sky" | "amber" | "red";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    violet: "hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30",
    sky: "hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/30",
    amber: "hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30",
    red: "hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30",
  };
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "p-2 rounded-lg text-muted-foreground transition-colors disabled:opacity-40",
        tones[tone],
      )}
    >
      {children}
    </button>
  );
}

// Small uppercase pill used for status/type tags on a row title.
function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded",
        tone,
      )}
    >
      {children}
    </span>
  );
}

// A label + hint on the left, a control on the right — used by the reminders settings card.
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-zinc-900/50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="text-[11.5px] text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function OnboardingContentAdmin({ authHeaders }: Props) {
  const [videos, setVideos] = useState<InductionVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<InductionVideo> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chaptersText, setChaptersText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Document templates ──────────────────────────────────────────
  const [docs, setDocs] = useState<DocTemplate[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const docFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/onboard/admin/doc-templates", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setDocs(await res.json());
    } catch {
      toast.error("Couldn't load document templates.");
    } finally {
      setDocsLoading(false);
    }
  }, [authHeaders]);

  const uploadDocTemplate = async (doc_key: string, file: File) => {
    setUploadingDoc(doc_key);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { "Content-Type": _ct, ...headers } = authHeaders;
      const res = await fetch(`/api/onboard/admin/doc-templates/${doc_key}/upload`, {
        method: "POST",
        headers,
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "upload failed");
      }
      toast.success("Template uploaded.");
      loadDocs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload the template.");
    } finally {
      setUploadingDoc(null);
    }
  };

  const deleteDocTemplate = async (doc: DocTemplate) => {
    if (!confirm(`Remove the uploaded template for "${doc.name}"? New hires will get the auto-generated form instead.`))
      return;
    try {
      const res = await fetch(`/api/onboard/admin/doc-templates/${doc.doc_key}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success("Template removed.");
      loadDocs();
    } catch {
      toast.error("Couldn't remove the template.");
    }
  };

  const downloadTemplate = async (doc: DocTemplate) => {
    try {
      const res = await fetch(`/api/onboard/documents/${doc.doc_key}/template`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.template_filename || `${doc.doc_key}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download the template.");
    }
  };

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // ── Document section add/edit ───────────────────────────────────
  const [section, setSection] = useState<SectionDraft | null>(null);
  const [savingSection, setSavingSection] = useState(false);

  const openNewSection = () =>
    setSection({ name: "", description: "", fieldsText: "", required: true, is_active: true, is_builtin: false });
  const openEditSection = (d: DocTemplate) =>
    setSection({
      doc_key: d.doc_key,
      name: d.name,
      description: d.description,
      fieldsText: (d.fields || []).join("\n"),
      required: d.required,
      is_active: d.is_active,
      is_builtin: d.is_builtin,
    });

  const saveSection = async () => {
    if (!section) return;
    if (!section.name.trim()) {
      toast.error("A document name is required.");
      return;
    }
    setSavingSection(true);
    const payload = {
      name: section.name.trim(),
      description: section.description || "",
      fields: section.fieldsText.split("\n").map((f) => f.trim()).filter(Boolean),
      required: section.required,
      is_active: section.is_active,
    };
    try {
      const res = await fetch(
        section.doc_key
          ? `/api/onboard/admin/doc-sections/${section.doc_key}`
          : "/api/onboard/admin/doc-sections",
        {
          method: section.doc_key ? "PUT" : "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error();
      toast.success(section.doc_key ? "Document updated." : "Document section added.");
      setSection(null);
      loadDocs();
    } catch {
      toast.error("Couldn't save the document section.");
    } finally {
      setSavingSection(false);
    }
  };

  const toggleDocActive = async (d: DocTemplate) => {
    try {
      const res = await fetch(`/api/onboard/admin/doc-sections/${d.doc_key}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !d.is_active }),
      });
      if (!res.ok) throw new Error();
      loadDocs();
    } catch {
      toast.error("Couldn't update the document.");
    }
  };

  const toggleDocRequired = async (d: DocTemplate) => {
    try {
      const res = await fetch(`/api/onboard/admin/doc-sections/${d.doc_key}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ required: !d.required }),
      });
      if (!res.ok) throw new Error();
      loadDocs();
    } catch {
      toast.error("Couldn't update the document.");
    }
  };

  const removeSection = async (d: DocTemplate) => {
    const msg = d.is_builtin
      ? `Hide "${d.name}" from new hires? (Built-in — you can re-enable it later.)`
      : `Delete the "${d.name}" document section? This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/onboard/admin/doc-sections/${d.doc_key}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success(d.is_builtin ? "Document hidden." : "Document section deleted.");
      loadDocs();
    } catch {
      toast.error("Couldn't remove the document.");
    }
  };

  // ── Induction documents ─────────────────────────────────────────
  const [indDocs, setIndDocs] = useState<InductionDoc[]>([]);
  const [indLoading, setIndLoading] = useState(true);
  const [indEditing, setIndEditing] = useState<Partial<InductionDoc> | null>(null);
  const [indSaving, setIndSaving] = useState(false);
  const [indUploading, setIndUploading] = useState(false);
  const indFileRef = useRef<HTMLInputElement>(null);

  const loadIndDocs = useCallback(async () => {
    setIndLoading(true);
    try {
      const res = await fetch("/api/onboard/admin/induction-docs", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setIndDocs(await res.json());
    } catch {
      toast.error("Couldn't load induction documents.");
    } finally {
      setIndLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadIndDocs();
  }, [loadIndDocs]);

  const saveIndDoc = async () => {
    if (!indEditing) return;
    if (!indEditing.title?.trim() || !indEditing.url?.trim()) {
      toast.error("Title and a document URL (or uploaded file) are required.");
      return;
    }
    setIndSaving(true);
    const payload = {
      title: indEditing.title.trim(),
      description: indEditing.description || "",
      url: indEditing.url.trim(),
      uploaded_filename: indEditing.uploaded_filename || null,
      sort_order: indEditing.sort_order ?? 0,
      is_active: indEditing.is_active ?? true,
    };
    try {
      const isEdit = !!indEditing.id;
      const res = await fetch(
        isEdit ? `/api/onboard/admin/induction-docs/${indEditing.id}` : "/api/onboard/admin/induction-docs",
        { method: isEdit ? "PUT" : "POST", headers: authHeaders, body: JSON.stringify(payload) },
      );
      if (!res.ok) throw new Error();
      toast.success(isEdit ? "Document updated." : "Document added.");
      setIndEditing(null);
      loadIndDocs();
    } catch {
      toast.error("Couldn't save the document.");
    } finally {
      setIndSaving(false);
    }
  };

  const removeIndDoc = async (d: InductionDoc) => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    try {
      const res = await fetch(`/api/onboard/admin/induction-docs/${d.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success("Document deleted.");
      loadIndDocs();
    } catch {
      toast.error("Couldn't delete the document.");
    }
  };

  const toggleIndActive = async (d: InductionDoc) => {
    try {
      const res = await fetch(`/api/onboard/admin/induction-docs/${d.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !d.is_active }),
      });
      if (!res.ok) throw new Error();
      loadIndDocs();
    } catch {
      toast.error("Couldn't update the document.");
    }
  };

  const onIndUpload = async (file: File) => {
    setIndUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { "Content-Type": _ct, ...headers } = authHeaders;
      const res = await fetch("/api/onboard/admin/induction-docs/upload", {
        method: "POST",
        headers,
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "upload failed");
      }
      const data = await res.json();
      setIndEditing((e) => ({
        ...(e || {}),
        url: data.url,
        uploaded_filename: data.uploaded_filename,
        title: e?.title || file.name.replace(/\.[^.]+$/, ""),
      }));
      toast.success("Uploaded. Now save to add it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload.");
    } finally {
      setIndUploading(false);
    }
  };

  // ── Journey steps ───────────────────────────────────────────────
  const [steps, setSteps] = useState<StepAdmin[]>([]);
  const [stepsLoading, setStepsLoading] = useState(true);
  const [stepDraft, setStepDraft] = useState<StepDraft | null>(null);
  const [savingStep, setSavingStep] = useState(false);

  const loadSteps = useCallback(async () => {
    setStepsLoading(true);
    try {
      const res = await fetch("/api/onboard/admin/steps", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setSteps(await res.json());
    } catch {
      toast.error("Couldn't load journey steps.");
    } finally {
      setStepsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadSteps();
  }, [loadSteps]);

  const openNewStep = () =>
    setStepDraft({
      title: "",
      description: "",
      category: "",
      kind: "manual",
      cta_label: "",
      prompt: "",
      required: true,
      is_active: true,
      sort_order: (steps[steps.length - 1]?.sort_order ?? 0) + 10,
      is_builtin: false,
    });
  const openEditStep = (s: StepAdmin) =>
    setStepDraft({
      step_key: s.step_key,
      title: s.title,
      description: s.description,
      category: s.category,
      kind: s.kind,
      cta_label: s.cta_label,
      prompt: s.action_payload?.prompt || "",
      required: s.required,
      is_active: s.is_active,
      sort_order: s.sort_order,
      is_builtin: s.is_builtin,
    });

  const saveStep = async () => {
    if (!stepDraft) return;
    if (!stepDraft.title.trim()) {
      toast.error("A step title is required.");
      return;
    }
    setSavingStep(true);
    const payload: Record<string, unknown> = {
      title: stepDraft.title.trim(),
      description: stepDraft.description || "",
      category: stepDraft.category.trim() || "General",
      cta_label: stepDraft.cta_label.trim(),
      required: stepDraft.required,
      is_active: stepDraft.is_active,
      sort_order: stepDraft.sort_order,
    };
    // kind is only settable on custom steps; the deeplink prompt applies to both.
    if (!stepDraft.is_builtin) payload.kind = stepDraft.kind;
    if (stepDraft.kind === "deeplink") payload.prompt = stepDraft.prompt.trim();
    try {
      const isEdit = !!stepDraft.step_key;
      const res = await fetch(
        isEdit ? `/api/onboard/admin/steps/${stepDraft.step_key}` : "/api/onboard/admin/steps",
        { method: isEdit ? "PUT" : "POST", headers: authHeaders, body: JSON.stringify(payload) },
      );
      if (!res.ok) throw new Error();
      toast.success(isEdit ? "Step updated." : "Journey step added.");
      setStepDraft(null);
      loadSteps();
    } catch {
      toast.error("Couldn't save the step.");
    } finally {
      setSavingStep(false);
    }
  };

  const patchStep = async (s: StepAdmin, data: Partial<Record<string, unknown>>) => {
    try {
      const res = await fetch(`/api/onboard/admin/steps/${s.step_key}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      loadSteps();
    } catch {
      toast.error("Couldn't update the step.");
    }
  };

  const removeStep = async (s: StepAdmin) => {
    const msg = s.is_builtin
      ? `Hide "${s.title}" from the journey? (Built-in — you can re-enable it later.)`
      : `Delete the "${s.title}" step? This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/onboard/admin/steps/${s.step_key}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success(s.is_builtin ? "Step hidden." : "Step deleted.");
      loadSteps();
    } catch {
      toast.error("Couldn't remove the step.");
    }
  };

  // ── Quick links ─────────────────────────────────────────────────
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linkDraft, setLinkDraft] = useState<Partial<QuickLink> | null>(null);
  const [savingLink, setSavingLink] = useState(false);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const res = await fetch("/api/onboard/admin/quick-links", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setLinks(await res.json());
    } catch {
      toast.error("Couldn't load quick links.");
    } finally {
      setLinksLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const saveLink = async () => {
    if (!linkDraft) return;
    if (!linkDraft.title?.trim() || !linkDraft.url?.trim()) {
      toast.error("Title and a URL are required.");
      return;
    }
    setSavingLink(true);
    const payload = {
      title: linkDraft.title.trim(),
      url: linkDraft.url.trim(),
      description: linkDraft.description || "",
      category: linkDraft.category || "",
      sort_order: linkDraft.sort_order ?? 0,
      is_active: linkDraft.is_active ?? true,
    };
    try {
      const isEdit = !!linkDraft.id;
      const res = await fetch(
        isEdit ? `/api/onboard/admin/quick-links/${linkDraft.id}` : "/api/onboard/admin/quick-links",
        { method: isEdit ? "PUT" : "POST", headers: authHeaders, body: JSON.stringify(payload) },
      );
      if (!res.ok) throw new Error();
      toast.success(isEdit ? "Quick link updated." : "Quick link added.");
      setLinkDraft(null);
      loadLinks();
    } catch {
      toast.error("Couldn't save the quick link.");
    } finally {
      setSavingLink(false);
    }
  };

  const toggleLinkActive = async (l: QuickLink) => {
    try {
      const res = await fetch(`/api/onboard/admin/quick-links/${l.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !l.is_active }),
      });
      if (!res.ok) throw new Error();
      loadLinks();
    } catch {
      toast.error("Couldn't update the quick link.");
    }
  };

  const removeLink = async (l: QuickLink) => {
    if (!confirm(`Delete "${l.title}"?`)) return;
    try {
      const res = await fetch(`/api/onboard/admin/quick-links/${l.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success("Quick link deleted.");
      loadLinks();
    } catch {
      toast.error("Couldn't delete the quick link.");
    }
  };

  // ── Reminder settings ───────────────────────────────────────────
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [remindersDirty, setRemindersDirty] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);

  const loadReminders = useCallback(async () => {
    try {
      const res = await fetch("/api/onboard/admin/reminder-settings", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setReminders(await res.json());
      setRemindersDirty(false);
    } catch {
      toast.error("Couldn't load reminder settings.");
    }
  }, [authHeaders]);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  const patchReminders = (data: Partial<ReminderSettings>) => {
    setReminders((r) => (r ? { ...r, ...data } : r));
    setRemindersDirty(true);
  };

  const saveReminders = async () => {
    if (!reminders) return;
    setSavingReminders(true);
    try {
      const res = await fetch("/api/onboard/admin/reminder-settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(reminders),
      });
      if (!res.ok) throw new Error();
      setReminders(await res.json());
      setRemindersDirty(false);
      toast.success("Reminder settings saved.");
    } catch {
      toast.error("Couldn't save reminder settings.");
    } finally {
      setSavingReminders(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/onboard/admin/videos", { headers: authHeaders });
      if (!res.ok) throw new Error();
      setVideos(await res.json());
    } catch {
      toast.error("Couldn't load induction videos.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing({ ...EMPTY, sort_order: videos.length });
    setChaptersText("");
  };
  const openEdit = (v: InductionVideo) => {
    setEditing({ ...v });
    setChaptersText(
      (v.chapters || []).map((c) => `${formatSeconds(c.start)} ${c.title}`).join("\n"),
    );
  };

  // Chapters are edited as friendly "M:SS Title" lines and parsed to {start, title}.
  const parseChapters = (text: string): Chapter[] => {
    const out: Chapter[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const m = t.match(/^(?:(\d+):)?(\d{1,2})\s+(.*)$/);
      if (m) {
        const mins = m[1] ? parseInt(m[1], 10) : 0;
        const secs = parseInt(m[2], 10);
        out.push({ start: mins * 60 + secs, title: m[3].trim() });
      } else {
        out.push({ start: 0, title: t });
      }
    }
    return out;
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title?.trim() || !editing.url?.trim()) {
      toast.error("Title and a video URL (or uploaded file) are required.");
      return;
    }
    setSaving(true);
    const payload = {
      title: editing.title.trim(),
      description: editing.description || "",
      url: editing.url.trim(),
      uploaded_filename: editing.uploaded_filename || null,
      chapters: parseChapters(chaptersText),
      sort_order: editing.sort_order ?? 0,
      is_active: editing.is_active ?? true,
    };
    try {
      const isEdit = !!editing.id;
      const res = await fetch(
        isEdit ? `/api/onboard/admin/videos/${editing.id}` : "/api/onboard/admin/videos",
        {
          method: isEdit ? "PUT" : "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error();
      toast.success(isEdit ? "Video updated." : "Video added.");
      setEditing(null);
      load();
    } catch {
      toast.error("Couldn't save the video.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: InductionVideo) => {
    if (!confirm(`Delete "${v.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/onboard/admin/videos/${v.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success("Video deleted.");
      load();
    } catch {
      toast.error("Couldn't delete the video.");
    }
  };

  const toggleActive = async (v: InductionVideo) => {
    try {
      const res = await fetch(`/api/onboard/admin/videos/${v.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !v.is_active }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Couldn't update the video.");
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Don't send Content-Type: the browser sets the multipart boundary.
      const { "Content-Type": _ct, ...headers } = authHeaders;
      const res = await fetch("/api/onboard/admin/videos/upload", {
        method: "POST",
        headers,
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "upload failed");
      }
      const data = await res.json();
      setEditing((e) => ({
        ...(e || EMPTY),
        url: data.url,
        uploaded_filename: data.uploaded_filename,
        title: e?.title || file.name.replace(/\.[^.]+$/, ""),
      }));
      toast.success("Video uploaded. Now save to add it to the catalog.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload the video.");
    } finally {
      setUploading(false);
    }
  };

  const [tab, setTab] = useState<
    "steps" | "videos" | "documents" | "reference" | "links" | "reminders"
  >("steps");

  // ── Drag-to-reorder (native HTML5 DnD; no dependency) ───────────
  const dragFrom = useRef<number | null>(null);
  const [dragKind, setDragKind] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const persistOrder = useCallback(
    async (url: string, keys: (string | number)[], reload: () => void) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ order: keys }),
        });
        if (!res.ok) throw new Error();
        reload();
      } catch {
        toast.error("Couldn't save the new order.");
        reload();
      }
    },
    [authHeaders],
  );

  // Returns per-row drag handlers. `commit` receives the reordered key list.
  function makeDnd<T>(
    kind: string,
    list: T[],
    setList: (v: T[]) => void,
    keyOf: (t: T) => string | number,
    commit: (keys: (string | number)[]) => void,
  ) {
    return (index: number): DndProps => ({
      dragging: dragKind === kind && dragIdx === index,
      onDragStart: (e) => {
        dragFrom.current = index;
        setDragKind(kind);
        setDragIdx(index);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e) => {
        if (dragKind !== kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragFrom.current;
        dragFrom.current = null;
        setDragKind(null);
        setDragIdx(null);
        if (from === null || from === index || dragKind !== kind) return;
        const next = list.slice();
        const [moved] = next.splice(from, 1);
        next.splice(index, 0, moved);
        setList(next);
        commit(next.map(keyOf));
      },
      onDragEnd: () => {
        dragFrom.current = null;
        setDragKind(null);
        setDragIdx(null);
      },
    });
  }

  const stepDnd = makeDnd("steps", steps, setSteps, (s) => s.step_key, (keys) =>
    persistOrder("/api/onboard/admin/steps/reorder", keys, loadSteps),
  );
  const videoDnd = makeDnd("videos", videos, setVideos, (v) => v.id, (keys) =>
    persistOrder("/api/onboard/admin/videos/reorder", keys, load),
  );
  const docDnd = makeDnd("documents", docs, setDocs, (d) => d.doc_key, (keys) =>
    persistOrder("/api/onboard/admin/doc-sections/reorder", keys, loadDocs),
  );
  const indDocDnd = makeDnd("reference", indDocs, setIndDocs, (d) => d.id, (keys) =>
    persistOrder("/api/onboard/admin/induction-docs/reorder", keys, loadIndDocs),
  );
  const linkDnd = makeDnd("links", links, setLinks, (l) => l.id, (keys) =>
    persistOrder("/api/onboard/admin/quick-links/reorder", keys, loadLinks),
  );

  const TABS = [
    { key: "steps", label: "Journey Steps", icon: ListChecks, count: steps.length },
    { key: "videos", label: "Videos", icon: Video, count: videos.length },
    { key: "documents", label: "Documents", icon: FileText, count: docs.length },
    { key: "reference", label: "Reference Docs", icon: FileText, count: indDocs.length },
    { key: "links", label: "Quick Links", icon: LinkIcon, count: links.length },
    { key: "reminders", label: "Reminders", icon: Bell },
  ] as const;

  return (
    <div className="flex-1 overflow-auto px-6 sm:px-8 py-6">
      <div className="max-w-4xl mx-auto">
        {/* Section navigation — each content type is its own tab, not one long scroll. */}
        <nav className="flex flex-wrap items-center gap-1.5 mb-5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const activeTab = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all border",
                  activeTab
                    ? "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-600/30"
                    : "bg-white/60 dark:bg-zinc-900/50 text-muted-foreground hover:text-foreground border-slate-200/70 dark:border-white/[0.06]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {"count" in t && t.count != null && (
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 rounded-full tabular-nums",
                      activeTab ? "bg-white/20" : "bg-slate-200/70 dark:bg-zinc-800",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {tab === "steps" && (
        <>
        {/* ── Journey steps ── */}
        <SectionCard
          icon={<ListChecks className="h-4 w-4 text-white" />}
          iconGradient="from-fuchsia-500 to-purple-600"
          title="Journey Steps"
          count={steps.length}
          description="The ordered steps every new hire walks. Add your own cards, retitle or reorder built-ins, toggle required, or hide any step. Custom steps are a simple “Mark done” card or a link that opens the assistant / a page."
          action={
            <Button onClick={openNewStep} size="sm" className="gap-1.5">
              <PlusCircle className="h-4 w-4" /> Add step
            </Button>
          }
        >
          {stepsLoading ? (
            <LoadingRow tone="violet" label="Loading journey…" />
          ) : (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <Row
                  key={s.step_key}
                  dnd={stepDnd(i)}
                  active={s.is_active}
                  icon={<span className="text-[12px] font-black text-white tabular-nums">{i + 1}</span>}
                  iconGradient="from-fuchsia-500 to-purple-600"
                  actions={
                    <>
                      <Switch
                        checked={s.is_active}
                        onCheckedChange={() => patchStep(s, { is_active: !s.is_active })}
                        aria-label="Active"
                        className="mr-0.5"
                      />
                      <IconBtn onClick={() => openEditStep(s)} title="Edit step" tone="violet">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn
                        onClick={() => removeStep(s)}
                        title={s.is_builtin ? "Hide step" : "Delete step"}
                        tone="red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  }
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-bold text-foreground truncate">{s.title}</span>
                    {s.category && (
                      <Pill tone="bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400">
                        {s.category}
                      </Pill>
                    )}
                    {s.auto ? (
                      <Pill tone="bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                        <Zap className="h-2.5 w-2.5" /> AUTO
                      </Pill>
                    ) : s.kind === "deeplink" ? (
                      <Pill tone="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                        <MessageSquare className="h-2.5 w-2.5" /> LINK
                      </Pill>
                    ) : null}
                    <button
                      onClick={() => patchStep(s, { required: !s.required })}
                      title="Toggle required"
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors",
                        s.required
                          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                          : "bg-slate-100 dark:bg-zinc-800 text-slate-400",
                      )}
                    >
                      {s.required ? "REQUIRED" : "OPTIONAL"}
                    </button>
                    <Pill
                      tone={
                        s.is_builtin
                          ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                          : "bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
                      }
                    >
                      {s.is_builtin ? "BUILT-IN" : "CUSTOM"}
                    </Pill>
                    {!s.is_active && (
                      <Pill tone="bg-slate-200 dark:bg-zinc-800 text-slate-500">HIDDEN</Pill>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {s.description || "No description"}
                  </p>
                </Row>
              ))}
            </div>
          )}
        </SectionCard>
        </>
        )}

        {/* ── Induction videos ── */}
        {tab === "videos" && (
        <SectionCard
          icon={<Video className="h-4 w-4 text-white" />}
          iconGradient="from-violet-500 to-indigo-600"
          title="Induction Videos"
          count={videos.length}
          description="Orientation videos new hires watch. Paste an external link (SharePoint / Stream / YouTube / MP4) or upload a file."
          action={
            <Button onClick={openNew} size="sm" className="gap-1.5">
              <PlusCircle className="h-4 w-4" /> Add video
            </Button>
          }
        >
          {loading ? (
            <LoadingRow tone="violet" label="Loading videos…" />
          ) : videos.length === 0 ? (
            <EmptyRow
              icon={<Video className="h-6 w-6 text-violet-400 opacity-70" />}
              label="No induction videos yet."
              action={
                <Button onClick={openNew} variant="outline" size="sm" className="gap-1.5">
                  <PlusCircle className="h-4 w-4" /> Add your first video
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {videos.map((v, i) => (
                <Row
                  key={v.id}
                  dnd={videoDnd(i)}
                  active={v.is_active}
                  icon={<Video className="h-4 w-4 text-white" />}
                  iconGradient="from-violet-500 to-indigo-600"
                  actions={
                    <>
                      <Switch
                        checked={v.is_active}
                        onCheckedChange={() => toggleActive(v)}
                        aria-label="Active"
                        className="mr-0.5"
                      />
                      <IconBtn onClick={() => openEdit(v)} title="Edit" tone="violet">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn onClick={() => remove(v)} title="Delete" tone="red">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold text-foreground truncate">
                      {v.title}
                    </span>
                    {v.uploaded_filename ? (
                      <Pill tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                        <Upload className="h-2.5 w-2.5" /> UPLOADED
                      </Pill>
                    ) : (
                      <Pill tone="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                        <Link2 className="h-2.5 w-2.5" /> LINK
                      </Pill>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {v.description || v.url}
                    {v.chapters?.length > 0 && (
                      <span className="text-muted-foreground/70">
                        {" · "}
                        {v.chapters.length} chapter{v.chapters.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </Row>
              ))}
            </div>
          )}
        </SectionCard>
        )}

        {/* ── Documents ── */}
        {tab === "documents" && (
        <SectionCard
          icon={<FileText className="h-4 w-4 text-white" />}
          iconGradient="from-sky-500 to-blue-600"
          title="Documents"
          count={docs.length}
          description={
            <>
              The joining-document checklist. Add sections, set fields &amp; mandatory, hide any
              doc, and upload a blank template. Drop a real .docx/.xlsx with{" "}
              <code className="text-[11px] bg-slate-100 dark:bg-zinc-800 px-1 rounded">
                {"{{ field }}"}
              </code>{" "}
              placeholders (hover Upload for the exact tokens) to mail-merge new-hire answers
              straight into it — any other file type is just a static download.
            </>
          }
          action={
            <Button onClick={openNewSection} size="sm" className="gap-1.5">
              <PlusCircle className="h-4 w-4" /> Add section
            </Button>
          }
        >
          {docsLoading ? (
            <LoadingRow tone="sky" label="Loading templates…" />
          ) : (
            <div className="space-y-2">
              {docs.map((doc, i) => (
                <Row
                  key={doc.doc_key}
                  dnd={docDnd(i)}
                  active={doc.is_active}
                  icon={<FileText className="h-4 w-4 text-white" />}
                  iconGradient="from-sky-500 to-blue-600"
                  actions={
                    <>
                      <Switch
                        checked={doc.is_active}
                        onCheckedChange={() => toggleDocActive(doc)}
                        aria-label="Active"
                        className="mr-0.5"
                      />
                      <IconBtn
                        onClick={() => openEditSection(doc)}
                        title="Edit name, fields, mandatory"
                        tone="violet"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      {doc.has_template_file && (
                        <IconBtn
                          onClick={() => downloadTemplate(doc)}
                          title="Download current template"
                          tone="sky"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      <button
                        onClick={() => docFileRefs.current[doc.doc_key]?.click()}
                        disabled={uploadingDoc === doc.doc_key}
                        title={placeholderHint(doc)}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[11.5px] font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 transition-colors"
                      >
                        {uploadingDoc === doc.doc_key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {doc.has_template_file ? "Replace" : "Upload"}
                      </button>
                      {doc.has_template_file && (
                        <IconBtn
                          onClick={() => deleteDocTemplate(doc)}
                          title="Remove template file (revert to auto form)"
                          tone="amber"
                        >
                          <FileX2 className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      <IconBtn
                        onClick={() => removeSection(doc)}
                        title={doc.is_builtin ? "Hide document" : "Delete document section"}
                        tone="red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  }
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-bold text-foreground truncate">
                      {doc.name}
                    </span>
                    <button
                      onClick={() => toggleDocRequired(doc)}
                      title="Toggle mandatory"
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors",
                        doc.required
                          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                          : "bg-slate-100 dark:bg-zinc-800 text-slate-400",
                      )}
                    >
                      {doc.required ? "MANDATORY" : "OPTIONAL"}
                    </button>
                    <Pill
                      tone={
                        doc.is_builtin
                          ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                          : "bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
                      }
                    >
                      {doc.is_builtin ? "BUILT-IN" : "CUSTOM"}
                    </Pill>
                    {doc.has_template_file ? (
                      <Pill tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-2.5 w-2.5" /> TEMPLATE
                      </Pill>
                    ) : (
                      <Pill tone="bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400">
                        AUTO FORM
                      </Pill>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {doc.template_filename ||
                      doc.description ||
                      (doc.fields.length
                        ? `${doc.fields.length} field${doc.fields.length === 1 ? "" : "s"}`
                        : "No fillable fields")}
                  </p>
                  <input
                    ref={(el) => {
                      docFileRefs.current[doc.doc_key] = el;
                    }}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadDocTemplate(doc.doc_key, f);
                      e.target.value = "";
                    }}
                  />
                </Row>
              ))}
            </div>
          )}
        </SectionCard>
        )}

        {/* ── Induction documents ── */}
        {tab === "reference" && (
        <SectionCard
          icon={<FileText className="h-4 w-4 text-white" />}
          iconGradient="from-indigo-500 to-violet-600"
          title="Induction Documents"
          count={indDocs.length}
          description="Reference material (handbooks, slides, policy packs) new hires can view alongside the induction videos. Add a link or upload a file."
          action={
            <Button
              onClick={() =>
                setIndEditing({ title: "", description: "", url: "", sort_order: indDocs.length, is_active: true })
              }
              size="sm"
              className="gap-1.5"
            >
              <PlusCircle className="h-4 w-4" /> Add document
            </Button>
          }
        >
          {indLoading ? (
            <LoadingRow tone="indigo" label="Loading documents…" />
          ) : indDocs.length === 0 ? (
            <EmptyRow
              icon={<FileText className="h-6 w-6 text-indigo-400 opacity-70" />}
              label="No induction documents yet."
            />
          ) : (
            <div className="space-y-2">
              {indDocs.map((d, i) => (
                <Row
                  key={d.id}
                  dnd={indDocDnd(i)}
                  active={d.is_active}
                  icon={<FileText className="h-4 w-4 text-white" />}
                  iconGradient="from-indigo-500 to-violet-600"
                  actions={
                    <>
                      <Switch
                        checked={d.is_active}
                        onCheckedChange={() => toggleIndActive(d)}
                        aria-label="Active"
                        className="mr-0.5"
                      />
                      <IconBtn onClick={() => setIndEditing({ ...d })} title="Edit" tone="violet">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn onClick={() => removeIndDoc(d)} title="Delete" tone="red">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold text-foreground truncate">{d.title}</span>
                    {d.uploaded_filename ? (
                      <Pill tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                        <Upload className="h-2.5 w-2.5" /> UPLOADED
                      </Pill>
                    ) : (
                      <Pill tone="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                        <Link2 className="h-2.5 w-2.5" /> LINK
                      </Pill>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {d.description || d.url}
                  </p>
                </Row>
              ))}
            </div>
          )}
        </SectionCard>
        )}

        {/* ── Day-1 quick links ── */}
        {tab === "links" && (
        <SectionCard
          icon={<LinkIcon className="h-4 w-4 text-white" />}
          iconGradient="from-teal-500 to-emerald-600"
          title="Day-1 Quick Links"
          count={links.length}
          description="A short list of the apps and portals a new joiner needs early — HRMS, IT service desk, learning portal, org directory. Shown as clickable tiles in their onboarding journey."
          action={
            <Button
              onClick={() =>
                setLinkDraft({
                  title: "",
                  url: "",
                  description: "",
                  category: "",
                  sort_order: (links[links.length - 1]?.sort_order ?? 0) + 10,
                  is_active: true,
                })
              }
              size="sm"
              className="gap-1.5"
            >
              <PlusCircle className="h-4 w-4" /> Add link
            </Button>
          }
        >
          {linksLoading ? (
            <LoadingRow tone="sky" label="Loading links…" />
          ) : links.length === 0 ? (
            <EmptyRow
              icon={<LinkIcon className="h-6 w-6 text-teal-400 opacity-70" />}
              label="No quick links yet."
            />
          ) : (
            <div className="space-y-2">
              {links.map((l, i) => (
                <Row
                  key={l.id}
                  dnd={linkDnd(i)}
                  active={l.is_active}
                  icon={<LinkIcon className="h-4 w-4 text-white" />}
                  iconGradient="from-teal-500 to-emerald-600"
                  actions={
                    <>
                      <Switch
                        checked={l.is_active}
                        onCheckedChange={() => toggleLinkActive(l)}
                        aria-label="Active"
                        className="mr-0.5"
                      />
                      <IconBtn
                        onClick={() => window.open(l.url, "_blank", "noopener")}
                        title="Open link"
                        tone="sky"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn onClick={() => setLinkDraft({ ...l })} title="Edit" tone="violet">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn onClick={() => removeLink(l)} title="Delete" tone="red">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold text-foreground truncate">{l.title}</span>
                    {l.category && (
                      <Pill tone="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">
                        {l.category}
                      </Pill>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {l.description || l.url}
                  </p>
                </Row>
              ))}
            </div>
          )}
        </SectionCard>
        )}

        {/* ── Stalled-joiner reminders ── */}
        {tab === "reminders" && (
        <SectionCard
          icon={<Bell className="h-4 w-4 text-white" />}
          iconGradient="from-amber-500 to-orange-600"
          title="Stalled-Joiner Reminders"
          description="When a hire's journey goes quiet, the assistant can nudge them, their manager, and/or HR to follow up. Tuned here — no redeploy needed. Reminders re-arm at most once per recipient per week while a journey stays stalled."
          action={
            <Button
              onClick={saveReminders}
              size="sm"
              disabled={!remindersDirty || savingReminders || !reminders}
              className="gap-1.5"
            >
              {savingReminders && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          }
        >
          {!reminders ? (
            <LoadingRow tone="violet" label="Loading settings…" />
          ) : (
            <div className="space-y-3">
              <SettingRow
                label="Reminders enabled"
                hint="Master switch for the stalled-journey follow-ups."
              >
                <Switch
                  checked={reminders.enabled}
                  onCheckedChange={(c) => patchReminders({ enabled: c })}
                />
              </SettingRow>
              <SettingRow
                label="Consider a journey stalled after"
                hint="Days of no activity before a reminder fires. Also drives the tracker's Stalled count."
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    className="w-20"
                    value={reminders.stall_days}
                    disabled={!reminders.enabled}
                    onChange={(e) =>
                      patchReminders({ stall_days: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                  />
                  <span className="text-[12px] text-muted-foreground">days</span>
                </div>
              </SettingRow>
              <SettingRow label="Remind the new hire" hint="Nudge the joiner to pick their journey back up.">
                <Switch
                  checked={reminders.remind_hire}
                  disabled={!reminders.enabled}
                  onCheckedChange={(c) => patchReminders({ remind_hire: c })}
                />
              </SettingRow>
              <SettingRow label="Remind their manager" hint="Nudge the hire's manager to check in.">
                <Switch
                  checked={reminders.remind_manager}
                  disabled={!reminders.enabled}
                  onCheckedChange={(c) => patchReminders({ remind_manager: c })}
                />
              </SettingRow>
              <SettingRow label="Remind HR" hint="Also send a follow-up to the HR mailbox below.">
                <Switch
                  checked={reminders.remind_hr}
                  disabled={!reminders.enabled}
                  onCheckedChange={(c) => patchReminders({ remind_hr: c })}
                />
              </SettingRow>
              {reminders.remind_hr && (
                <SettingRow label="HR email" hint="Where the HR follow-up nudge is addressed.">
                  <Input
                    type="email"
                    className="w-64"
                    placeholder="hr@company.com"
                    value={reminders.hr_email}
                    disabled={!reminders.enabled}
                    onChange={(e) => patchReminders({ hr_email: e.target.value })}
                  />
                </SettingRow>
              )}
            </div>
          )}
        </SectionCard>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit induction video" : "Add induction video"}</DialogTitle>
            <DialogDescription>
              New hires see active videos in their onboarding journey, in display order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1 max-h-[60vh] overflow-auto pr-1">
            <div>
              <Label htmlFor="v-title">Title</Label>
              <Input
                id="v-title"
                value={editing?.title || ""}
                onChange={(e) => setEditing((s) => ({ ...s!, title: e.target.value }))}
                placeholder="Welcome to the team"
              />
            </div>
            <div>
              <Label htmlFor="v-desc">Description</Label>
              <Textarea
                id="v-desc"
                rows={2}
                value={editing?.description || ""}
                onChange={(e) => setEditing((s) => ({ ...s!, description: e.target.value }))}
                placeholder="Company-wide welcome and orientation for all new joiners."
              />
            </div>
            <div>
              <Label htmlFor="v-url">Video URL</Label>
              <div className="flex gap-2">
                <Input
                  id="v-url"
                  value={editing?.url || ""}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s!, url: e.target.value, uploaded_filename: null }))
                  }
                  placeholder="https://… or upload a file →"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="gap-1.5 shrink-0"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Upload
                </Button>
              </div>
              {editing?.uploaded_filename && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <Upload className="h-3 w-3" /> {editing.uploaded_filename}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="v-chapters">Chapters (optional)</Label>
              <Textarea
                id="v-chapters"
                rows={4}
                value={chaptersText}
                onChange={(e) => setChaptersText(e.target.value)}
                placeholder={"0:00 Welcome\n0:45 Who we are\n2:00 How we work"}
                className="font-mono text-[12px]"
              />
              <p className="text-[10.5px] text-muted-foreground mt-1">
                One per line as <code>M:SS Title</code> — drives the chaptered player.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Label htmlFor="v-active" className="mb-0">
                Active
              </Label>
              <Switch
                id="v-active"
                checked={editing?.is_active ?? true}
                onCheckedChange={(c) => setEditing((s) => ({ ...s!, is_active: c }))}
              />
              <span className="text-[11px] text-muted-foreground ml-2">
                Order is set by dragging rows in the list.
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing?.id ? "Save changes" : "Add video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document section add / edit dialog */}
      <Dialog open={!!section} onOpenChange={(o) => !o && setSection(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {section?.doc_key ? `Edit "${section?.name}"` : "Add document section"}
            </DialogTitle>
            <DialogDescription>
              {section?.is_builtin
                ? "Built-in document — your changes override the default (name, fields, mandatory)."
                : "New hires will see this in their joining-documents checklist."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1 max-h-[60vh] overflow-auto pr-1">
            <div>
              <Label htmlFor="s-name">Document name</Label>
              <Input
                id="s-name"
                value={section?.name || ""}
                onChange={(e) => setSection((s) => ({ ...s!, name: e.target.value }))}
                placeholder="e.g. Provident Fund Nomination"
              />
            </div>
            <div>
              <Label htmlFor="s-desc">Description</Label>
              <Textarea
                id="s-desc"
                rows={2}
                value={section?.description || ""}
                onChange={(e) => setSection((s) => ({ ...s!, description: e.target.value }))}
                placeholder="Short instruction shown to the new hire."
              />
            </div>
            <div>
              <Label htmlFor="s-fields">Fields to fill (optional)</Label>
              <Textarea
                id="s-fields"
                rows={4}
                value={section?.fieldsText || ""}
                onChange={(e) => setSection((s) => ({ ...s!, fieldsText: e.target.value }))}
                placeholder={"Full Name\nPF Account Number\nNominee Name"}
                className="font-mono text-[12px]"
              />
              <p className="text-[10.5px] text-muted-foreground mt-1">
                One field per line. These drive the in-app "Fill in app" form. Leave empty for an
                upload-only document.
              </p>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="s-req" className="mb-0">
                  Mandatory
                </Label>
                <Switch
                  id="s-req"
                  checked={section?.required ?? true}
                  onCheckedChange={(c) => setSection((s) => ({ ...s!, required: c }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="s-active" className="mb-0">
                  Active
                </Label>
                <Switch
                  id="s-active"
                  checked={section?.is_active ?? true}
                  onCheckedChange={(c) => setSection((s) => ({ ...s!, is_active: c }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSection(null)} disabled={savingSection}>
              Cancel
            </Button>
            <Button onClick={saveSection} disabled={savingSection} className="gap-1.5">
              {savingSection && <Loader2 className="h-4 w-4 animate-spin" />}
              {section?.doc_key ? "Save changes" : "Add section"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Induction document add / edit dialog */}
      <Dialog open={!!indEditing} onOpenChange={(o) => !o && setIndEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{indEditing?.id ? "Edit document" : "Add induction document"}</DialogTitle>
            <DialogDescription>Shown to new hires alongside the induction videos.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            <div>
              <Label htmlFor="id-title">Title</Label>
              <Input
                id="id-title"
                value={indEditing?.title || ""}
                onChange={(e) => setIndEditing((s) => ({ ...s!, title: e.target.value }))}
                placeholder="Employee Handbook"
              />
            </div>
            <div>
              <Label htmlFor="id-desc">Description</Label>
              <Textarea
                id="id-desc"
                rows={2}
                value={indEditing?.description || ""}
                onChange={(e) => setIndEditing((s) => ({ ...s!, description: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="id-url">Document URL</Label>
              <div className="flex gap-2">
                <Input
                  id="id-url"
                  value={indEditing?.url || ""}
                  onChange={(e) =>
                    setIndEditing((s) => ({ ...s!, url: e.target.value, uploaded_filename: null }))
                  }
                  placeholder="https://… or upload a file →"
                />
                <input
                  ref={indFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onIndUpload(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => indFileRef.current?.click()}
                  disabled={indUploading}
                  className="gap-1.5 shrink-0"
                >
                  {indUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload
                </Button>
              </div>
              {indEditing?.uploaded_filename && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <Upload className="h-3 w-3" /> {indEditing.uploaded_filename}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Label htmlFor="id-active" className="mb-0">
                Active
              </Label>
              <Switch
                id="id-active"
                checked={indEditing?.is_active ?? true}
                onCheckedChange={(c) => setIndEditing((s) => ({ ...s!, is_active: c }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIndEditing(null)} disabled={indSaving}>
              Cancel
            </Button>
            <Button onClick={saveIndDoc} disabled={indSaving} className="gap-1.5">
              {indSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {indEditing?.id ? "Save changes" : "Add document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Journey step add / edit dialog */}
      <Dialog open={!!stepDraft} onOpenChange={(o) => !o && setStepDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {stepDraft?.step_key ? `Edit "${stepDraft?.title}"` : "Add journey step"}
            </DialogTitle>
            <DialogDescription>
              {stepDraft?.is_builtin
                ? "Built-in step — your changes override the default (title, order, CTA, required)."
                : "New hires see active steps in their onboarding journey, in order."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1 max-h-[60vh] overflow-auto pr-1">
            <div>
              <Label htmlFor="st-title">Title</Label>
              <Input
                id="st-title"
                value={stepDraft?.title || ""}
                onChange={(e) => setStepDraft((s) => ({ ...s!, title: e.target.value }))}
                placeholder="e.g. Set up your workspace"
              />
            </div>
            <div>
              <Label htmlFor="st-desc">Description</Label>
              <Textarea
                id="st-desc"
                rows={2}
                value={stepDraft?.description || ""}
                onChange={(e) => setStepDraft((s) => ({ ...s!, description: e.target.value }))}
                placeholder="What the new hire should do in this step."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="st-cat">Category</Label>
                <Input
                  id="st-cat"
                  value={stepDraft?.category || ""}
                  onChange={(e) => setStepDraft((s) => ({ ...s!, category: e.target.value }))}
                  placeholder="Get set up"
                />
              </div>
              <div>
                <Label htmlFor="st-cta">Button label</Label>
                <Input
                  id="st-cta"
                  value={stepDraft?.cta_label || ""}
                  onChange={(e) => setStepDraft((s) => ({ ...s!, cta_label: e.target.value }))}
                  placeholder={stepDraft?.kind === "deeplink" ? "Open" : "Mark done"}
                />
              </div>
            </div>
            {/* Kind is fixed for built-ins (their sub-flow can't be retargeted); editable for custom steps. */}
            {!stepDraft?.is_builtin && (
              <div>
                <Label>Step type</Label>
                <Select
                  value={stepDraft?.kind || "manual"}
                  onValueChange={(v) => setStepDraft((s) => ({ ...s!, kind: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual — a “Mark done” card</SelectItem>
                    <SelectItem value="deeplink">Link — opens the assistant with a prompt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {stepDraft?.kind === "deeplink" && (
              <div>
                <Label htmlFor="st-prompt">Assistant prompt</Label>
                <Textarea
                  id="st-prompt"
                  rows={2}
                  value={stepDraft?.prompt || ""}
                  onChange={(e) => setStepDraft((s) => ({ ...s!, prompt: e.target.value }))}
                  placeholder="What the assistant should be asked when the hire taps the button."
                />
                <p className="text-[10.5px] text-muted-foreground mt-1">
                  Tapping the button drops this into the chat for the new hire.
                </p>
              </div>
            )}
            <div className="flex items-center gap-6 pt-1 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="st-req" className="mb-0">
                  Required
                </Label>
                <Switch
                  id="st-req"
                  checked={stepDraft?.required ?? true}
                  onCheckedChange={(c) => setStepDraft((s) => ({ ...s!, required: c }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="st-active" className="mb-0">
                  Active
                </Label>
                <Switch
                  id="st-active"
                  checked={stepDraft?.is_active ?? true}
                  onCheckedChange={(c) => setStepDraft((s) => ({ ...s!, is_active: c }))}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">
                Drag rows in the list to set the order.
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStepDraft(null)} disabled={savingStep}>
              Cancel
            </Button>
            <Button onClick={saveStep} disabled={savingStep} className="gap-1.5">
              {savingStep && <Loader2 className="h-4 w-4 animate-spin" />}
              {stepDraft?.step_key ? "Save changes" : "Add step"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick link add / edit dialog */}
      <Dialog open={!!linkDraft} onOpenChange={(o) => !o && setLinkDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{linkDraft?.id ? "Edit quick link" : "Add quick link"}</DialogTitle>
            <DialogDescription>Shown as a Day-1 tile in the new hire's journey.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-1">
            <div>
              <Label htmlFor="ql-title">Title</Label>
              <Input
                id="ql-title"
                value={linkDraft?.title || ""}
                onChange={(e) => setLinkDraft((s) => ({ ...s!, title: e.target.value }))}
                placeholder="HR Self-Service (Zoho People)"
              />
            </div>
            <div>
              <Label htmlFor="ql-url">URL</Label>
              <Input
                id="ql-url"
                value={linkDraft?.url || ""}
                onChange={(e) => setLinkDraft((s) => ({ ...s!, url: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div>
              <Label htmlFor="ql-cat">Category</Label>
              <Input
                id="ql-cat"
                value={linkDraft?.category || ""}
                onChange={(e) => setLinkDraft((s) => ({ ...s!, category: e.target.value }))}
                placeholder="Tools / HR / Learning"
              />
            </div>
            <div>
              <Label htmlFor="ql-desc">Description</Label>
              <Textarea
                id="ql-desc"
                rows={2}
                value={linkDraft?.description || ""}
                onChange={(e) => setLinkDraft((s) => ({ ...s!, description: e.target.value }))}
                placeholder="One line on what this is for."
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Label htmlFor="ql-active" className="mb-0">
                Active
              </Label>
              <Switch
                id="ql-active"
                checked={linkDraft?.is_active ?? true}
                onCheckedChange={(c) => setLinkDraft((s) => ({ ...s!, is_active: c }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDraft(null)} disabled={savingLink}>
              Cancel
            </Button>
            <Button onClick={saveLink} disabled={savingLink} className="gap-1.5">
              {savingLink && <Loader2 className="h-4 w-4 animate-spin" />}
              {linkDraft?.id ? "Save changes" : "Add link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingRow({ tone, label }: { tone: string; label: string }) {
  const spin: Record<string, string> = {
    violet: "text-violet-500",
    sky: "text-sky-500",
    indigo: "text-indigo-500",
  };
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
      <Loader2 className={cn("h-5 w-5 animate-spin", spin[tone])} />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

function EmptyRow({
  icon,
  label,
  action,
}: {
  icon: ReactNode;
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3 rounded-xl border border-dashed border-slate-200 dark:border-white/[0.08]">
      <div className="h-12 w-12 rounded-2xl bg-slate-500/5 flex items-center justify-center">
        {icon}
      </div>
      <p className="text-[13px] font-medium">{label}</p>
      {action}
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
