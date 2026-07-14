import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  Plus,
  Zap,
  Mail,
  Clock,
  Users,
  Play,
  Pause,
  Trash2,
  Edit2,
  Send,
  X,
  Search,
  UserPlus,
  Eye,
  UserCheck,
  ArrowLeft,
  Settings2,
  FileText,
  Bell,
  BookOpen,
  TriangleAlert,
  Sparkles,
  Check,
  AlertCircle,
  Wand2,
  Loader2,
  MessageSquare,
  RefreshCw,
  History,
} from "lucide-react";
import {
  AUTOMATION_CATALOG,
  getCatalogItem,
  getCatalogForPortal,
  CATEGORY_ORDER,
  CATEGORY_META,
  type CatalogItem,
} from "@/lib/automation-catalog";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// shadcn components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recipient {
  type: "individual" | "teams_group";
  email?: string;
  name?: string;
  id?: string;
  emails?: string[];
}

interface AutomationRule {
  id: number;
  name: string;
  description: string;
  created_by: string;
  created_by_role: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute: number;
  email_subject: string;
  email_body: string;
  automation_kind: string;
  extra_config: Record<string, any>;
  recipients_json: Recipient[];
  co_owners_json: string[];
  is_active: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
  can_manage: boolean;
}

interface SendLogEntry {
  id: number;
  rule_id: number | null;
  rule_name: string;
  created_by: string;
  automation_kind: string | null;
  triggered_by: string;         // scheduled | manual
  triggered_by_email: string | null;
  recipients_json: string[];
  recipient_count: number;
  status: string;               // sent | failed
  detail: string | null;
  sent_at: string | null;
}

interface TeamsGroup {
  id: string;
  name: string;
  description?: string;
}

