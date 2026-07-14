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
  Plus,
  Pencil,
  MoreVertical,
  Sparkle,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

const LIBRARY_ADMIN_ROLES = new Set(["HR", "Admin", "Super Admin"]);
const HR_ROLES = new Set(["HR", "Admin"]);

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

  const [mode, setMode] = useState<"library" | "hr-letters" | "manage-letters">("hr-letters");
  const isLibraryAdmin = !!user && LIBRARY_ADMIN_ROLES.has(user.role);
  const [lettersVersion, setLettersVersion] = useState(0);

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
              <PillTab active={mode === "manage-letters"} onClick={() => setMode("manage-letters")}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage letters
              </PillTab>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode === "library" ? (
          <DocumentLibrary authHeaders={authHeaders} isLibraryAdmin={isLibraryAdmin} />
        ) : mode === "manage-letters" && isHr ? (
          <ManageLetters authHeaders={authHeaders} onChanged={() => setLettersVersion((v) => v + 1)} />
        ) : (
          <ZohoHRLetters refreshKey={lettersVersion} />
        )}
      </div>
    </div>
  );
}

// ── Zoho HR Letters ───────────────────────────────────────────────────────────
// Generation happens entirely in Zoho People — this tab is a directory of deep links,
// backed by /api/hr-letters (HR manages the list from the "Manage letters" tab below).

type LetterCategory = "employment" | "certification" | "separation" | "admin";

interface HRLetter {
  id: number;
  key: string;
  label: string;
  description: string;
  icon: string;
  category: LetterCategory | string;
  zoho_path: string | null;
  zoho_url: string | null;
  fields: string[];
  enabled: boolean;
  sort_order: number;
}

const ICON_MAP: Record<string, typeof FileText> = {
  ShieldCheck,
  Award,
  UserRound,
  Home,
  CheckCircle2,
  GraduationCap,
  ThumbsUp,
  LogOut,
  Plane,
  FileText,
};

const CATEGORY_ORDER: LetterCategory[] = ["employment", "certification", "separation", "admin"];
const CATEGORY_LABELS: Record<string, string> = {
  employment: "Employment Proofs",
  certification: "Certificates",
  separation: "Separation Letters",
  admin: "Other Letters",
};

function useHrLetters(authHeaders: Record<string, string>, refreshKey?: number) {
  const [letters, setLetters] = useState<HRLetter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/hr-letters", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setLetters(d.letters || []))
      .catch(() => toast.error("Failed to load letters & certificates"))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  return { letters, loading, reload: load };
}

