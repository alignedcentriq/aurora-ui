import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
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

export const Route = createFileRoute("/_layout/documents")({
  component: DocumentsPage,
});

const HR_ROLES = new Set(["HR", "Admin"]);

type FieldType = "text" | "textarea" | "date" | "select";

interface DocField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  source: "user" | "auto";
  options?: string[];
}

interface DocCatalogItem {
  doc_type: string;
  label: string;
  requires_approval: boolean;
  fields: DocField[];
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

interface EmployeeCard {
  name: string;
  employee_id: string;
  department: string;
  designation: string;
  email: string;
  joining_date: string | null;
}

interface DocSummary {
  id: number;
  doc_type: string;
  label: string;
  title: string;
  subject_name: string;
  subject_email: string;
  generated_by_email: string;
  status: string; // "draft" | "verified"
  envelope_id: string | null;
  verified_by_email: string | null;
  verified_at: string | null;
  created_at: string | null;
}

const DOC_META: Record<string, { icon: typeof FileText; desc?: string }> = {
  no_objection_certificate: { icon: ShieldCheck },
  experience_certificate: { icon: Award },
  employment_verification: { icon: UserRound },
  address_proof: { icon: Home },
  relieving_letter: { icon: LogOut },
  internship_certificate: { icon: GraduationCap },
  recommendation_letter: { icon: ThumbsUp },
  travel_support_letter: { icon: Plane },
  project_proposal: { icon: Presentation },
};

function DocumentsPage() {
  const { user } = useAuth();
  const isHr = !!user && HR_ROLES.has(user.role);

  const authHeaders = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [mode, setMode] = useState<"generate" | "manage">("generate");

  const [catalogue, setCatalogue] = useState<DocCatalogItem[]>([]);
  const [docType, setDocType] = useState<string>("");

  const [nameQuery, setNameQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmployeeCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [employee, setEmployee] = useState<EmployeeCard | null>(null);

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Generation / current document
  const [generating, setGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [docStatus, setDocStatus] = useState<string>(""); // "" | "draft" | "verified"
  const [envelopeId, setEnvelopeId] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Lists
  const [myDocs, setMyDocs] = useState<DocSummary[]>([]);
  const [pending, setPending] = useState<DocSummary[]>([]);

  const selected = catalogue.find((d) => d.doc_type === docType);
  const userFields = selected?.fields ?? [];
  const isVerified = docStatus === "verified";

  // ── Load catalogue + own record + lists ──
  const fetchCatalogue = useCallback(() => {
    fetch("/api/documents/catalogue", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setCatalogue(d.documents || []))
      .catch(() => toast.error("Failed to load document types"));
  }, [authHeaders]);

  useEffect(() => {
    fetchCatalogue();
  }, [fetchCatalogue]);

  useEffect(() => {
    if (isHr) return;
    fetch("/api/documents/lookup", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setEmployee(d.results?.[0] || null))
      .catch(() => {});
  }, [isHr, authHeaders]);

  const refreshLists = useCallback(() => {
    if (isHr) {
      fetch("/api/documents/list?scope=pending", { headers: authHeaders })
        .then((r) => r.json())
        .then((d) => setPending(d.results || []))
        .catch(() => {});
    } else {
      fetch("/api/documents/list", { headers: authHeaders })
        .then((r) => r.json())
        .then((d) => setMyDocs(d.results || []))
        .catch(() => {});
    }
  }, [isHr, authHeaders]);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  // ── HR name search (debounced) ──
  useEffect(() => {
    if (!isHr) return;
    if (!nameQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/documents/lookup?name=${encodeURIComponent(nameQuery.trim())}`, {
        headers: authHeaders,
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          setSearchResults(d.results || []);
          setShowResults(true);
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nameQuery, isHr, authHeaders]);

  const pickEmployee = (emp: EmployeeCard) => {
    setEmployee(emp);
    setNameQuery(emp.name);
    setShowResults(false);
  };

  // Reset current document + field values when the selected type changes.
  useEffect(() => {
    if (generating) return;
    setPreviewHtml("");
    setDocumentId(null);
    setDocStatus("");
    setEnvelopeId(null);
    setCanApprove(false);
    setFieldValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, employee?.email]);

  const missingRequired = userFields.some(
    (f) => f.required && !(fieldValues[f.name]?.trim()),
  );
  const canGenerate = !!docType && !!employee && !missingRequired && !generating;

  const handleGenerate = useCallback(async () => {
    if (!docType || !employee) return;
    setGenerating(true);
    setPreviewHtml("");
    setDocumentId(null);
    setDocStatus("");
    setEnvelopeId(null);
    setCanApprove(false);

    try {
      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          doc_type: docType,
          employee_email: employee.email,
          field_values: fieldValues,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Generation failed.");
      }
      setPreviewHtml(data.preview_html || "");
      setDocumentId(data.document_id ?? null);
      setDocStatus(data.status || "draft");
      setEnvelopeId(data.envelope_id ?? null);
      setCanApprove(!!data.can_approve);
      if (data.status === "verified") {
        flyBanner("Document ready");
      } else if (!data.can_approve) {
        flyBanner("Submitted for HR release");
      }
      refreshLists();
    } catch (err) {
      toast.error((err as Error).message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [docType, employee, fieldValues, authHeaders, refreshLists]);

  const handleApprove = async (id: number) => {
    setApproving(true);
    try {
      const res = await fetch(`/api/documents/${id}/approve`, { method: "POST", headers: authHeaders });
      if (!res.ok) throw new Error("Approve failed");
      const d = await res.json();
      if (id === documentId) {
        setDocStatus("verified");
        // Re-fetch the released preview (now includes the signature block).
        fetch(`/api/documents/${id}`, { headers: authHeaders })
          .then((r) => r.json())
          .then((doc) => setPreviewHtml(doc.preview_html || ""))
          .catch(() => {});
      }
      flyBanner("Document approved & released");
      void d;
      refreshLists();
    } catch {
      toast.error("Could not approve the document.");
    } finally {
      setApproving(false);
    }
  };

  const handleDownload = async (id: number, labelHint?: string) => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/documents/${id}/download`, { headers: authHeaders });
      if (res.status === 403) {
        toast.error("This document must be approved by HR before it can be downloaded.");
        return;
      }
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(labelHint || selected?.label || "document").replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the PDF.");
    } finally {
      setDownloading(false);
    }
  };

  // Load a doc into the preview (HR reviewing a pending draft, or viewing own).
  const handleView = async (doc: DocSummary) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { headers: authHeaders });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setMode("generate");
      setPreviewHtml(d.preview_html || "");
      setDocumentId(doc.id);
      setDocStatus(doc.status);
      setEnvelopeId(doc.envelope_id ?? null);
      setCanApprove(isHr && doc.status !== "verified");
      setDocType(doc.doc_type);
    } catch {
      toast.error("Could not load the document.");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header band */}
      <div className="shrink-0 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm"
              style={{ background: "color-mix(in oklab, var(--connectivity) 14%, transparent)" }}
            >
              <FileText className="h-5 w-5" style={{ color: "var(--connectivity)" }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight text-foreground">Documents</h1>
              <p className="text-[13px] text-muted-foreground">
                {isHr
                  ? "Generate from approved templates, review & release them, and manage the document catalogue."
                  : "Generate a document from an approved template. It becomes downloadable once HR releases it."}
              </p>
            </div>
          </div>

          {isHr && (
            <div className="flex rounded-xl border border-[var(--border)] bg-card p-1">
              <PillTab active={mode === "generate"} onClick={() => setMode("generate")}>
                Generate
              </PillTab>
              <PillTab active={mode === "manage"} onClick={() => setMode("manage")}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage document types
              </PillTab>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isHr && mode === "manage" ? (
          <ManageTemplates authHeaders={authHeaders} onChanged={fetchCatalogue} />
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-2">
            {/* ── Form ── */}
            <div className="space-y-5">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="relative space-y-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-card/60 p-5 shadow-sm backdrop-blur-sm"
              >
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: "var(--gradient-primary)" }}
                />
                {/* Doc type */}
                <section>
                  <Step n={1} title="Document type" />
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger className="h-11 rounded-xl border-[var(--border)] bg-background text-[13px]">
                      <SelectValue placeholder="Choose a document type…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {catalogue.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-muted-foreground">
                          No document types available yet.
                        </div>
                      )}
                      {catalogue.map((d) => {
                        const Icon = (DOC_META[d.doc_type] ?? { icon: FileText }).icon;
                        return (
                          <SelectItem key={d.doc_type} value={d.doc_type} className="rounded-lg">
                            <span className="flex items-center gap-2.5">
                              <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--connectivity)" }} />
                              {d.label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {selected && (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {selected.requires_approval
                        ? "Requires HR approval before it can be downloaded."
                        : "Released instantly — downloadable as soon as it's generated."}
                    </p>
                  )}
                </section>

                {/* Employee */}
                <section>
                  <Step n={2} title="Employee" hint={isHr ? "search anyone" : "you"} />
                  {isHr ? (
                    <div className="relative">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={nameQuery}
                          onChange={(e) => {
                            setNameQuery(e.target.value);
                            setEmployee(null);
                          }}
                          onFocus={() => searchResults.length && setShowResults(true)}
                          placeholder="Search employee by name or email…"
                          className="pl-9"
                        />
                        {searching && (
                          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {showResults && searchResults.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-popover shadow-xl">
                          {searchResults.map((emp) => (
                            <button
                              key={emp.email || emp.employee_id}
                              onClick={() => pickEmployee(emp)}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60"
                            >
                              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium text-foreground">{emp.name}</div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {[emp.designation, emp.department, emp.email].filter(Boolean).join(" · ")}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {employee && (
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[var(--border)] bg-muted/30 p-3">
                      <Field label="Name" value={employee.name} />
                      <Field label="Employee ID" value={employee.employee_id || "—"} />
                      <Field label="Department" value={employee.department || "—"} />
                      <Field label="Designation" value={employee.designation || "—"} />
                    </div>
                  )}
                  {!employee && !isHr && <p className="text-[12px] text-muted-foreground">Loading your details…</p>}
                </section>

                {/* Dynamic details */}
                <section className="space-y-3">
                  <Step n={3} title="Details" />
                  {!docType ? (
                    <p className="text-[12px] text-muted-foreground">Pick a document type to see its fields.</p>
                  ) : userFields.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      No extra details needed — generate directly.
                    </p>
                  ) : (
                    userFields.map((f) => (
                      <FieldInput
                        key={f.name}
                        field={f}
                        value={fieldValues[f.name] ?? ""}
                        onChange={(v) => setFieldValues((p) => ({ ...p, [f.name]: v }))}
                      />
                    ))
                  )}
                </section>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-all",
                      canGenerate ? "hover:opacity-90" : "cursor-not-allowed opacity-40",
                    )}
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate
                  </button>

                  {/* HR: approve a draft */}
                  {documentId != null && docStatus === "draft" && canApprove && (
                    <button
                      onClick={() => handleApprove(documentId)}
                      disabled={approving}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-emerald-700"
                    >
                      {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve &amp; release
                    </button>
                  )}

                  {/* Verified: download */}
                  {documentId != null && isVerified && (
                    <button
                      onClick={() => handleDownload(documentId)}
                      disabled={downloading}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--connectivity)] px-4 py-2.5 text-[13px] font-semibold text-[var(--connectivity)] hover:bg-[color-mix(in_oklab,var(--connectivity)_8%,transparent)]"
                    >
                      {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Download PDF
                    </button>
                  )}

                  {/* Employee draft: awaiting approval note */}
                  {documentId != null && docStatus === "draft" && !canApprove && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5" /> Sent for HR approval — downloadable once released
                    </span>
                  )}
                </div>
              </motion.div>

              {/* Lists */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="rounded-2xl border border-[var(--border)] bg-card/40 p-5 shadow-sm"
              >
                {isHr ? (
                  <DocList
                    title="Pending approval"
                    docs={pending}
                    emptyHint="No documents waiting for approval."
                    onView={handleView}
                    onApprove={handleApprove}
                    onDownload={handleDownload}
                    isHr
                  />
                ) : (
                  <DocList
                    title="My documents"
                    docs={myDocs}
                    emptyHint="You haven't generated any documents yet."
                    onView={handleView}
                    onDownload={handleDownload}
                  />
                )}
              </motion.div>
            </div>

            {/* ── Preview ── */}
            <div className="lg:sticky lg:top-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</h2>
                {documentId != null &&
                  (isVerified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Released — official
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <Clock className="h-3 w-3" /> Draft — pending release
                    </span>
                  ))}
              </div>

              <div className="relative min-h-[520px] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
                {/* Letterhead */}
                <div className="flex items-center justify-between border-b-2 border-[#00D4AA] px-8 py-4">
                  <span className="text-[15px] font-bold text-[#0A2540]">Aligned Automation</span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#00D4AA]">
                    {selected?.label || "Document"}
                  </span>
                </div>

                {envelopeId && (
                  <div className="flex items-center justify-between border-b border-slate-100 px-8 py-1.5 text-[10px] text-slate-400">
                    <span>Document ID: {envelopeId}</span>
                  </div>
                )}

                <div className="px-8 py-6">
                  {previewHtml ? (
                    <div
                      className="aa-doc-preview text-[13px] leading-relaxed text-[#1E293B]"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    <div className="flex h-[400px] flex-col items-center justify-center text-center text-muted-foreground">
                      <ScrollText className="mb-3 h-10 w-10 opacity-30" />
                      <p className="text-[13px]">
                        {generating ? "Generating…" : "Your generated document will appear here."}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {isVerified
                  ? "Released by HR. The downloaded PDF carries the document ID on every page; recipients can confirm authenticity on the verification page."
                  : "This is a draft preview. The signature is added only once HR approves and releases the document."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dynamic field input ───────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DocField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-foreground">
        {field.label} {field.required && <span className="text-rose-500">*</span>}
      </label>
      {field.type === "textarea" ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : field.type === "date" ? (
        <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" && field.options?.length ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-10 rounded-lg text-[13px]">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

// ── HR: manage document templates ─────────────────────────────────────────────

function ManageTemplates({
  authHeaders,
  onChanged,
}: {
  authHeaders: Record<string, string>;
  onChanged: () => void;
}) {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [edits, setEdits] = useState<Record<number, Partial<DocTemplate>>>({});
  const [saving, setSaving] = useState<number | null>(null);

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
      const res = await fetch("/api/documents/admin/templates/sync", { method: "POST", headers: authHeaders });
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
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Document templates</h2>
          <p className="text-[12px] text-muted-foreground">
            Synced from SharePoint. Enable a template to add it to the dropdown, set whether it needs
            approval, and review the fields the app detected.
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3.5 py-2 text-[12px] font-semibold text-foreground hover:bg-muted/60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          Sync from SharePoint
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No templates yet. Drop PDF/DOCX files into the SharePoint templates folder and click “Sync from
          SharePoint”.
        </p>
      ) : (
        <div className="space-y-4">
          {templates.map((t0) => {
            const t = merged(t0);
            return (
              <div key={t.id} className="rounded-2xl border border-[var(--border)] bg-card/60 p-4 shadow-sm">
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
                    <Switch checked={t.enabled} onCheckedChange={(v) => patch(t.id, { enabled: v })} />
                    Enabled (show in dropdown)
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <Switch
                      checked={t.requires_approval}
                      onCheckedChange={(v) => patch(t.id, { requires_approval: v })}
                    />
                    Requires HR approval
                  </label>
                </div>

                {t.fields.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-muted/20 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Detected fields
                    </div>
                    <div className="space-y-2">
                      {t.fields.map((f) => (
                        <div key={f.name} className="flex flex-wrap items-center gap-2">
                          <span className="w-40 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                            {`{{${f.name}}}`}
                          </span>
                          <Input
                            value={f.label}
                            onChange={(e) => patchField(t.id, f.name, { label: e.target.value })}
                            className="h-8 flex-1 text-[12px]"
                          />
                          <select
                            value={f.type}
                            onChange={(e) => patchField(t.id, f.name, { type: e.target.value as FieldType })}
                            className="h-8 rounded-md border border-[var(--border)] bg-background px-2 text-[11px]"
                          >
                            <option value="text">text</option>
                            <option value="textarea">textarea</option>
                            <option value="date">date</option>
                            <option value="select">select</option>
                          </select>
                          <select
                            value={f.source}
                            onChange={(e) =>
                              patchField(t.id, f.name, { source: e.target.value as "auto" | "user" })
                            }
                            className="h-8 rounded-md border border-[var(--border)] bg-background px-2 text-[11px]"
                            title="auto = filled from employee record; user = entered at generation"
                          >
                            <option value="user">user-entered</option>
                            <option value="auto">auto-filled</option>
                          </select>
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={f.required}
                              onChange={(e) => patchField(t.id, f.name, { required: e.target.checked })}
                            />
                            required
                          </label>
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
                      "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white transition-all",
                      isDirty(t.id) ? "hover:opacity-90" : "cursor-not-allowed opacity-40",
                    )}
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    {saving === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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

function DocList({
  title,
  docs,
  emptyHint,
  onView,
  onApprove,
  onDownload,
  isHr,
}: {
  title: string;
  docs: DocSummary[];
  emptyHint: string;
  onView: (d: DocSummary) => void;
  onApprove?: (id: number) => void;
  onDownload: (id: number, labelHint?: string) => void;
  isHr?: boolean;
}) {
  return (
    <section className="pt-2">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {docs.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const verified = d.status === "verified";
            return (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{d.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {isHr ? `${d.subject_name} · ` : ""}
                    {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    verified
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {verified ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {verified ? "Released" : "Draft"}
                </span>
                <button
                  onClick={() => onView(d)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60"
                >
                  View
                </button>
                {isHr && !verified && onApprove && (
                  <button
                    onClick={() => onApprove(d.id)}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                )}
                {verified && (
                  <button
                    onClick={() => onDownload(d.id, d.label)}
                    className="rounded-lg border border-[var(--connectivity)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--connectivity)] hover:bg-[color-mix(in_oklab,var(--connectivity)_8%,transparent)]"
                  >
                    Download
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

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
        "inline-flex items-center rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
        active ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
        style={{ background: "var(--gradient-primary)" }}
      >
        {n}
      </span>
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {hint && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] text-foreground">{value}</div>
    </div>
  );
}