interface RuleFormState {
  name: string;
  description: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute: number;
  automation_kind: string;
  extra_config: Record<string, any>;
  email_subject: string;
  email_body: string;
  recipients_json: Recipient[];
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NON_EMPLOYEE_ROLES = ["hr", "admin", "it", "pmo", "functional manager", "super admin"];

function blankFormFromKind(item: CatalogItem, defaultEmail?: string, defaultName?: string): RuleFormState {
  const extra: Record<string, any> = {};
  for (const p of item.params) {
    if (p.default !== undefined) extra[p.key] = p.default;
  }
  return {
    name: item.label,
    description: item.description,
    frequency: item.defaultFrequency,
    day_of_week: item.defaultDayOfWeek ?? null,
    day_of_month: item.defaultDayOfMonth ?? null,
    hour: item.defaultHour,
    minute: 0,
    automation_kind: item.id,
    extra_config: extra,
    email_subject: item.defaultSubject,
    email_body: "",
    recipients_json: defaultEmail ? [{ type: "individual", email: defaultEmail, name: defaultName || defaultEmail }] : [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function describeCadence(rule: AutomationRule): string {
  const h = rule.hour.toString().padStart(2, "0");
  const m = (rule.minute ?? 0).toString().padStart(2, "0");
  const t = `${h}:${m}`;
  if (rule.frequency === "daily") return `Every weekday at ${t}`;
  if (rule.frequency === "weekly") return `Every ${DAY_NAMES[rule.day_of_week ?? 0]} at ${t}`;
  if (rule.frequency === "monthly") {
    const dom = rule.day_of_month ?? 1;
    const s = dom === 1 ? "st" : dom === 2 ? "nd" : dom === 3 ? "rd" : "th";
    return `${dom}${s} of month at ${t}`;
  }
  return `Custom at ${t}`;
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function recipientCount(r: Recipient[]): number {
  return r.reduce((n, x) => (x.type === "individual" ? n + 1 : n + (x.emails?.length ?? 1)), 0);
}

function canCreate(role: string): boolean {
  return NON_EMPLOYEE_ROLES.includes(role.toLowerCase());
}

const CATEGORY_ICONS: Record<string, React.FC<any>> = {
  Report: FileText,
  Reminder: Bell,
  Digest: BookOpen,
  Alert: TriangleAlert,
  Custom: Settings2,
};

async function apiFetch(url: string, email: string, role: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-email": email,
      "x-user-role": role,
      ...(opts?.headers as Record<string, string> | undefined),
    },
  });
}

// ── Recipient Pill ────────────────────────────────────────────────────────────

function RecipientPill({ r, onRemove }: { r: Recipient; onRemove?: () => void }) {
  const label = r.type === "individual"
    ? r.name || r.email || ""
    : `${r.name} (${r.emails?.length ?? 0} members)`;
  return (
    <Badge variant="secondary" className="flex items-center gap-1 pr-1 text-xs font-normal">
      {r.type === "individual" ? <Mail className="h-3 w-3" /> : <Users className="h-3 w-3" />}
      <span className="max-w-[160px] truncate">{label}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </Badge>
  );
}

// ── Co-Owner Dialog ────────────────────────────────────────────────────────────

function CoOwnerDialog({
  rule,
  userEmail,
  userRole,
  onClose,
  onUpdated,
}: {
  rule: AutomationRule;
  userEmail: string;
  userRole: string;
  onClose: () => void;
  onUpdated: (updated: AutomationRule) => void;
}) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function addCoOwner() {
    const addr = input.trim().toLowerCase();
    if (!addr) return;
    if ((rule.co_owners_json ?? []).map((e) => e.toLowerCase()).includes(addr)) {
      setError("Already a co-owner."); return;
    }
    setSaving(true); setError("");
    try {
      const res = await apiFetch(`/api/automation/rules/${rule.id}/co-owners`, userEmail, userRole, {
        method: "PATCH", body: JSON.stringify({ action: "add", email: addr }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed");
      onUpdated(data); setInput("");
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  }

  async function removeCoOwner(addr: string) {
    setSaving(true); setError("");
    try {
      const res = await apiFetch(`/api/automation/rules/${rule.id}/co-owners`, userEmail, userRole, {
        method: "PATCH", body: JSON.stringify({ action: "remove", email: addr }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed");
      onUpdated(data);
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <UserCheck className="h-4 w-4 text-primary" /> Manage Co-owners
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Co-owners can view this automation. Only the creator and Super Admins can edit or delete it.
        </p>
        <div className="flex gap-2">
          <Input
            className="h-9 text-sm"
            placeholder="Enter email address"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCoOwner(); } }}
          />
          <Button size="sm" variant="outline" onClick={addCoOwner} disabled={saving || !input.trim()}>
            <UserPlus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {(rule.co_owners_json ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No co-owners yet.</p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="space-y-1.5">
              {(rule.co_owners_json ?? []).map((addr) => (
                <div key={addr} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="text-sm truncate">{addr}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeCoOwner(addr)} disabled={saving}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── AI Composer ───────────────────────────────────────────────────────────────

interface AiComposeResult {
  automation_kind: string;
  name: string;
  description: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute: number;
  extra_config: Record<string, any>;
  email_subject: string;
  email_body: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

function AiComposer({
  portalId,
  userEmail,
  userRole,
  onResult,
  onBack,
  onCancel,
}: {
  portalId?: string;
  userEmail: string;
  userRole: string;
  onResult: (result: AiComposeResult) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AiComposeResult | null>(null);

  const SUGGESTIONS = [
    "Send me weekly leave balance report for all employees",
    "Daily digest of open IT tickets grouped by priority",
    "Remind managers every Monday about pending approvals",
    "Monthly training compliance update for the team",
    "Alert me when IT tickets are overdue by 3 days",
    "Notify the team every Friday about upcoming training deadlines",
  ];

  async function compose() {
    if (!description.trim()) return;
    setLoading(true); setError(""); setPreview(null);
    try {
      const res = await apiFetch("/api/automation/ai-compose", userEmail, userRole, {
        method: "POST",
        body: JSON.stringify({ description: description.trim(), portal_id: portalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Compose failed");
      setPreview(data);
    } catch (err: any) {
      setError(err.message || "AI compose failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const kindMeta = preview ? getCatalogItem(preview.automation_kind) : null;
  const KindIcon = kindMeta ? (CATEGORY_ICONS[kindMeta.category] ?? Zap) : Zap;
  const confidenceColor = {
    high: "text-emerald-600 bg-emerald-50 border-emerald-200",
    medium: "text-amber-600 bg-amber-50 border-amber-200",
    low: "text-red-600 bg-red-50 border-red-200",
  }[preview?.confidence ?? "medium"];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
          <Wand2 className="h-4 w-4 text-violet-600" />
        </div>
        <div>
          <div className="text-sm font-semibold">Describe what you want automated</div>
          <div className="text-xs text-muted-foreground">AI will pick the best automation type and configure it for you</div>
        </div>
      </div>

      {/* Description input */}
      <div className="space-y-2">
        <Textarea
          autoFocus
          rows={3}
          className="text-sm resize-none"
          placeholder="e.g. Send me a weekly summary of open IT tickets every Monday morning…"
          value={description}
          onChange={(e) => { setDescription(e.target.value); setPreview(null); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) compose(); }}
        />
        <p className="text-[11px] text-muted-foreground">Press Ctrl+Enter to compose</p>
      </div>

      {/* Quick suggestion chips */}
      {!preview && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Try one of these:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setDescription(s); setPreview(null); setError(""); }}
                className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* AI result preview */}
      {preview && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-violet-200 dark:border-violet-800/40 bg-violet-50/40 dark:bg-violet-900/10">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${kindMeta?.accent ?? "#8B5CF6"}18` }}>
                    <KindIcon className="h-3.5 w-3.5" style={{ color: kindMeta?.accent ?? "#8B5CF6" }} />
                  </div>
                  <span className="font-semibold text-sm">{preview.name}</span>
                </div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", confidenceColor)}>
                  {preview.confidence} confidence
                </span>
              </div>

              {preview.reasoning && (
                <p className="text-xs text-muted-foreground italic">"{preview.reasoning}"</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="h-3 w-3 flex-shrink-0" />
                  <span>{kindMeta?.label ?? preview.automation_kind}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3 flex-shrink-0" />
                  <span className="capitalize">{preview.frequency}{preview.frequency === "weekly" && preview.day_of_week != null ? ` · ${DAY_NAMES[preview.day_of_week]}` : ""}</span>
                </div>
              </div>

              {preview.automation_kind === "custom_email" && preview.email_subject && (
                <div className="rounded-lg bg-background border p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-foreground">{preview.email_subject}</div>
                  <div className="text-muted-foreground whitespace-pre-line line-clamp-3">{preview.email_body}</div>
                </div>
              )}

              <Separator />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => onResult(preview)}
                >
                  <Check className="h-3.5 w-3.5" /> Use This Setup
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPreview(null); }}>
                  <RefreshCw className="h-3.5 w-3.5" /> Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Browse Catalog
        </Button>
        <Button
          size="sm"
          className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={compose}
          disabled={loading || !description.trim()}
        >
          {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Composing…</> : <><Wand2 className="h-3.5 w-3.5" /> Compose</>}
        </Button>
      </div>
    </div>
  );
}

// ── Step 1: Type Picker ───────────────────────────────────────────────────────

function TypePicker({
  portalId,
  onSelect,
  onCancel,
  onAiCompose,
}: {
  portalId?: string;
  onSelect: (item: CatalogItem) => void;
  onCancel: () => void;
  onAiCompose: () => void;
}) {
  const [search, setSearch] = useState("");
  const portalItemIds = new Set(getCatalogForPortal(portalId).filter(i => i.portalIds.length > 0).map((i) => i.id));
  const allTabs = ["All", ...CATEGORY_ORDER] as const;

  const filtered = search.trim()
    ? AUTOMATION_CATALOG.filter(
        (c) =>
          c.label.toLowerCase().includes(search.toLowerCase()) ||
          c.description.toLowerCase().includes(search.toLowerCase()),
      )
    : AUTOMATION_CATALOG;

  function ItemCard({ item }: { item: CatalogItem }) {
    const isRelevant = portalId && portalItemIds.has(item.id);
    const Icon = CATEGORY_ICONS[item.category] ?? Zap;
    return (
      <Card
        className={cn(
          "cursor-pointer group hover:shadow-md transition-all duration-150 relative overflow-hidden",
          isRelevant ? "ring-1 ring-amber-300 dark:ring-amber-600/40" : "",
        )}
        onClick={() => onSelect(item)}
      >
        {isRelevant && (
          <div
            className="absolute top-0 left-0 right-0 h-0.5"
            style={{ backgroundColor: item.accent }}
          />
        )}
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${item.accent}18` }}
            >
              <Icon className="h-4 w-4" style={{ color: item.accent }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                  {item.label}
                </span>
                {isRelevant && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-300 text-amber-700 dark:text-amber-400">
                    Relevant
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {item.description}
              </p>
              <div
                className="mt-2 text-[10px] rounded-md px-2 py-1.5 leading-snug"
                style={{ backgroundColor: `${item.accent}10`, color: item.accent }}
              >
                <span className="font-semibold">Email includes:</span> {item.emailPreview}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI compose banner */}
      <button
        type="button"
        onClick={onAiCompose}
        className="flex items-center gap-3 p-4 rounded-2xl border border-violet-200/50 dark:border-violet-800/20 bg-gradient-to-r from-violet-50/50 to-fuchsia-50/50 dark:from-violet-900/10 dark:to-fuchsia-900/10 hover:from-violet-50 hover:to-fuchsia-50 dark:hover:from-violet-900/20 transition-all text-left group overflow-hidden relative"
      >
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
          <Wand2 className="w-16 h-16 text-violet-600" />
        </div>
        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0 group-hover:rotate-12 transition-transform shadow-sm">
          <Wand2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0 z-10">
          <div className="font-medium text-sm text-violet-900 dark:text-violet-100">Create with AI</div>
        </div>
        <div className="text-xs font-medium text-violet-600 dark:text-violet-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          Try it <ArrowLeft className="h-3 w-3 rotate-180" />
        </div>
      </button>

      <div className="relative mt-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input className="pl-9 bg-muted/40 border-border/50 h-10 rounded-xl" placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {portalId && portalItemIds.size > 0 && !search && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-amber-500" />
          Items marked <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-300 text-amber-700">Relevant</Badge> are tailored to this portal.
        </div>
      )}

      {search ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((item) => <ItemCard key={item.id} item={item} />)}
          {filtered.length === 0 && (
            <p className="col-span-2 text-center py-10 text-sm text-muted-foreground">No automation types match your search.</p>
          )}
        </div>
      ) : (
        <Tabs defaultValue="All">
          <TabsList className="flex-wrap h-auto gap-1 mb-3">
            {allTabs.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="text-xs">
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>
          {allTabs.map((cat) => {
            const items = cat === "All"
              ? AUTOMATION_CATALOG
              : AUTOMATION_CATALOG.filter((c) => c.category === cat);
            return (
              <TabsContent key={cat} value={cat}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {items.map((item) => <ItemCard key={item.id} item={item} />)}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <div className="flex justify-start pt-1 border-t">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Param Field ───────────────────────────────────────────────────────────────

function ParamField({
  param,
  value,
  onChange,
}: {
  param: import("@/lib/automation-catalog").CatalogParam;
  value: any;
  onChange: (val: any) => void;
}) {
  if (param.type === "toggle") {
    return (
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-normal cursor-pointer">{param.label}</Label>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }

  if (param.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{param.label}</Label>
        <Select value={String(value ?? param.default)} onValueChange={onChange}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(param.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {param.hint && <p className="text-[11px] text-muted-foreground">{param.hint}</p>}
      </div>
    );
  }

  if (param.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{param.label}</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={param.min}
            max={param.max}
            className="h-9 w-24 text-center text-sm"
            value={value ?? param.default ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              const clamped = param.min !== undefined && v < param.min ? param.min
                : param.max !== undefined && v > param.max ? param.max : v;
              onChange(clamped);
            }}
          />
          {param.hint && <span className="text-xs text-muted-foreground">{param.hint}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{param.label}</Label>
      <Input className="h-9 text-sm" placeholder={param.placeholder ?? ""} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {param.hint && <p className="text-[11px] text-muted-foreground">{param.hint}</p>}
    </div>
  );
}

// ── Step 2: Configure Form ────────────────────────────────────────────────────

function ConfigureForm({
  catalogItem,
  initial,
  isEdit,
  onSave,
  onBack,
  onCancel,
  userEmail,
  userRole,
}: {
  catalogItem: CatalogItem;
  initial: RuleFormState;
  isEdit: boolean;
  onSave: (data: RuleFormState) => Promise<void>;
  onBack: () => void;
  onCancel: () => void;
  userEmail: string;
  userRole: string;
}) {
  const [form, setForm] = useState<RuleFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [groups, setGroups] = useState<TeamsGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [expandingGroup, setExpandingGroup] = useState<string | null>(null);
  const [userResults, setUserResults] = useState<{ name: string; email: string }[]>([]);
  const recipientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [showRecipientDropdown, setShowRecipientDropdown] = useState(false);

  const isCustom = catalogItem.id === "custom_email";
  const set = (key: keyof RuleFormState, val: any) => setForm((prev) => ({ ...prev, [key]: val }));
  const setParam = (key: string, val: any) =>
    setForm((prev) => ({ ...prev, extra_config: { ...prev.extra_config, [key]: val } }));

  async function loadGroups() {
    if (groups.length > 0) return;
    setLoadingGroups(true);
    try {
      const res = await apiFetch("/api/automation/ms365/groups", userEmail, userRole);
      const data = await res.json();
      setGroups(data.groups || []);
    } catch { setGroups([]); } finally { setLoadingGroups(false); }
  }

  function addRawEmail(raw: string) {
    const addresses = raw.split(/[,;\s]+/).filter(Boolean);
    set("recipients_json", [
      ...form.recipients_json,
      ...addresses
        .filter((e) => !form.recipients_json.some((ex) => ex.type === "individual" && ex.email === e))
        .map((e) => ({ type: "individual" as const, email: e, name: e })),
    ]);
  }

  function handleRecipientQueryChange(q: string) {
    setRecipientQuery(q);
    setShowRecipientDropdown(q.length >= 1);
    if (recipientSearchRef.current) clearTimeout(recipientSearchRef.current);
    if (q.length < 2) { setUserResults([]); return; }
    recipientSearchRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/automation/ms365/users/search?q=${encodeURIComponent(q)}`, userEmail, userRole);
        const data = await res.json();
        setUserResults(Array.isArray(data) ? data : []);
      } catch { setUserResults([]); }
    }, 250);
  }

  function addUserResult(u: { name: string; email: string }) {
    if (!form.recipients_json.some((r) => r.type === "individual" && r.email === u.email)) {
      set("recipients_json", [...form.recipients_json, { type: "individual", email: u.email, name: u.name }]);
    }
    setRecipientQuery(""); setUserResults([]); setShowRecipientDropdown(false);
  }

  async function addTeamsGroup(group: TeamsGroup) {
    if (form.recipients_json.some((r) => r.type === "teams_group" && r.id === group.id)) {
      setRecipientQuery(""); setShowRecipientDropdown(false); return;
    }
    setExpandingGroup(group.id);
    try {
      const res = await apiFetch(`/api/automation/ms365/groups/${group.id}/members`, userEmail, userRole);
      const data = await res.json();
      const memberEmails: string[] = (data.members || []).map((m: any) => m.email).filter(Boolean);
      set("recipients_json", [...form.recipients_json, { type: "teams_group", id: group.id, name: group.name, emails: memberEmails }]);
    } catch {
      set("recipients_json", [...form.recipients_json, { type: "teams_group", id: group.id, name: group.name, emails: [] }]);
    } finally { setExpandingGroup(null); setRecipientQuery(""); setShowRecipientDropdown(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Automation name is required."); return; }
    if (isCustom && !form.email_subject.trim()) { setError("Email subject is required."); return; }
    if (isCustom && !form.email_body.trim()) { setError("Email body is required."); return; }
    setSaving(true); setError("");
    try { await onSave(form); } catch (err: any) { setError(err.message || "Failed to save."); } finally { setSaving(false); }
  }

  const CatIcon = CATEGORY_ICONS[catalogItem.category] ?? Zap;
  const filteredGroupsForSearch = groups.filter((g) =>
    g.name.toLowerCase().includes(recipientQuery.toLowerCase())
  );
  const queryLooksLikeEmail = /^[^\s@]+@[^\s@.]+\.[^\s@.]+$/.test(recipientQuery.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Kind header */}
      <div
        className="flex items-center gap-3 p-3 rounded-xl border"
        style={{ backgroundColor: `${catalogItem.accent}0d`, borderColor: `${catalogItem.accent}35` }}
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${catalogItem.accent}20` }}>
          <CatIcon className="h-4 w-4" style={{ color: catalogItem.accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{catalogItem.label}</div>
          <div className="text-[11px] text-muted-foreground truncate">{catalogItem.emailPreview}</div>
        </div>
        {!isEdit && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="flex-shrink-0 h-7 text-xs gap-1">
            <ArrowLeft className="h-3 w-3" /> Change
          </Button>
        )}
      </div>

      {/* Name + Description */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
          <Input className="h-9 text-sm" placeholder="e.g. Weekly HR Leave Report" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input className="h-9 text-sm" placeholder="Optional description" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>

      {/* Schedule */}
      <div className="rounded-xl border border-border bg-muted/20">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Schedule</span>
        </div>
        <div className="px-4 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => { set("frequency", v); set("day_of_week", null); set("day_of_month", null); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily (weekdays)</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.frequency === "weekly" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Day</Label>
                <Select value={String(form.day_of_week ?? 0)} onValueChange={(v) => set("day_of_week", Number(v))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.frequency === "monthly" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Day of month</Label>
                <Select value={String(form.day_of_month ?? 1)} onValueChange={(v) => set("day_of_month", Number(v))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Send time</Label>
              <div className="flex gap-1.5">
                <Select value={String(form.hour)} onValueChange={(v) => set("hour", Number(v))}>
                  <SelectTrigger className="h-9 text-sm flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => {
                      const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
                      return <SelectItem key={h} value={String(h)}>{label}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  className="h-9 w-16 text-center text-sm"
                  value={form.minute ?? 0}
                  onChange={(e) => set("minute", Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                  placeholder="00"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Type-specific params */}
      {catalogItem.params.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Report Settings</span>
          </div>
          <div className="px-4 py-3 space-y-4">
            {catalogItem.params.map((p) => (
              <ParamField key={p.key} param={p} value={form.extra_config[p.key] ?? p.default} onChange={(val) => setParam(p.key, val)} />
            ))}
          </div>
        </div>
      )}

      {/* Auto-generated notice */}
      {!isCustom && (
        <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 px-3.5 py-3 text-xs text-emerald-800 dark:text-emerald-300">
          <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-600" />
          <div>
            <span className="font-semibold">Auto-generated email</span> — the system queries live data at send time and composes a formatted report automatically.
          </div>
        </div>
      )}

      {/* Custom email content */}
      {isCustom && (
        <div className="rounded-xl border border-border bg-muted/20">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email Content</span>
          </div>
          <div className="px-4 py-3 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Subject <span className="text-destructive">*</span></Label>
              <Input className="h-9 text-sm" placeholder="e.g. Weekly Team Update" value={form.email_subject} onChange={(e) => set("email_subject", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message <span className="text-destructive">*</span></Label>
              <Textarea rows={5} className="text-sm resize-y" placeholder={"Hi Team,\n\nYour message here…"} value={form.email_body} onChange={(e) => set("email_body", e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Plain text. Line breaks are preserved in the email.</p>
            </div>
          </div>
        </div>
      )}

      {/* Recipients */}
      <div className="rounded-xl border border-border bg-muted/20">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recipients</span>
        </div>
        <div className="px-4 py-3 space-y-3">
          {/* Unified recipient search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search people, groups or paste an email…"
              value={recipientQuery}
              onChange={(e) => handleRecipientQueryChange(e.target.value)}
              onFocus={() => {
                setShowRecipientDropdown(recipientQuery.length >= 1);
                if (groups.length === 0 && !loadingGroups) loadGroups();
              }}
              onBlur={() => setTimeout(() => setShowRecipientDropdown(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (queryLooksLikeEmail) {
                    addRawEmail(recipientQuery.trim());
                    setRecipientQuery("");
                    setShowRecipientDropdown(false);
                  }
                }
              }}
            />
            {showRecipientDropdown && recipientQuery.length >= 1 && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-background border border-border rounded-xl shadow-lg w-full max-h-64 overflow-y-auto">
                {/* People */}
                {userResults.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b sticky top-0">
                      People
                    </div>
                    {userResults.map((u) => (
                      <button key={u.email} type="button" onMouseDown={() => addUserResult(u)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left transition-colors">
                        <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{u.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {/* Groups */}
                {(loadingGroups || filteredGroupsForSearch.length > 0) && (
                  <>
                    <div className={cn(
                      "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b sticky top-0",
                      userResults.length > 0 && "border-t",
                    )}>
                      Teams Groups
                    </div>
                    {loadingGroups ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading groups…
                      </div>
                    ) : (
                      filteredGroupsForSearch.slice(0, 6).map((g) => (
                        <button key={g.id} type="button" onMouseDown={() => addTeamsGroup(g)}
                          disabled={expandingGroup === g.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left transition-colors disabled:opacity-60">
                          <Users className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{g.name}</div>
                            {g.description && <div className="text-[11px] text-muted-foreground truncate">{g.description}</div>}
                            {expandingGroup === g.id && <div className="text-[11px] text-muted-foreground">Fetching members…</div>}
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}

                {/* Add raw email */}
                {queryLooksLikeEmail && (
                  <button type="button"
                    onMouseDown={() => { addRawEmail(recipientQuery.trim()); setRecipientQuery(""); setShowRecipientDropdown(false); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left transition-colors",
                      (userResults.length > 0 || filteredGroupsForSearch.length > 0) && "border-t",
                    )}>
                    <Mail className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="text-muted-foreground">Add <span className="font-medium text-foreground">{recipientQuery.trim()}</span></span>
                  </button>
                )}

                {/* No results */}
                {recipientQuery.length >= 2 && !loadingGroups && userResults.length === 0 && filteredGroupsForSearch.length === 0 && !queryLooksLikeEmail && (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No results found.</div>
                )}
              </div>
            )}
          </div>

          {/* Recipient pills */}
          {form.recipients_json.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {form.recipients_json.map((r, i) => (
                <RecipientPill key={i} r={r} onRemove={() => set("recipients_json", form.recipients_json.filter((_, j) => j !== i))} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No recipients added yet. Search above to add people or groups.</p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm px-3 py-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Automation"}
        </Button>
      </div>
    </form>
  );
}

// ── Catalog quick-start shelf ─────────────────────────────────────────────────

function CatalogShelf({
  portalId,
  accent,
  onSelect,
}: {
  portalId: string;
  accent: string;
  onSelect: (item: CatalogItem) => void;
}) {
  const items = getCatalogForPortal(portalId).filter((i) => i.portalIds.length > 0).slice(0, 4);
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const Icon = CATEGORY_ICONS[item.category] ?? Zap;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="group flex items-center gap-2.5 px-3 py-2 rounded-xl bg-muted/40 hover:bg-muted transition-all border border-border/50 hover:border-border"
            >
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 bg-background shadow-sm" style={{ color: item.accent }}>
                <Icon className="h-3 w-3" />
              </div>
              <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Rule Card ─────────────────────────────────────────────────────────────────

function HistoryDialog({
  ruleId,
  title,
  subtitle,
  userEmail,
  userRole,
  showRuleColumn,
  showCreatorColumn,
  onClose,
}: {
  ruleId?: number;
  title: string;
  subtitle: string;
  userEmail: string;
  userRole: string;
  showRuleColumn: boolean;
  showCreatorColumn: boolean;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<SendLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = ruleId != null ? `/api/automation/history?rule_id=${ruleId}` : "/api/automation/history";
        const res = await apiFetch(url, userEmail, userRole);
        if (!res.ok) throw new Error("Failed to load history");
        const data = await res.json();
        if (!cancelled) setLogs(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ruleId, userEmail, userRole]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> {title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <div className="space-y-2 py-1">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-6 flex items-center gap-2 justify-center">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-10 text-center">No sends recorded yet.</div>
          ) : (
            <Table paginate itemsPerPage={10}>
              <TableHeader>
                <TableRow>
                  <TableHead>Sent</TableHead>
                  {showRuleColumn && <TableHead>Automation</TableHead>}
                  {showCreatorColumn && <TableHead>Created By</TableHead>}
                  <TableHead>Triggered By</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDt(l.sent_at)}</TableCell>
                    {showRuleColumn && <TableCell className="text-xs font-medium max-w-[160px] truncate">{l.rule_name}</TableCell>}
                    {showCreatorColumn && <TableCell className="text-xs">{l.created_by}</TableCell>}
                    <TableCell className="text-xs">
                      {l.triggered_by === "manual" ? `Manual — ${l.triggered_by_email ?? "—"}` : "Scheduled"}
                    </TableCell>
                    <TableCell className="text-xs" title={l.recipients_json.join(", ")}>
                      {l.recipient_count > 0
                        ? `${l.recipient_count} recipient${l.recipient_count !== 1 ? "s" : ""}`
                        : (l.detail ?? "—")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge status={l.status} />
                        {l.status === "failed" && l.detail && (
                          <span className="text-[10px] text-muted-foreground max-w-[180px] truncate" title={l.detail}>{l.detail}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit,
  onSendNow,
  onManageCoOwners,
  onViewHistory,
  currentUserEmail,
}: {
  rule: AutomationRule;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSendNow: () => void;
  onManageCoOwners: () => void;
  onViewHistory: () => void;
  currentUserEmail: string;
}) {
  const canManage = rule.can_manage;
  const isCoOwner =
    !canManage &&
    (rule.co_owners_json ?? []).map((e) => e.toLowerCase()).includes(currentUserEmail.toLowerCase());
  const kindMeta = getCatalogItem(rule.automation_kind);
  const isCustom = !rule.automation_kind || rule.automation_kind === "custom_email";
  const KindIcon = kindMeta ? (CATEGORY_ICONS[kindMeta.category] ?? Zap) : Mail;

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
      <Card className={cn("transition-all", !rule.is_active && "opacity-60")}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: rule.is_active ? `${kindMeta?.accent ?? "#F59E0B"}18` : undefined }}
              >
                <KindIcon className="h-4 w-4" style={{ color: rule.is_active ? (kindMeta?.accent ?? "#F59E0B") : undefined }} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm text-foreground truncate">{rule.name}</h3>
                  {isCoOwner && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Eye className="h-3 w-3" /> Shared
                    </Badge>
                  )}
                </div>
                <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1.5 font-normal" style={{ borderColor: `${kindMeta?.accent ?? "#64748B"}40`, color: kindMeta?.accent ?? "#64748B" }}>
                  {kindMeta?.label ?? "Custom Email"}
                </Badge>
                {rule.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rule.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={rule.is_active ? "default" : "secondary"} className="text-[10px]">
                {rule.is_active ? "Active" : "Paused"}
              </Badge>
              {canManage && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggle} title={rule.is_active ? "Pause" : "Resume"}>
                  {rule.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>

          <Separator className="mb-3" />

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{describeCadence(rule)}</span></div>
            <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 flex-shrink-0" /><span>{recipientCount(rule.recipients_json)} recipient{recipientCount(rule.recipients_json) !== 1 ? "s" : ""}</span></div>
            {isCustom && rule.email_subject && (
              <div className="flex items-center gap-1.5 col-span-2"><Mail className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{rule.email_subject}</span></div>
            )}
            <div className="flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /><StatusBadge status={rule.last_status} /></div>
          </div>

          {(rule.co_owners_json ?? []).length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-3">
              <UserCheck className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
              <span>
                {(rule.co_owners_json ?? []).length} co-owner{(rule.co_owners_json ?? []).length !== 1 ? "s" : ""}
                {(rule.co_owners_json ?? []).length <= 2
                  ? `: ${(rule.co_owners_json ?? []).join(", ")}`
                  : `: ${(rule.co_owners_json ?? []).slice(0, 2).join(", ")} +${(rule.co_owners_json ?? []).length - 2} more`}
              </span>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground border-t pt-3">
            <div className="flex gap-3">
              <span>Next: <span className="text-foreground">{formatDt(rule.next_run)}</span></span>
              <span>Last: <span className="text-foreground">{formatDt(rule.last_run)}</span></span>
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2" onClick={onViewHistory}>
              <History className="h-3 w-3" /> History
            </Button>
          </div>

          {canManage && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onEdit}><Edit2 className="h-3 w-3" /> Edit</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={onSendNow}><Send className="h-3 w-3" /> Send Now</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50" onClick={onManageCoOwners}><UserCheck className="h-3 w-3" /> Co-owners</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5 ml-auto" onClick={onDelete}><Trash2 className="h-3 w-3" /> Delete</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AutomationHub({
  portalId,
  portalLabel,
  compact = false,
}: {
  portalId?: string;
  portalLabel?: string;
  compact?: boolean;
} = {}) {
  const { user } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(0);
  const [selectedKind, setSelectedKind] = useState<CatalogItem | null>(null);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [aiPreset, setAiPreset] = useState<Record<string, any> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AutomationRule | null>(null);
  const [coOwnerRule, setCoOwnerRule] = useState<AutomationRule | null>(null);
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const email = user?.email ?? "";
  const role = user?.role ?? "";
  const userCanCreate = canCreate(role);
  const isSuperAdmin = role.toLowerCase() === "super admin";
  const portalAccent = getCatalogForPortal(portalId).find(i => i.portalIds.length > 0)?.accent ?? "#F59E0B";

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/automation/rules", email, role);
      if (!res.ok) throw new Error("Failed to load");
      setRules(await res.json());
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }, [email, role]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function handleSave(formData: RuleFormState) {
    const body = JSON.stringify(formData);
    const res = editingRule
      ? await apiFetch(`/api/automation/rules/${editingRule.id}`, email, role, { method: "PATCH", body })
      : await apiFetch("/api/automation/rules", email, role, { method: "POST", body });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || (editingRule ? "Update failed" : "Create failed"));
    }
    closeWizard();
    showToast(editingRule ? "Automation updated." : "Automation created.");
    fetchRules();
  }

  async function handleToggle(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}`, email, role, { method: "PATCH", body: JSON.stringify({ is_active: !rule.is_active }) });
    if (res.ok) { showToast(rule.is_active ? "Paused." : "Resumed."); fetchRules(); }
    else showToast("Failed to update.", "error");
  }

  async function handleDelete(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}`, email, role, { method: "DELETE" });
    setDeleteConfirm(null);
    if (res.ok) { showToast("Deleted."); fetchRules(); }
    else showToast("Failed to delete.", "error");
  }

  async function handleSendNow(rule: AutomationRule) {
    const res = await apiFetch(`/api/automation/rules/${rule.id}/send-now`, email, role, { method: "POST", body: "{}" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) showToast(`Sent to ${data.sent_to?.length ?? 0} recipient(s).`);
    else showToast(data.detail || "Send failed.", "error");
  }

  function closeWizard() { setWizardStep(0); setSelectedKind(null); setEditingRule(null); setAiPreset(null); }

  function openNew() { setEditingRule(null); setSelectedKind(null); setAiPreset(null); setWizardStep(1); }
  function openNewWithKind(item: CatalogItem) { setEditingRule(null); setSelectedKind(item); setAiPreset(null); setWizardStep(2); }
  function openEdit(rule: AutomationRule) {
    const kind = getCatalogItem(rule.automation_kind) ?? getCatalogItem("custom_email")!;
    setEditingRule(rule); setSelectedKind(kind); setAiPreset(null); setWizardStep(2);
  }

  function handleAiResult(result: AiComposeResult) {
    const kind = getCatalogItem(result.automation_kind) ?? getCatalogItem("custom_email")!;
    setSelectedKind(kind);
    setAiPreset({
      name: result.name, description: result.description,
      frequency: result.frequency, day_of_week: result.day_of_week, day_of_month: result.day_of_month,
      hour: result.hour, minute: result.minute,
      automation_kind: result.automation_kind, extra_config: result.extra_config,
      email_subject: result.email_subject, email_body: result.email_body,
      recipients_json: [],
    });
    setWizardStep(2);
  }

  const showForm = wizardStep > 0;
  // wizardStep: 0=closed, 1=TypePicker, 2=ConfigureForm, 3=AiComposer
  const configInitial: RuleFormState = editingRule
    ? {
        name: editingRule.name, description: editingRule.description,
        frequency: editingRule.frequency, day_of_week: editingRule.day_of_week, day_of_month: editingRule.day_of_month,
        hour: editingRule.hour, minute: editingRule.minute ?? 0,
        automation_kind: editingRule.automation_kind ?? "custom_email",
        extra_config: editingRule.extra_config ?? {},
        email_subject: editingRule.email_subject ?? "", email_body: editingRule.email_body ?? "",
        recipients_json: editingRule.recipients_json,
      }
    : aiPreset
      ? (aiPreset as RuleFormState)
      : selectedKind
        ? blankFormFromKind(selectedKind, user?.email, user?.name)
        : blankFormFromKind(AUTOMATION_CATALOG.find((c) => c.id === "custom_email")!, user?.email, user?.name);

  const managedRules = rules.filter((r) => r.can_manage);
  const sharedRules = rules.filter((r) => !r.can_manage && (r.co_owners_json ?? []).map((e) => e.toLowerCase()).includes(email.toLowerCase()));

  return (
    <div className={cn("flex bg-muted/30 dark:bg-background", compact ? "flex-col flex-1 min-h-0" : "flex-col h-full")}>
      {/* Full-page header */}
      {!compact && (
        <div className="flex-shrink-0 bg-background border-b px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Smart recurring emails — reports, reminders, and digests powered by live data</p>
              </div>
            </div>
            {!showForm && (
              <div className="flex gap-2">
                {rules.length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAllHistory(true)}>
                    <History className="h-3.5 w-3.5" /> {isSuperAdmin ? "All Send History" : "Send History"}
                  </Button>
                )}
                {userCanCreate && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800/50 dark:text-violet-400" onClick={() => { setEditingRule(null); setSelectedKind(null); setAiPreset(null); setWizardStep(3); }}>
                      <Wand2 className="h-3.5 w-3.5" /> Ask AI
                    </Button>
                    <Button size="sm" onClick={openNew} className="gap-2 shadow-sm">
                      <Plus className="h-4 w-4" /> New Automation
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4 space-y-4">
          {/* Compact drawer header */}
          {compact && userCanCreate && !showForm && (
            <div className="flex justify-end mb-2">
              <Button size="sm" onClick={openNew} className="h-8 rounded-full shadow-sm gap-1.5 px-4 bg-foreground text-background hover:bg-foreground/90 transition-all">
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
          )}

          {/* Portal catalog shelf */}
          {!showForm && portalId && (
            <CatalogShelf portalId={portalId} accent={portalAccent} onSelect={openNewWithKind} />
          )}

          {/* Divider */}
          {!showForm && portalId && rules.length > 0 && (
            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">Your automations</span>
              <Separator className="flex-1" />
            </div>
          )}

          {/* Wizard */}
          <AnimatePresence>
            {showForm && (
              <motion.div
                key="wizard"
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                <div className="rounded-xl border border-border bg-background shadow-sm">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {wizardStep === 1 ? "Choose type" : wizardStep === 3 ? "AI Composer" : editingRule ? "Edit Automation" : "Configure"}
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={closeWizard}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="px-5 pb-5 pt-4">
                    {wizardStep === 3 && (
                      <AiComposer
                        portalId={portalId}
                        userEmail={email}
                        userRole={role}
                        onResult={handleAiResult}
                        onBack={() => setWizardStep(1)}
                        onCancel={closeWizard}
                      />
                    )}
                    {wizardStep === 1 && (
                      <TypePicker
                        portalId={portalId}
                        onSelect={(item) => { setSelectedKind(item); setWizardStep(2); }}
                        onCancel={closeWizard}
                        onAiCompose={() => setWizardStep(3)}
                      />
                    )}
                    {wizardStep === 2 && selectedKind && (
                      <ConfigureForm
                        key={`${editingRule?.id ?? "new"}-${selectedKind.id}`}
                        catalogItem={selectedKind}
                        initial={configInitial}
                        isEdit={!!editingRule}
                        onSave={handleSave}
                        onBack={() => { setWizardStep(1); setSelectedKind(null); }}
                        onCancel={closeWizard}
                        userEmail={email}
                        userRole={role}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Rule list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          ) : error ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
              </CardContent>
            </Card>
          ) : rules.length === 0 && !showForm ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-5 ring-1 ring-border/50 shadow-sm">
                <Zap className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <h3 className="text-base font-medium mb-1.5">{userCanCreate ? "No automations" : "No shared automations"}</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mb-6">
                {userCanCreate
                  ? "Set up a new automation to get started."
                  : "You don't have access to any automations yet."}
              </p>
              {userCanCreate && <Button size="sm" onClick={openNew} className="rounded-full shadow-sm gap-1.5 px-5 h-8"><Plus className="h-3.5 w-3.5" /> Create</Button>}
            </div>
          ) : (
            <div className="space-y-6">
              {managedRules.length > 0 && (
                <div>
                  {sharedRules.length > 0 && <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">My Automations</p>}
                  <div className={cn("grid grid-cols-1 gap-3", !compact && "sm:grid-cols-2 xl:grid-cols-3")}>
                    <AnimatePresence>
                      {managedRules.map((rule) => (
                        <RuleCard key={rule.id} rule={rule}
                          onToggle={() => handleToggle(rule)} onDelete={() => setDeleteConfirm(rule)}
                          onEdit={() => openEdit(rule)} onSendNow={() => handleSendNow(rule)}
                          onManageCoOwners={() => setCoOwnerRule(rule)} onViewHistory={() => setHistoryRule(rule)}
                          currentUserEmail={email}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
              {sharedRules.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Shared with Me
                  </p>
                  <div className={cn("grid grid-cols-1 gap-3", !compact && "sm:grid-cols-2 xl:grid-cols-3")}>
                    <AnimatePresence>
                      {sharedRules.map((rule) => (
                        <RuleCard key={rule.id} rule={rule}
                          onToggle={() => {}} onDelete={() => {}} onEdit={() => {}} onSendNow={() => {}} onManageCoOwners={() => {}}
                          onViewHistory={() => setHistoryRule(rule)}
                          currentUserEmail={email}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Co-owner dialog */}
      {coOwnerRule && (
        <CoOwnerDialog
          rule={coOwnerRule}
          userEmail={email}
          userRole={role}
          onClose={() => setCoOwnerRule(null)}
          onUpdated={(updated) => { setRules((p) => p.map((r) => (r.id === updated.id ? updated : r))); setCoOwnerRule(updated); }}
        />
      )}

      {/* Per-rule history dialog */}
      {historyRule && (
        <HistoryDialog
          ruleId={historyRule.id}
          title="Send History"
          subtitle={`Every send for "${historyRule.name}"`}
          userEmail={email}
          userRole={role}
          showRuleColumn={false}
          showCreatorColumn={false}
          onClose={() => setHistoryRule(null)}
        />
      )}

      {/* All-automations history dialog */}
      {showAllHistory && (
        <HistoryDialog
          title={isSuperAdmin ? "All Send History" : "Send History"}
          subtitle={
            isSuperAdmin
              ? "Every automation across the organization — who created it and what was sent."
              : "Automations you created or have access to."
          }
          userEmail={email}
          userRole={role}
          showRuleColumn
          showCreatorColumn={isSuperAdmin}
          onClose={() => setShowAllHistory(false)}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Automation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deleteConfirm?.name}</span> will be permanently removed.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.msg} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={cn(
              "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl shadow-lg text-sm font-medium border",
              toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800",
            )}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
