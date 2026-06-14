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

  const [mode, setMode] = useState<"generate" | "manage" | "library">("generate");
  const isLibraryAdmin = !!user && LIBRARY_ADMIN_ROLES.has(user.role);

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

  // Approver-role config (only HR/Admin can read this endpoint; everyone else stays a non-approver).
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
        flyBanner("Submitted for approval");
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
        toast.error("This document must be approved before it can be downloaded.");
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
      setCanApprove(canRelease && doc.status !== "verified");
      setDocType(doc.doc_type);
    } catch {
      toast.error("Could not load the document.");
    }
  };

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
              <h1 className="text-xl font-semibold leading-tight text-foreground">Documents</h1>
              <p className="text-[13px] text-muted-foreground">
                {isHr
                  ? "Generate from approved templates, review & release them, and manage the document catalogue."
                  : "Generate a document from an approved template. It becomes downloadable once it's approved and released."}
              </p>
            </div>
          </div>

          <div className="flex rounded-xl border border-[var(--border)] bg-card p-1 overflow-x-auto no-scrollbar max-w-full shrink-0">
            <PillTab active={mode === "generate"} onClick={() => setMode("generate")}>
              <FileText className="mr-1.5 h-3.5 w-3.5" /> Generate
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
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 sm:px-8 py-6 lg:grid-cols-2">
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
                        ? "Requires approval before it can be downloaded."
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
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-[var(--border)] bg-muted/30 p-3">
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
                      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-all w-full sm:w-auto",
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
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-emerald-700 w-full sm:w-auto"
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
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--connectivity)] px-4 py-2.5 text-[13px] font-semibold text-[var(--connectivity)] hover:bg-[color-mix(in_oklab,var(--connectivity)_8%,transparent)] w-full sm:w-auto"
                    >
                      {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Download PDF
                    </button>
                  )}

                  {/* Employee draft: awaiting approval note */}
                  {documentId != null && docStatus === "draft" && !canApprove && (
                    <span className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-600 dark:text-amber-400 w-full sm:w-auto text-center">
                      <Clock className="h-3.5 w-3.5" /> Sent for approval — downloadable once released
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
                    canApprove={canRelease}
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
                <div className="flex items-center justify-between border-b-2 border-[#00D4AA] px-4 sm:px-8 py-4">
                  <span className="text-[15px] font-bold text-[#0A2540]">Aligned Automation</span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#00D4AA]">
                    {selected?.label || "Document"}
                  </span>
                </div>

                {envelopeId && (
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 sm:px-8 py-1.5 text-[10px] text-slate-400">
                    <span>Document ID: {envelopeId}</span>
                  </div>
                )}

                <div className="px-4 sm:px-8 py-6 overflow-x-auto">
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
                  ? "Officially released. The downloaded PDF carries the document ID on every page; recipients can confirm authenticity on the verification page."
                  : "This is a draft preview. The signature is added only once the document is approved and released."}
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
    <div className="mx-auto max-w-4xl px-4 sm:px-8 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <h3 className="text-[14px] font-semibold text-foreground">Who can approve &amp; release</h3>
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
                {role === "hr" && <span className="text-[10px] text-muted-foreground">(always)</span>}
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
              {savingApprovers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
                                onChange={(e) => patchField(t.id, f.name, { type: e.target.value as FieldType })}
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
                                  patchField(t.id, f.name, { source: e.target.value as "auto" | "user" })
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
                                  onChange={(e) => patchField(t.id, f.name, { required: e.target.checked })}
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
  canApprove,
}: {
  title: string;
  docs: DocSummary[];
  emptyHint: string;
  onView: (d: DocSummary) => void;
  onApprove?: (id: number) => void;
  onDownload: (id: number, labelHint?: string) => void;
  isHr?: boolean;
  canApprove?: boolean;
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
              <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{d.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {isHr ? `${d.subject_name} · ` : ""}
                    {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:self-auto shrink-0 justify-end">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold mr-auto sm:mr-0",
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
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 flex-1 sm:flex-none text-center"
                  >
                    View
                  </button>
                  {canApprove && !verified && onApprove && (
                    <button
                      onClick={() => onApprove(d.id)}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 flex-1 sm:flex-none text-center"
                    >
                      Approve
                    </button>
                  )}
                  {verified && (
                    <button
                      onClick={() => onDownload(d.id, d.label)}
                      className="rounded-lg border border-[var(--connectivity)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--connectivity)] hover:bg-[color-mix(in_oklab,var(--connectivity)_8%,transparent)] flex-1 sm:flex-none text-center"
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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

  const baseHeaders = useMemo(() => {
    const { "Content-Type": _, ...rest } = authHeaders;
    return rest;
  }, [authHeaders]);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const url = filterCat
        ? `/api/document-library?category=${encodeURIComponent(filterCat)}`
        : "/api/document-library";
      const r = await fetch(url, { headers: baseHeaders });
      const d = await r.json();
      setDocs(d.documents || []);
    } catch {
      toast.error("Failed to load document library");
    } finally {
      setLoading(false);
    }
  }, [filterCat, baseHeaders]);

  const fetchCategories = useCallback(async () => {
    try {
      const r = await fetch("/api/document-library/categories", { headers: baseHeaders });
      const d = await r.json();
      setCategories(d.categories || []);
    } catch {
      // non-fatal
    }
  }, [baseHeaders]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

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
      fetchCategories();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: LibraryDoc) => {
    try {
      const r = await fetch(`/api/document-library/${doc.id}/download`, { headers: baseHeaders });
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
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const filtered = docs.filter(
    (d) =>
      !searchQ ||
      d.title.toLowerCase().includes(searchQ.toLowerCase()) ||
      (d.category || "").toLowerCase().includes(searchQ.toLowerCase()) ||
      d.filename.toLowerCase().includes(searchQ.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-8 py-6">
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search by title, category or filename…"
            className="pl-9 h-9 text-[13px]"
          />
        </div>
        {categories.length > 0 && (
          <Select value={filterCat || "_all"} onValueChange={(v) => setFilterCat(v === "_all" ? "" : v)}>
            <SelectTrigger className="h-9 text-[13px] w-full sm:w-44">
              <Tag className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isLibraryAdmin && (
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white w-full sm:w-auto"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Upload className="h-4 w-4" /> Upload document
          </button>
        )}
      </div>

      {/* Upload panel */}
      {uploadOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 rounded-2xl border border-[var(--border)] bg-card p-5 shadow-sm"
        >
          <h3 className="mb-4 text-[13px] font-semibold text-foreground">Add document to library</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Title <span className="text-destructive">*</span>
              </label>
              <Input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g. Q1 2025 Company Overview"
                className="text-[13px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Category
              </label>
              <Input
                value={uploadCat}
                onChange={(e) => setUploadCat(e.target.value)}
                placeholder="e.g. Presentations, Policies, Training"
                className="text-[13px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </label>
              <Textarea
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="Short description of what this document contains…"
                className="text-[13px]"
                rows={2}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                File <span className="text-destructive">*</span>
              </label>
              <input
                type="file"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.zip"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-[12px] file:font-medium file:text-primary"
              />
              {uploadFile && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {uploadFile.name} · {formatBytes(uploadFile.size)}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 w-full sm:w-auto"
              style={{ background: "var(--gradient-primary)" }}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              onClick={() => setUploadOpen(false)}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground w-full sm:w-auto text-center animate-none"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Document grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Library className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-[13px]">
            {docs.length === 0
              ? isLibraryAdmin
                ? "No documents yet. Upload the first one."
                : "No documents have been uploaded yet."
              : "No documents match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((doc) => {
            const Icon = FILE_TYPE_ICON[doc.file_type] ?? FileText;
            return (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: "color-mix(in oklab, var(--connectivity) 12%, transparent)" }}
                  >
                    <Icon className="h-4.5 w-4.5" style={{ color: "var(--connectivity)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground">{doc.title}</p>
                    {doc.category && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {doc.category}
                      </span>
                    )}
                  </div>
                </div>
                {doc.description && (
                  <p className="line-clamp-2 text-[12px] text-muted-foreground">{doc.description}</p>
                )}
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {doc.file_type.toUpperCase()} · {formatBytes(doc.file_size)}
                  </span>
                  <div className="flex items-center gap-2">
                    {isLibraryAdmin && (
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={deleting === doc.id}
                        className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                      >
                        {deleting === doc.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(doc)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--connectivity)] px-2.5 py-1 text-[11px] font-semibold text-[var(--connectivity)] hover:bg-[color-mix(in_oklab,var(--connectivity)_8%,transparent)]"
                    >
                      <Download className="h-3 w-3" /> Download
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
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
