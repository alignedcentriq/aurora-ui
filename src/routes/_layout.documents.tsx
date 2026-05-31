import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  FileText,
  Search,
  Loader2,
  Download,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Square,
  ScrollText,
  UserRound,
  Award,
  Home,
  LogOut,
  GraduationCap,
  ThumbsUp,
  Plane,
  Presentation,
  Lock,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

interface DocCatalogItem {
  doc_type: string;
  label: string;
  requires_purpose: boolean;
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
  verified_by_email: string | null;
  verified_at: string | null;
  created_at: string | null;
}

const DOC_META: Record<string, { icon: typeof FileText; desc: string }> = {
  no_objection_certificate: { icon: ShieldCheck, desc: "Confirms the company has no objection (visa, second job, travel, etc.)." },
  experience_certificate: { icon: Award, desc: "Certifies tenure, designation and department." },
  employment_verification: { icon: UserRound, desc: "Confirms current employment for a third party." },
  address_proof: { icon: Home, desc: "Employment-based proof for KYC / address verification." },
  relieving_letter: { icon: LogOut, desc: "Acknowledges the employee has been relieved of duties." },
  internship_certificate: { icon: GraduationCap, desc: "Certifies completion of an internship." },
  recommendation_letter: { icon: ThumbsUp, desc: "Professional recommendation / appreciation." },
  travel_support_letter: { icon: Plane, desc: "Supports a visa / travel application." },
  project_proposal: { icon: Presentation, desc: "Business-facing proposal with scope and approach." },
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

  const [catalogue, setCatalogue] = useState<DocCatalogItem[]>([]);
  const [docType, setDocType] = useState<string>("");

  const [nameQuery, setNameQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmployeeCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [employee, setEmployee] = useState<EmployeeCard | null>(null);

  const [purpose, setPurpose] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");

  // Generation / current document
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState("");
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [docStatus, setDocStatus] = useState<string>(""); // "" | "draft" | "verified"
  const [canApprove, setCanApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Lists
  const [myDocs, setMyDocs] = useState<DocSummary[]>([]);
  const [pending, setPending] = useState<DocSummary[]>([]);

  // Preview anti-capture state
  const [obscured, setObscured] = useState(false);

  const selected = catalogue.find((d) => d.doc_type === docType);
  const requiresPurpose = selected?.requires_purpose ?? false;
  const isVerified = docStatus === "verified";

  // ── Load catalogue + own record + lists ──
  useEffect(() => {
    fetch("/api/documents/catalogue", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setCatalogue(d.documents || []))
      .catch(() => toast.error("Failed to load document types"));
  }, [authHeaders]);

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

  // ── Anti-capture: obscure the preview when focus is lost / a capture tool steals focus ──
  useEffect(() => {
    const hide = () => setObscured(true);
    const showAgain = () => setObscured(false);
    const onVisibility = () => setObscured(document.hidden);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        setObscured(true);
        try {
          navigator.clipboard?.writeText("Screenshots of draft documents are blocked.");
        } catch {
          /* best effort */
        }
        toast.warning("Screenshots of draft previews are discouraged and watermarked with your identity.");
      }
    };
    window.addEventListener("blur", hide);
    window.addEventListener("focus", showAgain);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", showAgain);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Per-viewer forensic watermark tiled across the preview.
  const watermarkBg = useMemo(() => {
    const stamp = `${user?.email ?? "user"}  ·  ${new Date().toLocaleString()}`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='200'><text x='10' y='110' font-family='sans-serif' font-size='13' fill='rgba(15,23,42,0.10)' transform='rotate(-22 170 100)'>${stamp.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }, [user?.email]);

  const pickEmployee = (emp: EmployeeCard) => {
    setEmployee(emp);
    setNameQuery(emp.name);
    setShowResults(false);
  };

  // Reset current document when selection changes.
  useEffect(() => {
    if (generating) return;
    setPreview("");
    setDocumentId(null);
    setDocStatus("");
    setCanApprove(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, employee?.email]);

  const canGenerate =
    !!docType && !!employee && (!requiresPurpose || purpose.trim().length > 0) && !generating;

  const handleGenerate = useCallback(async () => {
    if (!docType || !employee) return;
    setGenerating(true);
    setPreview("");
    setDocumentId(null);
    setDocStatus("");
    setCanApprove(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/documents/generate", {
        method: "POST",
        signal: controller.signal,
        headers: authHeaders,
        body: JSON.stringify({
          doc_type: docType,
          employee_email: employee.email,
          purpose,
          additional_info: additionalInfo,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(res.status === 403 ? "You can only generate documents for yourself." : "Generation failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      const processLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line.slice(6));
        } catch {
          return;
        }
        if (evt.type === "token") {
          acc += (evt.content as string) ?? "";
          setPreview(acc);
        } else if (evt.type === "done") {
          setDocumentId((evt.document_id as number) ?? null);
          setDocStatus((evt.status as string) ?? "draft");
          setCanApprove(!!evt.can_approve);
          refreshLists();
        } else if (evt.type === "error") {
          toast.error((evt.content as string) || "Generation failed.");
        }
      };

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line.trim());
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message || "Generation failed.");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [docType, employee, purpose, additionalInfo, authHeaders, refreshLists]);

  const handleStop = () => {
    abortRef.current?.abort();
    setGenerating(false);
  };

  const handleApprove = async (id: number) => {
    setApproving(true);
    try {
      const res = await fetch(`/api/documents/${id}/approve`, { method: "POST", headers: authHeaders });
      if (!res.ok) throw new Error("Approve failed");
      if (id === documentId) setDocStatus("verified");
      toast.success("Document approved & released. It is now downloadable.");
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

  // Load a doc's content into the preview (HR reviewing a pending draft, or viewing own).
  const handleView = async (doc: DocSummary) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { headers: authHeaders });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setPreview(d.content || "");
      setDocumentId(doc.id);
      setDocStatus(doc.status);
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
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm"
            style={{ background: "color-mix(in oklab, var(--connectivity) 14%, transparent)" }}
          >
            <FileText className="h-5 w-5" style={{ color: "var(--connectivity)" }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight text-foreground">Document Generation</h1>
            <p className="text-[13px] text-muted-foreground">
              {isHr
                ? "Generate and review letters, then approve & release them. Only released documents can be downloaded."
                : "Generate a letter to preview it. It becomes downloadable only after HR approves & releases it."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
              {selected && DOC_META[selected.doc_type]?.desc && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug text-muted-foreground"
                  style={{ background: "color-mix(in oklab, var(--connectivity) 7%, transparent)" }}
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--connectivity)" }} />
                  {DOC_META[selected.doc_type]?.desc}
                </motion.div>
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

            {/* Details */}
            <section className="space-y-3">
              <Step n={3} title="Details" />
              <div>
                <label className="mb-1 block text-[12px] font-medium text-foreground">
                  Purpose / Reason {requiresPurpose && <span className="text-rose-500">*</span>}
                </label>
                <Textarea
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Applying for a Schengen visa for personal travel"
                  rows={2}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-foreground">Additional information</label>
                <Textarea
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  placeholder="Any extra context to include (recipient, dates already known, etc.)"
                  rows={3}
                />
              </div>
            </section>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {!generating ? (
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-all",
                    canGenerate ? "hover:opacity-90" : "cursor-not-allowed opacity-40",
                  )}
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <Sparkles className="h-4 w-4" />
                  Generate preview
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/60"
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              )}

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

          {/* ── Preview (locked down) ── */}
          <div className="lg:sticky lg:top-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</h2>
              {isVerified ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Released — official
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <Lock className="h-3 w-3" /> Draft preview — not valid
                </span>
              )}
            </div>

            <div
              className="relative min-h-[520px] select-none overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
              onContextMenu={(e) => e.preventDefault()}
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              style={{ userSelect: "none", WebkitUserSelect: "none" }}
            >
              {/* Letterhead */}
              <div className="flex items-center justify-between border-b-2 border-[#00D4AA] px-8 py-4">
                <span className="text-[15px] font-bold text-[#0A2540]">Aligned Automation</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#00D4AA]">
                  {selected?.label || "Document"}
                </span>
              </div>

              <div className="relative px-8 py-6">
                {preview ? (
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[#1E293B]">
                    {preview}
                    {generating && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[#0A2540] align-middle" />}
                  </pre>
                ) : (
                  <div className="flex h-[400px] flex-col items-center justify-center text-center text-muted-foreground">
                    <ScrollText className="mb-3 h-10 w-10 opacity-30" />
                    <p className="text-[13px]">{generating ? "Generating…" : "Your generated letter will appear here."}</p>
                  </div>
                )}
              </div>

              {/* Forensic watermark overlay (drafts only) */}
              {preview && !isVerified && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundImage: watermarkBg, backgroundRepeat: "repeat" }}
                  aria-hidden
                />
              )}
              {/* Big DRAFT stamp (drafts only) */}
              {preview && !isVerified && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="-rotate-[24deg] select-none text-[40px] font-black tracking-widest text-slate-300/40">
                    DRAFT — NOT VALID
                  </span>
                </div>
              )}

              {/* Obscure overlay when focus lost / screenshot attempt */}
              {obscured && preview && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 backdrop-blur-md">
                  <EyeOff className="h-7 w-7 text-slate-400" />
                  <p className="text-[12px] font-medium text-slate-500">Preview hidden — return to this window to view.</p>
                </div>
              )}
            </div>

            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <Eye className="mt-0.5 h-3 w-3 shrink-0" />
              This preview is watermarked with your identity and cannot be downloaded. Only an HR-approved
              document is valid; recipients can confirm authenticity via the QR code on the released PDF.
            </p>
          </div>
        </div>
      </div>
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
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3"
              >
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
