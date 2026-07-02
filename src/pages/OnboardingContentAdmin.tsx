import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  PlusCircle,
  Pencil,
  Trash2,
  Upload,
  Video,
  Link2,
  GripVertical,
  FileText,
  Download,
  CheckCircle2,
} from "lucide-react";
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

  return (
    <div className="flex-1 overflow-auto px-6 sm:px-8 py-5">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-black text-foreground">Induction Videos</h3>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Manage the orientation videos new hires watch. Paste an external link
              (SharePoint/Stream/YouTube/MP4) or upload a file.
            </p>
          </div>
          <Button onClick={openNew} size="sm" className="gap-1.5">
            <PlusCircle className="h-4 w-4" /> Add video
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            <span className="text-[13px]">Loading videos…</span>
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3 rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08]">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
              <Video className="h-6 w-6 text-violet-400 opacity-70" />
            </div>
            <p className="text-[14px] font-medium">No induction videos yet.</p>
            <Button onClick={openNew} variant="outline" size="sm" className="gap-1.5">
              <PlusCircle className="h-4 w-4" /> Add your first video
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {videos.map((v) => (
              <div
                key={v.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3.5 transition-colors bg-white/70 dark:bg-zinc-900/50",
                  v.is_active
                    ? "border-slate-200/70 dark:border-white/[0.06]"
                    : "border-slate-200/50 dark:border-white/[0.04] opacity-60",
                )}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Video className="h-4.5 w-4.5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold text-foreground truncate">
                      {v.title}
                    </span>
                    {v.uploaded_filename ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                        <Upload className="h-2.5 w-2.5" /> UPLOADED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                        <Link2 className="h-2.5 w-2.5" /> LINK
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {v.description || v.url}
                  </p>
                  {v.chapters?.length > 0 && (
                    <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                      {v.chapters.length} chapter{v.chapters.length === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={v.is_active}
                    onCheckedChange={() => toggleActive(v)}
                    aria-label="Active"
                  />
                  <button
                    onClick={() => openEdit(v)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(v)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Documents ── */}
        <div className="mt-9">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-black text-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-sky-500" /> Documents
              </h3>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Full control of the joining-document checklist. Add sections, set fields &amp;
                mandatory, hide any doc, and upload a blank template. Drop a real .docx/.xlsx
                with <code className="text-[11px] bg-slate-100 dark:bg-zinc-800 px-1 rounded">{"{{ field }}"}</code>{" "}
                placeholders (hover Upload for the exact tokens) to mail-merge new-hire answers
                straight into it — any other file type is just a static download.
              </p>
            </div>
            <Button onClick={openNewSection} size="sm" className="gap-1.5 shrink-0">
              <PlusCircle className="h-4 w-4" /> Add section
            </Button>
          </div>

          {docsLoading ? (
            <div className="flex items-center justify-center py-14 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
              <span className="text-[13px]">Loading templates…</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {docs.map((doc) => (
                <div
                  key={doc.doc_key}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3.5 transition-colors bg-white/70 dark:bg-zinc-900/50",
                    doc.is_active
                      ? "border-slate-200/70 dark:border-white/[0.06]"
                      : "border-slate-200/50 dark:border-white/[0.04] opacity-60",
                  )}
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shrink-0">
                    <FileText className="h-4.5 w-4.5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
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
                      <span
                        className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded",
                          doc.is_builtin
                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                            : "bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400",
                        )}
                      >
                        {doc.is_builtin ? "BUILT-IN" : "CUSTOM"}
                      </span>
                      {!doc.is_active && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-slate-500">
                          HIDDEN
                        </span>
                      )}
                      {doc.has_template_file ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-2.5 w-2.5" /> TEMPLATE
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400">
                          AUTO FORM
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground truncate">
                      {doc.template_filename ||
                        doc.description ||
                        (doc.fields.length
                          ? `${doc.fields.length} field${doc.fields.length === 1 ? "" : "s"}`
                          : "No fillable fields")}
                    </p>
                  </div>
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
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={doc.is_active}
                      onCheckedChange={() => toggleDocActive(doc)}
                      aria-label="Active"
                    />
                    <button
                      onClick={() => openEditSection(doc)}
                      title="Edit name, fields, mandatory"
                      className="p-2 rounded-lg text-muted-foreground hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {doc.has_template_file && (
                      <button
                        onClick={() => downloadTemplate(doc)}
                        title="Download current template"
                        className="p-2 rounded-lg text-muted-foreground hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
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
                      <button
                        onClick={() => deleteDocTemplate(doc)}
                        title="Remove template file (revert to auto form)"
                        className="p-2 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => removeSection(doc)}
                      title={doc.is_builtin ? "Hide document" : "Delete document section"}
                      className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Induction documents ── */}
        <div className="mt-9">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-black text-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" /> Induction Documents
              </h3>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Reference material (handbooks, slides, policy packs) new hires can view alongside
                the induction videos. Add a link or upload a file.
              </p>
            </div>
            <Button
              onClick={() => setIndEditing({ title: "", description: "", url: "", sort_order: indDocs.length, is_active: true })}
              size="sm"
              className="gap-1.5 shrink-0"
            >
              <PlusCircle className="h-4 w-4" /> Add document
            </Button>
          </div>

          {indLoading ? (
            <div className="flex items-center justify-center py-14 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
              <span className="text-[13px]">Loading documents…</span>
            </div>
          ) : indDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2 rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08]">
              <FileText className="h-6 w-6 text-indigo-400 opacity-70" />
              <p className="text-[13px]">No induction documents yet.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {indDocs.map((d) => (
                <div
                  key={d.id}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3.5 transition-colors bg-white/70 dark:bg-zinc-900/50",
                    d.is_active
                      ? "border-slate-200/70 dark:border-white/[0.06]"
                      : "border-slate-200/50 dark:border-white/[0.04] opacity-60",
                  )}
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
                    <FileText className="h-4.5 w-4.5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold text-foreground truncate">{d.title}</span>
                      {d.uploaded_filename ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                          <Upload className="h-2.5 w-2.5" /> UPLOADED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                          <Link2 className="h-2.5 w-2.5" /> LINK
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground truncate">
                      {d.description || d.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setIndEditing({ ...d })}
                      className="p-2 rounded-lg text-muted-foreground hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeIndDoc(d)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="v-sort" className="mb-0">
                  Order
                </Label>
                <Input
                  id="v-sort"
                  type="number"
                  className="w-20"
                  value={editing?.sort_order ?? 0}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s!, sort_order: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="v-active" className="mb-0">
                  Active
                </Label>
                <Switch
                  id="v-active"
                  checked={editing?.is_active ?? true}
                  onCheckedChange={(c) => setEditing((s) => ({ ...s!, is_active: c }))}
                />
              </div>
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
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