function ZohoHRLetters({ refreshKey }: { refreshKey?: number }) {
  const { user } = useAuth();
  const authHeaders = useMemo<Record<string, string>>(
    () => ({
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );
  const { letters, loading } = useHrLetters(authHeaders, refreshKey);

  const categories = CATEGORY_ORDER.filter((c) => letters.some((d) => d.category === c));
  const availableCount = letters.filter((d) => d.enabled && d.zoho_url).length;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8 py-6">
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Letters &amp; Certificates</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Clicking "Request" opens the form — your details are pre-filled there.
          </p>
        </div>
        {!loading && letters.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {availableCount} of {letters.length} available now
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => {
            const defs = letters.filter((d) => d.category === cat);
            return (
              <div key={cat}>
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  {CATEGORY_LABELS[cat] || cat}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {defs.map((def) => {
                    const Icon = ICON_MAP[def.icon] || FileText;
                    const available = def.enabled && !!def.zoho_url;

                    return (
                      <div
                        key={def.id}
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
                              {def.description}
                            </p>
                            {def.fields && def.fields.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                                You'll need: {def.fields.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>

                        {available ? (
                          <a
                            href={def.zoho_url!}
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
      )}

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

// ── HR: manage the Letters & Certificates directory ───────────────────────────

const EMPTY_LETTER_FORM = {
  id: null as number | null,
  label: "",
  description: "",
  category: "employment" as LetterCategory,
  zoho_path: "",
  fieldsText: "",
  enabled: false,
};

function ManageLetters({
  authHeaders,
  onChanged,
}: {
  authHeaders: Record<string, string>;
  onChanged: () => void;
}) {
  const { letters, loading, reload } = useHrLetters(authHeaders);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_LETTER_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const openCreate = () => {
    setForm(EMPTY_LETTER_FORM);
    setSheetOpen(true);
  };

  const openEdit = (l: HRLetter) => {
    setForm({
      id: l.id,
      label: l.label,
      description: l.description,
      category: (l.category as LetterCategory) || "employment",
      zoho_path: l.zoho_path || "",
      fieldsText: (l.fields || []).join(", "),
      enabled: l.enabled,
    });
    setSheetOpen(true);
  };

  const toggleEnabled = async (l: HRLetter, enabled: boolean) => {
    if (enabled && !l.zoho_path) {
      toast.error("Add a Zoho URL slug before enabling this letter.");
      return;
    }
    try {
      const res = await fetch(`/api/hr-letters/${l.id}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error();
      reload();
      onChanged();
    } catch {
      toast.error("Could not update this letter.");
    }
  };

  const save = async () => {
    if (!form.label.trim()) {
      toast.error("Label is required.");
      return;
    }
    setSaving(true);
    const body = {
      label: form.label.trim(),
      description: form.description.trim(),
      category: form.category,
      zoho_path: form.zoho_path.trim() || null,
      fields: form.fieldsText
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      enabled: form.enabled,
    };
    try {
      const res = await fetch(
        form.id ? `/api/hr-letters/${form.id}` : "/api/hr-letters",
        {
          method: form.id ? "PUT" : "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error();
      flyBanner(form.id ? "Letter updated" : "Letter added");
      setSheetOpen(false);
      reload();
      onChanged();
    } catch {
      toast.error("Could not save this letter.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/hr-letters/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      toast.success("Letter removed");
      reload();
      onChanged();
    } catch {
      toast.error("Could not remove this letter.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Manage letters</h2>
          <p className="text-[12px] text-muted-foreground">
            Control which letters &amp; certificates employees see. Enabling one requires a
            Zoho People URL slug to deep-link to.
          </p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2 shrink-0 w-full sm:w-auto">
          <Plus className="h-3.5 w-3.5" /> Add letter
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {letters.map((l) => {
            const Icon = ICON_MAP[l.icon] || FileText;
            return (
              <div
                key={l.id}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-card/60 p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-foreground">{l.label}</p>
                    <Badge variant="secondary" className="text-[9px] uppercase">
                      {CATEGORY_LABELS[l.category] || l.category}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {l.zoho_path ? `/${l.zoho_path}` : "No Zoho URL slug set"}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:shrink-0">
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <Switch checked={l.enabled} onCheckedChange={(v) => toggleEnabled(l, v)} />
                    Enabled
                  </label>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(l)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        disabled={deletingId === l.id}
                      >
                        {deletingId === l.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove "{l.label}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes it from the Letters &amp; Certificates list for everyone.
                          This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(l.id)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border px-6 py-5">
            <SheetTitle>{form.id ? "Edit letter" : "Add a new letter"}</SheetTitle>
            <SheetDescription>
              This only manages the directory entry — the letter itself is still generated in
              Zoho People.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="hl-label">
                Label <span className="text-destructive">*</span>
              </Label>
              <Input
                id="hl-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Salary Certificate"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hl-desc">Description</Label>
              <Textarea
                id="hl-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Shown under the title on the employee-facing card…"
                className="resize-none"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as LetterCategory }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hl-zoho">Zoho People URL slug</Label>
              <Input
                id="hl-zoho"
                value={form.zoho_path}
                onChange={(e) => setForm((f) => ({ ...f, zoho_path: e.target.value }))}
                placeholder="e.g. bonafideletter"
              />
              <p className="text-[11px] text-muted-foreground">
                From the Zoho People hrservices form URL. Leave blank to keep this as "Coming soon".
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hl-fields">What the employee will need (optional)</Label>
              <Input
                id="hl-fields"
                value={form.fieldsText}
                onChange={(e) => setForm((f) => ({ ...f, fieldsText: e.target.value }))}
                placeholder="Comma-separated, e.g. Purpose, Recipient"
              />
            </div>

            <label className="flex items-center gap-2 text-[12px] text-foreground">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
              Enabled (visible as available, not "Coming soon")
            </label>
          </div>

          <SheetFooter className="border-t border-border px-6 py-4 gap-2 sm:gap-2">
            <SheetClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                Cancel
              </Button>
            </SheetClose>
            <Button onClick={save} disabled={saving} className="w-full sm:w-auto gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {form.id ? "Save changes" : "Add letter"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
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

// Per-type accent so the grid doesn't read as one flat color — mirrors the app's
// semantic accent set (clarity/connectivity/collaboration/capacity + destructive for PDFs).
const FILE_TYPE_ACCENT: Record<string, string> = {
  pdf: "var(--destructive)",
  doc: "var(--clarity)",
  docx: "var(--clarity)",
  ppt: "var(--accent-amber)",
  pptx: "var(--accent-amber)",
  xls: "var(--collaboration)",
  xlsx: "var(--collaboration)",
  csv: "var(--collaboration)",
  png: "var(--capacity)",
  jpg: "var(--capacity)",
  jpeg: "var(--capacity)",
  gif: "var(--capacity)",
  zip: "var(--muted-foreground)",
  rar: "var(--muted-foreground)",
};

function accentFor(fileType: string) {
  return FILE_TYPE_ACCENT[fileType] || "var(--connectivity)";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecent(iso: string | null, days = 3) {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < days * 24 * 60 * 60 * 1000;
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
                className="shrink-0 rounded-full gap-1.5"
              >
                All
                <span className={cn("text-[10px]", !filterCat ? "text-white/70" : "text-muted-foreground")}>
                  {allDocs.length}
                </span>
              </Button>
              {categories.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={filterCat === c ? "default" : "secondary"}
                  onClick={() => setFilterCat(filterCat === c ? "" : c)}
                  className="shrink-0 rounded-full whitespace-nowrap gap-1.5"
                >
                  {c}
                  <span className={cn("text-[10px]", filterCat === c ? "text-white/70" : "text-muted-foreground")}>
                    {allDocs.filter((d) => d.category === c).length}
                  </span>
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
              <AnimatePresence initial={false} mode="popLayout">
                {filtered.map((doc, i) => {
                  const Icon = FILE_TYPE_ICON[doc.file_type] ?? FileText;
                  const canPreview = doc.file_type === "pdf";
                  const canDelete = isLibraryAdmin && doc.source !== "sharepoint";
                  const accent = accentFor(doc.file_type);
                  const fresh = isRecent(doc.created_at);
                  return (
                    <motion.div
                      key={`${doc.source ?? "upload"}-${doc.id}`}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.03 }}
                    >
                      <Card className="group/card flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
                        <div className="h-[3px] w-full shrink-0" style={{ background: accent }} />

                        <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
                          {/* Icon + title */}
                          <div className="flex items-start gap-3">
                            <div
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                              style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)` }}
                            >
                              <Icon className="h-5 w-5" style={{ color: accent }} />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
                                  {doc.title}
                                </p>
                                {fresh && (
                                  <Badge className="gap-1 border-none bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                    <Sparkle className="h-2.5 w-2.5" /> New
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {(canDelete || canPreview) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 data-[state=open]:opacity-100"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {canPreview && (
                                    <DropdownMenuItem onClick={() => handleView(doc)} className="gap-2">
                                      <FileText className="h-3.5 w-3.5" /> View
                                    </DropdownMenuItem>
                                  )}
                                  {canDelete && (
                                    <DropdownMenuItem
                                      onClick={() => handleDelete(doc.id)}
                                      disabled={deleting === doc.id}
                                      className="gap-2 text-destructive focus:text-destructive"
                                    >
                                      {deleting === doc.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                      Delete
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>

                          {/* Category badge */}
                          {doc.category && (
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="secondary">{doc.category}</Badge>
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
                              <Button
                                size="sm"
                                onClick={() => handleDownload(doc)}
                                className="h-7 gap-1.5 px-3 text-[11px]"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
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

