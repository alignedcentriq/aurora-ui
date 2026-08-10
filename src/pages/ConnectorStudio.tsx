import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Plus,
  Loader2,
  RefreshCw,
  Upload,
  Play,
  Globe,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Trash2,
  Key,
  Users,
  HelpCircle,
  Zap,
  BarChart2,
  AlertCircle,
  CheckCircle2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  LayoutGrid,
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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartCanvas, type ChartSpec } from "@/components/analytics/ChartCanvas";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Connector {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  source_type: string;
  base_url: string | null;
  status: string;
  version: number;
  seeding_status?: string;
  created_by: string | null;
  created_at: string;
}

interface Operation {
  id: number;
  name: string;
  display_name: string | null;
  description: string | null;
  method: string | null;
  path_template: string | null;
  params_schema: any[] | null;
  requires_confirmation: boolean;
  minutes_saved: number;
  response_mode: string;
  enabled: boolean;
}

interface ConnectorDetail extends Connector {
  operations: Operation[];
}

interface UsageRow {
  operation_id: number;
  name: string;
  calls: number;
  avg_latency_ms: number;
  success_rate: number;
  total_minutes_saved: number;
}

interface DailyUsagePoint {
  date: string;
  calls: number;
  errors: number;
}
interface UsageErrorRow {
  message: string;
  count: number;
}
interface UsageTopUserRow {
  user_email: string;
  calls: number;
}
interface ConnectorOverviewRow {
  connector_id: number;
  name: string;
  status: string;
  calls: number;
  calls_last_7d: number;
  avg_latency_ms: number;
  success_rate: number | null;
  total_minutes_saved: number;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

// Title-case a raw status/value so user-facing text is consistently capitalized
// (the API returns lowercase tokens like "published", "draft", "disabled").
const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Friendly labels for the lowercase enum tokens stored in the DB. Anything not
// listed falls back to a title-cased version of the raw value.
const AUTH_TYPE_LABELS: Record<string, string> = {
  none: "None",
  api_key: "API Key",
  bearer: "Bearer Token",
  basic: "Basic Auth",
  oauth2: "OAuth 2.0",
  connected_account: "Sign-in (SSO)",
};

const RESPONSE_MODE_LABELS: Record<string, string> = {
  passthrough: "Passthrough",
  template: "Template",
  agent: "Agent",
};

// Turn a raw object key (snake_case / camelCase) into a human label for the
// readable result view — e.g. "first_name" → "First Name", "userId" → "User Id".
const prettifyKey = (k: string) =>
  k
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Recursively render any JSON value as a readable key/value tree. Used by the
// Test dialog's "Readable" view as an alternative to the raw JSON string.
function JsonView({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === null || value === undefined)
    return <span className="text-gray-400 italic">—</span>;
  if (typeof value === "boolean")
    return <span className="text-purple-600 dark:text-purple-400">{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
  if (typeof value === "string")
    return value ? (
      <span className="text-gray-800 dark:text-gray-200 break-words">{value}</span>
    ) : (
      <span className="text-gray-400 italic">—</span>
    );
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-400 italic">empty list</span>;
    return (
      <div className="space-y-1.5">
        {value.map((item, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-[11px] font-mono text-gray-400 mt-0.5 flex-shrink-0">
              {i + 1}.
            </span>
            <div className="flex-1 min-w-0">
              <JsonView value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-gray-400 italic">empty</span>;
    return (
      <div
        className={cn(
          "space-y-1",
          depth > 0 && "border-l border-gray-200 dark:border-gray-700 pl-3",
        )}
      >
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col sm:flex-row sm:gap-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 sm:min-w-[140px] sm:flex-shrink-0 break-words">
              {prettifyKey(k)}
            </span>
            <div className="flex-1 min-w-0 text-sm">
              <JsonView value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// Identity headers for the role-gated /api/admin/connectors endpoints.
// Populated by the component from the logged-in user; the backend trusts
// x-user-email / x-user-role (same pattern as every other admin page).
let authHeaders: Record<string, string> = {};

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConnectorStudio() {
  const { user } = useAuth();
  // Keep the module-level auth headers in sync with the logged-in user so every
  // apiFetch (and the spec-upload fetch) carries identity to the role-gated API.
  authHeaders = {
    "x-user-email": user?.email ?? "",
    "x-user-role": (user?.role ?? "").toLowerCase(),
  };
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ConnectorDetail | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [usageDaily, setUsageDaily] = useState<DailyUsagePoint[]>([]);
  const [usageErrors, setUsageErrors] = useState<UsageErrorRow[]>([]);
  const [usageTopUsers, setUsageTopUsers] = useState<UsageTopUserRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [tab, setTab] = useState("operations");

  // Dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [authHint, setAuthHint] = useState<{
    authType: string;
    authMode: string;
    fields: { key: string; label: string; secret: boolean }[];
    note: string;
  } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showScopes, setShowScopes] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTest, setShowTest] = useState<Operation | null>(null);
  const [showEditOp, setShowEditOp] = useState<Operation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Connector | null>(null);
  const [expandedOps, setExpandedOps] = useState<Set<number>>(new Set());

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/admin/connectors");
      setConnectors(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // Polling for seeding status
  useEffect(() => {
    if (!selected || selected.seeding_status !== "seeding") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 20) {
        clearInterval(interval);
        return;
      }
      try {
        const detail = await apiFetch(`/api/admin/connectors/${selected.id}`);
        // If status changed, update the UI and stop polling
        if (detail.seeding_status !== "seeding") {
          setSelected(detail);
          setConnectors((prev) =>
            prev.map((c) => (c.id === detail.id ? { ...c, seeding_status: detail.seeding_status } : c))
          );
          clearInterval(interval);
          if (detail.seeding_status === "seeded") {
            toast.success("Router seeding completed");
          } else if (detail.seeding_status === "failed") {
            toast.error("Router seeding failed");
          }
        }
      } catch (e) {
        // ignore fetch errors during polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [selected?.id, selected?.seeding_status]);

  const selectConnector = async (id: number) => {
    try {
      const detail = await apiFetch(`/api/admin/connectors/${id}`);
      setSelected(detail);
      setTab("operations");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const loadUsage = async (id: number) => {
    setUsageLoading(true);
    try {
      const data = await apiFetch(`/api/admin/connectors/${id}/usage`);
      setUsage(data.operations ?? []);
      setUsageDaily(data.daily ?? []);
      setUsageErrors(data.errors ?? []);
      setUsageTopUsers(data.top_users ?? []);
    } catch {
      setUsage([]);
      setUsageDaily([]);
      setUsageErrors([]);
      setUsageTopUsers([]);
    } finally {
      setUsageLoading(false);
    }
  };

  const handleTabChange = (t: string) => {
    setTab(t);
    if (t === "usage" && selected) loadUsage(selected.id);
  };

  const publish = async () => {
    if (!selected) return;
    try {
      const r = await apiFetch(`/api/admin/connectors/${selected.id}/publish`, { method: "POST" });
      toast.success(`Published — ${r.operations_seeded} operations seeded`);
      await fetchConnectors();
      await selectConnector(selected.id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const deleteConnector = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/admin/connectors/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Connector deleted");
      if (selected?.id === deleteTarget.id) setSelected(null);
      await fetchConnectors();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const toggleOp = (id: number) =>
    setExpandedOps((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const statusBadge = (s: string) => (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium",
        s === "published"
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : s === "disabled"
            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      )}
    >
      {titleCase(s)}
    </span>
  );

  const seedingIcon = (status?: string) => {
    if (status === "seeding") {
      return <span title="Seeding router..."><Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0" /></span>;
    }
    if (status === "seeded") {
      return <span title="Router ready"><CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /></span>;
    }
    if (status === "failed") {
      return <span title="Seeding failed — try re-publishing"><AlertCircle className="h-4 w-4 text-red-500 shrink-0" /></span>;
    }
    return null;
  };

  return (
    <div className="flex h-[calc(100dvh-64px)] overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className={cn(
        "w-full md:w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col",
        selected ? "hidden md:flex" : "flex"
      )}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border-b border-gray-200 dark:border-gray-800">
          <span className="font-semibold text-sm">Connectors</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowAnalytics(true)}
              title="Cross-connector analytics"
            >
              <BarChart2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowHelp(true)}
              title="How to use Connector Studio"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={fetchConnectors}
              disabled={loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowTemplates(true)}
              title="Browse connector templates"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowCreate(true)}
              title="New connector"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {connectors.length === 0 && !loading && (
            <p className="text-xs text-gray-400 p-4 text-center">No connectors yet</p>
          )}
          {connectors.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConnector(c.id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors",
                selected?.id === c.id && "bg-blue-50 dark:bg-blue-950/40",
              )}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <span className="text-sm font-medium truncate">{c.name}</span>
                <div className="flex items-center gap-2">
                  {seedingIcon(c.seeding_status)}
                  {statusBadge(c.status)}
                </div>
              </div>
              <span className="text-xs text-gray-400 font-mono">{c.slug}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className={cn(
        "flex-1 min-w-0 overflow-y-auto p-4 sm:p-6",
        selected ? "block" : "hidden md:block"
      )}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <Globe className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Select a connector or create one</p>
            <p className="text-sm text-gray-400 mt-1">
              Import an OpenAPI spec, configure auth, and publish
            </p>
            <div className="mt-6 flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowTemplates(true)}>
                <LayoutGrid className="h-4 w-4 mr-2" /> Browse Templates
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-2" /> New Connector
              </Button>
              <Button variant="outline" onClick={() => setShowHelp(true)}>
                <HelpCircle className="h-4 w-4 mr-2" /> How it works
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6 min-w-0">
              <div className="min-w-0 w-full lg:w-auto">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8 shrink-0"
                    onClick={() => setSelected(null)}
                    title="Back to list"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <h1 className="text-xl font-semibold truncate">{selected.name}</h1>
                  <div className="flex items-center gap-2">
                    {seedingIcon(selected.seeding_status)}
                    {statusBadge(selected.status)}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">v{selected.version}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1 break-words">
                  {selected.description || "No description"}
                </p>
                {selected.base_url && (
                  <p className="text-xs font-mono text-gray-400 mt-1 break-all">{selected.base_url}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button variant="outline" size="sm" onClick={() => setShowAuth(true)}>
                  <Key className="h-3.5 w-3.5 mr-1.5" /> Auth
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowScopes(true)}>
                  <Users className="h-3.5 w-3.5 mr-1.5" /> Access
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Import Spec
                </Button>
                {selected.status !== "published" ? (
                  <Button
                    size="sm"
                    onClick={publish}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" /> Publish
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={publish}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-publish
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => setDeleteTarget(selected)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={handleTabChange}>
              <TabsList className="mb-4">
                <TabsTrigger value="operations">
                  Operations ({selected.operations.length})
                </TabsTrigger>
                <TabsTrigger value="questions">Questions & Access</TabsTrigger>
                <TabsTrigger value="usage">Usage & ROI</TabsTrigger>
              </TabsList>

              <TabsContent value="operations">
                {selected.operations.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
                    <Upload className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">
                      No operations yet — import an OpenAPI spec to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selected.operations.map((op) => (
                      <div
                        key={op.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
                      >
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => toggleOp(op.id)}
                        >
                          {expandedOps.has(op.id) ? (
                            <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          )}
                          <span
                            className={cn(
                              "text-xs font-bold px-2 py-0.5 rounded",
                              op.method === "GET"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                : op.method === "POST"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : op.method === "DELETE"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                            )}
                          >
                            {op.method ?? "?"}
                          </span>
                          <span className="font-mono text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">
                            {op.name}
                          </span>
                          {op.requires_confirmation && (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-help"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <AlertCircle className="h-3 w-3" /> Confirm
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs text-xs">
                                  This is a write/mutating operation. When the AI agent wants to
                                  call it during chat, the user must explicitly approve it first —
                                  it will never fire automatically.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {!op.enabled && (
                            <span className="text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                              Disabled
                            </span>
                          )}
                          <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setShowTest(op)}
                              title="Test"
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setShowEditOp(op)}
                              title="Edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {expandedOps.has(op.id) && (
                          <div className="px-6 pb-4 border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
                            {op.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                {op.description}
                              </p>
                            )}
                             <p className="font-mono text-xs text-gray-400 break-all">{op.path_template}</p>
                            {op.params_schema && op.params_schema.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">Parameters</p>
                                <div className="flex flex-wrap gap-2">
                                  {op.params_schema.map((p: any, i: number) => (
                                    <span
                                      key={i}
                                      className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
                                    >
                                      {p.name}
                                      {p.required ? "*" : "?"}{" "}
                                      <span className="text-gray-400">({p.type})</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="flex gap-4 text-xs text-gray-500">
                              <span>
                                Response mode:{" "}
                                <strong className="text-gray-700 dark:text-gray-300">
                                  {RESPONSE_MODE_LABELS[op.response_mode] ??
                                    titleCase(op.response_mode)}
                                </strong>
                              </span>
                              <span>
                                Minutes saved:{" "}
                                <strong className="text-gray-700 dark:text-gray-300">
                                  {op.minutes_saved}
                                </strong>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="questions">
                <QuestionsTab connectorId={selected.id} />
              </TabsContent>

              <TabsContent value="usage">
                {usageLoading ? (
                  <div className="space-y-2 py-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    ))}
                  </div>
                ) : usage.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-12">No usage data yet</p>
                ) : (
                  <div className="space-y-6">
                    {usageDaily.length > 0 && (
                      <ChartCanvas
                        height={220}
                        spec={{
                          type: "composed",
                          title: "Calls — last 30 days",
                          data: usageDaily.map((d) => ({ date: d.date, Calls: d.calls, Errors: d.errors })),
                          x_key: "date",
                          y_keys: ["Calls", "Errors"],
                          colors: ["#6366f1", "#ef4444"],
                        } as ChartSpec}
                      />
                    )}
                    {(usageErrors.length > 0 || usageTopUsers.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {usageErrors.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm">Top errors</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-1.5 pt-0">
                              {usageErrors.map((e, i) => (
                                <div key={i} className="flex items-start justify-between gap-2 text-xs">
                                  <span className="text-gray-500 truncate">{e.message || "(no message)"}</span>
                                  <Badge variant="outline" className="shrink-0">{e.count}</Badge>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}
                        {usageTopUsers.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm">Top users</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-1.5 pt-0">
                              {usageTopUsers.map((u, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="text-gray-500 truncate">{u.user_email}</span>
                                  <Badge variant="outline" className="shrink-0">{u.calls}</Badge>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  <div className="flex justify-end mb-2">
                    <ExportCsvButton
                      rows={usage.map((u) => ({
                        Operation: u.name,
                        Calls: u.calls,
                        "Avg Latency (ms)": u.avg_latency_ms,
                        "Success Rate": `${(u.success_rate * 100).toFixed(1)}%`,
                        "Time Saved (min)": u.total_minutes_saved.toFixed(0),
                      }))}
                      filename="connector-operation-usage.csv"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <Table paginate itemsPerPage={10} className="w-full text-sm">
                      <TableHeader>
                        <TableRow className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-medium text-gray-500">
                          <TableHead className="pb-2 pr-4">Operation</TableHead>
                          <TableHead className="pb-2 pr-4 text-right">Calls</TableHead>
                          <TableHead className="pb-2 pr-4 text-right">Avg latency</TableHead>
                          <TableHead className="pb-2 pr-4 text-right">Success rate</TableHead>
                          <TableHead className="pb-2 text-right">Time saved</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.map((u) => (
                          <TableRow
                            key={u.operation_id}
                            className="border-b border-gray-100 dark:border-gray-800"
                          >
                            <TableCell className="py-2 pr-4 font-mono text-xs">{u.name}</TableCell>
                            <TableCell className="py-2 pr-4 text-right">{u.calls.toLocaleString()}</TableCell>
                            <TableCell className="py-2 pr-4 text-right">{u.avg_latency_ms}ms</TableCell>
                            <TableCell className="py-2 pr-4 text-right">
                              <span
                                className={cn(
                                  "font-medium",
                                  u.success_rate >= 0.95
                                    ? "text-green-600"
                                    : u.success_rate >= 0.8
                                      ? "text-yellow-600"
                                      : "text-red-600",
                                )}
                              >
                                {(u.success_rate * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="py-2 text-right font-medium text-blue-600">
                              {u.total_minutes_saved.toFixed(0)} min
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <tfoot>
                        <TableRow className="font-semibold text-sm">
                          <TableCell className="pt-3">Total</TableCell>
                          <TableCell className="pt-3 text-right">
                            {usage.reduce((s, u) => s + u.calls, 0).toLocaleString()}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="pt-3 text-right text-blue-600">
                            {usage.reduce((s, u) => s + u.total_minutes_saved, 0).toFixed(0)} min
                          </TableCell>
                        </TableRow>
                      </tfoot>
                    </Table>
                  </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />

      <CreateConnectorDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async (id) => {
          await fetchConnectors();
          await selectConnector(id);
          setShowImport(true);
        }}
      />

      <TemplateGalleryDialog
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onInstalled={async (id, hint) => {
          await fetchConnectors();
          await selectConnector(id);
          setAuthHint(hint);
          setShowAuth(true);
        }}
      />

      <AnalyticsOverviewDialog open={showAnalytics} onClose={() => setShowAnalytics(false)} />

      {selected && (
        <>
          <AuthDialog
            connectorId={selected.id}
            open={showAuth}
            onClose={() => {
              setShowAuth(false);
              setAuthHint(null);
            }}
            hint={authHint}
          />
          <AccessDialog
            connectorId={selected.id}
            connectorName={selected.name}
            open={showScopes}
            onClose={() => setShowScopes(false)}
          />
          <ImportSpecDialog
            connectorId={selected.id}
            open={showImport}
            onClose={() => setShowImport(false)}
            onImported={() => selectConnector(selected.id)}
          />
        </>
      )}

      {showTest && selected && (
        <TestOpDialog
          op={showTest}
          connectorId={selected.id}
          open={!!showTest}
          onClose={() => setShowTest(null)}
        />
      )}

      {showEditOp && selected && (
        <EditOpDialog
          op={showEditOp}
          connectorId={selected.id}
          open={!!showEditOp}
          onClose={() => setShowEditOp(null)}
          onSaved={() => selectConnector(selected.id)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connector?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its
              operations, auth config, and router utterances. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteConnector} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-dialogs ─────────────────────────────────────────────────────────────

function CreateConnectorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    base_url: "",
    source_type: "openapi",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.slug || !form.name) {
      toast.error("Slug and name are required");
      return;
    }
    setSaving(true);
    try {
      const r = await apiFetch("/api/admin/connectors", {
        method: "POST",
        body: JSON.stringify(form),
      });
      toast.success("Connector created");
      onClose();
      onCreated(r.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Connector</DialogTitle>
          <DialogDescription>Create a connector to start importing operations.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Slug *</label>
            <Input
              className="mt-1 font-mono text-sm"
              placeholder="zoho_people"
              value={form.slug}
              onChange={(e) =>
                setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "_") }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Name *</label>
            <Input
              className="mt-1"
              placeholder="Zoho People"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Base URL</label>
            <Input
              className="mt-1 font-mono text-sm"
              placeholder="https://people.zoho.com"
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <Textarea
              className="mt-1 text-sm"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template gallery ────────────────────────────────────────────────────────

interface TemplateSummary {
  key: string;
  name: string;
  category: string;
  description: string;
  base_url_hint: string;
  auth_type: string;
  provider?: string | null;
  note: string;
  operation_count: number;
  operations: { name: string; display_name: string | null; method: string }[];
}

function TemplateGalleryDialog({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: (id: number, hint: AuthHint) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<TemplateSummary | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", base_url: "" });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setLoading(true);
    apiFetch("/api/admin/connectors/templates")
      .then(setTemplates)
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const pick = (t: TemplateSummary) => {
    setPicked(t);
    setForm({ slug: t.key, name: t.name, base_url: t.base_url_hint });
  };

  const install = async () => {
    if (!picked) return;
    if (!form.slug.trim()) {
      toast.error("Slug is required");
      return;
    }
    setInstalling(true);
    try {
      const r = await apiFetch(`/api/admin/connectors/templates/${picked.key}/install`, {
        method: "POST",
        body: JSON.stringify({
          slug: form.slug,
          name: form.name || undefined,
          base_url: form.base_url || undefined,
        }),
      });
      toast.success(`${picked.name} installed — add credentials to finish setup`);
      onClose();
      onInstalled(r.id, {
        authType: r.auth_type,
        authMode: r.auth_mode,
        fields: r.auth_fields,
        provider: r.provider,
        note: r.note,
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {picked && (
              <Button variant="ghost" size="icon" className="h-6 w-6 -ml-1.5" onClick={() => setPicked(null)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {picked ? `Install ${picked.name}` : "Connector Templates"}
          </DialogTitle>
          <DialogDescription>
            {picked
              ? "Review the curated operations below, then create the connector. You'll add real credentials next."
              : "Start from a curated, popular API instead of building a connector from scratch."}
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="max-h-[60dvh] overflow-y-auto pr-1">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">No templates available</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((t) => (
                  <button key={t.key} onClick={() => pick(t)} className="text-left">
                    <Card className="h-full hover:border-blue-400 dark:hover:border-blue-600 transition-colors cursor-pointer">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm">{t.name}</CardTitle>
                          <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                        </div>
                        <CardDescription className="text-xs">{t.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-[11px] text-gray-400">
                          {t.operation_count} operation{t.operation_count !== 1 ? "s" : ""} ·{" "}
                          {AUTH_TYPE_LABELS[t.auth_type] ?? titleCase(t.auth_type)}
                        </p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Slug *</label>
              <Input
                className="mt-1 font-mono text-sm"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Name</label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Base URL</label>
              <Input
                className="mt-1 font-mono text-sm"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
            </div>
            {picked.note && (
              <p className="rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 px-2.5 py-2 text-[11px] text-blue-700 dark:text-blue-300">
                {picked.note}
              </p>
            )}
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Included operations</p>
              <div className="space-y-1">
                {picked.operations.map((o) => (
                  <div key={o.name} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-[10px] font-mono">{o.method}</Badge>
                    <span>{o.display_name || o.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={installing}>
            Cancel
          </Button>
          {picked && (
            <Button onClick={install} disabled={installing}>
              {installing && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cross-connector analytics dialog ────────────────────────────────────────

function successRateColor(rate: number | null): string {
  if (rate === null) return "text-gray-400";
  if (rate >= 0.95) return "text-green-600";
  if (rate >= 0.8) return "text-yellow-600";
  return "text-red-600";
}

function AnalyticsOverviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ConnectorOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch("/api/admin/connectors/analytics/overview")
      .then((data) => setRows(data.connectors ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      minutes: acc.minutes + r.total_minutes_saved,
    }),
    { calls: 0, minutes: 0 },
  );
  const active = rows.filter((r) => r.calls > 0);
  const avgSuccess = active.length
    ? active.reduce((s, r) => s + (r.success_rate ?? 0), 0) / active.length
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Connector Analytics</DialogTitle>
          <DialogDescription>
            Which connectors are actually earning their keep — across all published and draft connectors.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No connector usage yet</p>
        ) : (
          <div className="space-y-4 max-h-[65dvh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500">Connectors</p>
                  <p className="text-xl font-semibold">{rows.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500">Total calls</p>
                  <p className="text-xl font-semibold">{totals.calls.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500">Avg success rate</p>
                  <p className={cn("text-xl font-semibold", successRateColor(avgSuccess))}>
                    {avgSuccess === null ? "—" : `${(avgSuccess * 100).toFixed(1)}%`}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500">Time saved</p>
                  <p className="text-xl font-semibold text-blue-600">{totals.minutes.toFixed(0)} min</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end mb-2">
              <ExportCsvButton
                rows={rows.map((r) => ({
                  Connector: r.name,
                  Status: titleCase(r.status),
                  Calls: r.calls,
                  "Calls (7d)": r.calls_last_7d,
                  "Avg Latency (ms)": r.avg_latency_ms,
                  "Success Rate": r.success_rate === null ? "" : `${(r.success_rate * 100).toFixed(1)}%`,
                  "Time Saved (min)": r.total_minutes_saved.toFixed(0),
                }))}
                filename="connector-analytics-overview.csv"
              />
            </div>
            <div className="overflow-x-auto">
              <Table className="w-full text-sm">
                <TableHeader>
                  <TableRow className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-medium text-gray-500">
                    <TableHead className="pb-2 pr-4">Connector</TableHead>
                    <TableHead className="pb-2 pr-4">Status</TableHead>
                    <TableHead className="pb-2 pr-4 text-right">Calls</TableHead>
                    <TableHead className="pb-2 pr-4 text-right">Calls (7d)</TableHead>
                    <TableHead className="pb-2 pr-4 text-right">Avg latency</TableHead>
                    <TableHead className="pb-2 pr-4 text-right">Success rate</TableHead>
                    <TableHead className="pb-2 text-right">Time saved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.connector_id} className="border-b border-gray-100 dark:border-gray-800">
                      <TableCell className="py-2 pr-4 font-medium">{r.name}</TableCell>
                      <TableCell className="py-2 pr-4">
                        <Badge variant={r.status === "published" ? "default" : "secondary"} className="text-[10px]">
                          {titleCase(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 pr-4 text-right">{r.calls.toLocaleString()}</TableCell>
                      <TableCell className="py-2 pr-4 text-right">{r.calls_last_7d.toLocaleString()}</TableCell>
                      <TableCell className="py-2 pr-4 text-right">{r.avg_latency_ms}ms</TableCell>
                      <TableCell className="py-2 pr-4 text-right">
                        <span className={cn("font-medium", successRateColor(r.success_rate))}>
                          {r.success_rate === null ? "—" : `${(r.success_rate * 100).toFixed(1)}%`}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-right font-medium text-blue-600">
                        {r.total_minutes_saved.toFixed(0)} min
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Questions & Access tab ──────────────────────────────────────────────────

interface RouterExampleRow {
  id: number;
  utterance: string;
  operation_id: number | null;
  is_active: boolean;
  source: string;
}
interface QOperation {
  id: number;
  name: string;
  display_name: string | null;
  allowed_roles: string[];
}
interface AppRoleOpt {
  slug: string;
  name: string;
}

// How each RouterExample got there — shown as a chip on every question.
const SOURCE_LABELS: Record<string, string> = {
  connector: "AI-generated",
  manual: "Manual",
  feedback: "Learned",
  kw: "Keyword",
  seed: "Default",
  prompt: "Prompt",
};

/** Popover multi-select of app-roles. Empty selection = everyone. */
function RoleMultiSelect({
  roles,
  selected,
  onChange,
}: {
  roles: AppRoleOpt[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" />
          {selected.length === 0 ? "Everyone" : `${selected.length} role${selected.length > 1 ? "s" : ""}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="start">
        <p className="px-1 pb-1.5 text-[11px] text-muted-foreground">
          Pick who can get answers. Empty = everyone with access.
        </p>
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {roles.length === 0 && (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">No roles defined.</p>
          )}
          {roles.map((r) => (
            <label
              key={r.slug}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={selected.includes(r.slug)}
                onCheckedChange={() => toggle(r.slug)}
              />
              <span className="truncate">{r.name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuestionsTab({ connectorId }: { connectorId: number }) {
  const [ops, setOps] = useState<QOperation[]>([]);
  const [examples, setExamples] = useState<RouterExampleRow[]>([]);
  const [roles, setRoles] = useState<AppRoleOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [reseeding, setReseeding] = useState(false);
  const [seedingStatus, setSeedingStatus] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, rolesData] = await Promise.all([
        apiFetch(`/api/admin/connectors/${connectorId}/router-examples`),
        apiFetch(`/api/access/roles`).catch(() => []),
      ]);
      setOps(data.operations ?? []);
      setExamples(data.examples ?? []);
      setSeedingStatus(data.seeding_status ?? "");
      const rlist = Array.isArray(rolesData) ? rolesData : (rolesData.roles ?? []);
      setRoles(rlist.map((r: any) => ({ slug: r.slug, name: r.name ?? r.slug })));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => {
    load();
  }, [load]);

  const setRolesForOp = async (opId: number, next: string[]) => {
    setOps((prev) => prev.map((o) => (o.id === opId ? { ...o, allowed_roles: next } : o)));
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/operations/${opId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roles: next }),
      });
    } catch (e: any) {
      toast.error(e.message);
      load();
    }
  };

  const toggleActive = async (ex: RouterExampleRow) => {
    setExamples((prev) => prev.map((e) => (e.id === ex.id ? { ...e, is_active: !e.is_active } : e)));
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/router-examples/${ex.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !ex.is_active }),
      });
    } catch (e: any) {
      toast.error(e.message);
      load();
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const text = editing.text.trim();
    const orig = examples.find((e) => e.id === editing.id);
    if (!text || text === orig?.utterance) {
      setEditing(null);
      return;
    }
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/router-examples/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ utterance: text }),
      });
      setExamples((prev) => prev.map((e) => (e.id === editing.id ? { ...e, utterance: text } : e)));
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeExample = async (id: number) => {
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/router-examples/${id}`, {
        method: "DELETE",
      });
      setExamples((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const addExample = async (opId: number) => {
    const text = (draft[opId] || "").trim();
    if (!text) return;
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/router-examples`, {
        method: "POST",
        body: JSON.stringify({ utterance: text, operation_id: opId }),
      });
      setDraft((d) => ({ ...d, [opId]: "" }));
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reseed = async () => {
    setReseeding(true);
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/reseed`, { method: "POST" });
      setSeedingStatus("seeding");
      toast.success("Regenerating questions — this runs in the background. Refresh in a moment.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReseeding(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const byOp = (opId: number) => examples.filter((e) => e.operation_id === opId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Questions that route users to this connector — <strong>AI-generated</strong> when you
          publish (or Regenerate), plus any you add. Edit, disable, or add phrasings, and set which
          roles can get answers.
        </p>
        <div className="flex items-center gap-2">
          {seedingStatus === "seeding" && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Seeding
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={reseed} disabled={reseeding} className="h-8 gap-1.5">
            {reseeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Regenerate
          </Button>
        </div>
      </div>

      {ops.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <MessageSquareText className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No operations yet — import a spec first.</p>
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {ops.map((op) => {
            const rows = byOp(op.id);
            return (
              <AccordionItem
                key={op.id}
                value={String(op.id)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-0"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex flex-1 items-center gap-2.5 pr-2 text-left">
                    <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-sm text-foreground">{op.display_name || op.name}</span>
                    <Badge variant="secondary" className="ml-1">
                      {rows.length} {rows.length === 1 ? "question" : "questions"}
                    </Badge>
                    <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {op.allowed_roles.length === 0
                        ? "Everyone"
                        : `${op.allowed_roles.length} role${op.allowed_roles.length > 1 ? "s" : ""}`}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>Who can get answers</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {op.allowed_roles.map((r) => (
                        <Badge key={r} variant="outline" className="text-[11px]">
                          {roles.find((x) => x.slug === r)?.name ?? r}
                        </Badge>
                      ))}
                      <RoleMultiSelect
                        roles={roles}
                        selected={op.allowed_roles}
                        onChange={(next) => setRolesForOp(op.id, next)}
                      />
                    </div>
                  </div>

                  <Separator className="mb-3" />

                  <div className="space-y-1.5">
                    {rows.length === 0 && (
                      <p className="py-2 text-xs text-muted-foreground">
                        No questions yet — add one below or click Regenerate.
                      </p>
                    )}
                    {rows.map((ex) => (
                      <div
                        key={ex.id}
                        className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-gray-200 dark:hover:border-gray-700"
                      >
                        {editing?.id === ex.id ? (
                          <>
                            <Input
                              autoFocus
                              value={editing.text}
                              onChange={(e) => setEditing({ id: ex.id, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="h-8 text-sm"
                            />
                            <Button size="sm" className="h-7" onClick={saveEdit}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <span
                              className={cn(
                                "flex-1 text-sm",
                                ex.is_active ? "text-foreground" : "text-muted-foreground line-through",
                              )}
                            >
                              {ex.utterance}
                            </span>
                            <Badge
                              variant={ex.source === "connector" ? "secondary" : "outline"}
                              className="gap-1 text-[10px]"
                            >
                              {ex.source === "connector" && <Sparkles className="h-2.5 w-2.5" />}
                              {SOURCE_LABELS[ex.source] ?? ex.source}
                            </Badge>
                            <Switch
                              checked={ex.is_active}
                              onCheckedChange={() => toggleActive(ex)}
                              className="scale-90"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100"
                              onClick={() => setEditing({ id: ex.id, text: ex.utterance })}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 opacity-0 group-hover:opacity-100"
                              onClick={() => removeExample(ex.id)}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      placeholder="Add a question users might ask…"
                      value={draft[op.id] || ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [op.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && addExample(op.id)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => addExample(op.id)}
                      disabled={!(draft[op.id] || "").trim()}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

interface AuthHint {
  authType: string;
  authMode: string;
  fields: { key: string; label: string; secret: boolean }[];
  provider?: string | null;
  note: string;
}

function AuthDialog({
  connectorId,
  open,
  onClose,
  hint,
}: {
  connectorId: number;
  open: boolean;
  onClose: () => void;
  hint?: AuthHint | null;
}) {
  const [authType, setAuthType] = useState("api_key");
  const [authMode, setAuthMode] = useState("service");
  const [provider, setProvider] = useState("microsoft");
  const [config, setConfig] = useState("");
  const [saving, setSaving] = useState(false);

  // A just-installed template pre-selects its auth type + shows which JSON keys
  // to fill in — the admin only has to paste real secrets, not guess the shape.
  useEffect(() => {
    if (open && hint) {
      setAuthType(hint.authType);
      setAuthMode(hint.authMode);
      if (hint.authType === "connected_account" && hint.provider) {
        setProvider(hint.provider);
      }
      if (hint.fields.length) {
        const example: Record<string, string> = {};
        hint.fields.forEach((f) => {
          example[f.key] = f.secret ? `your-${f.key}` : "";
        });
        setConfig(JSON.stringify(example, null, 2));
      }
    }
  }, [open, hint]);

  const AUTH_TYPES = ["none", "api_key", "bearer", "basic", "oauth2", "connected_account"];

  const submit = async () => {
    setSaving(true);
    try {
      let parsed: any = {};
      // connected_account is inherently per-user SSO — the admin only picks the provider.
      let effectiveMode = authMode;
      if (authType === "connected_account") {
        parsed = { provider };
        effectiveMode = "per_user";
      } else if (config.trim() && authType !== "none" && authMode === "service") {
        // In per-user mode, each user supplies their own credential later — the admin
        // only sets the auth type here, so no service-level config is required.
        try {
          parsed = JSON.parse(config);
        } catch {
          toast.error("Config must be valid JSON");
          setSaving(false);
          return;
        }
      }
      await apiFetch(`/api/admin/connectors/${connectorId}/auth`, {
        method: "PUT",
        body: JSON.stringify({ auth_type: authType, auth_mode: effectiveMode, config: parsed }),
      });
      toast.success("Auth saved");
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const placeholders: Record<string, string> = {
    api_key: '{"api_key": "your-key", "header_name": "X-Api-Key"}',
    bearer: '{"token": "your-bearer-token"}',
    basic: '{"username": "user", "password": "pass"}',
    oauth2:
      '{"token_url": "https://.../oauth/token", "client_id": "...", "client_secret": "...", "refresh_token": "...", "scope": "..."}',
    none: "",
    connected_account: "",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure Auth</DialogTitle>
          <DialogDescription>
            Secrets are Fernet-encrypted at rest. Write-only — existing values are not shown.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
          {hint?.note && (
            <p className="rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 px-2.5 py-2 text-[11px] text-blue-700 dark:text-blue-300">
              {hint.note}
            </p>
          )}
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Auth Type
            </label>
            <select
              className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
            >
              {AUTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AUTH_TYPE_LABELS[t] ?? titleCase(t)}
                </option>
              ))}
            </select>
          </div>
          {authType === "connected_account" && (
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                SSO Provider
              </label>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="microsoft">Microsoft 365</option>
                <option value="zoho">Zoho</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Each user signs in with their own {provider === "zoho" ? "Zoho" : "Microsoft"} account
                (one-click, no token to paste). Tokens refresh automatically.
              </p>
            </div>
          )}
          {authType !== "none" && authType !== "connected_account" && (
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Credential ownership
              </label>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value)}
              >
                <option value="service">Use one shared token (you provide it)</option>
                <option value="per_user">Each user connects their own account</option>
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {authMode === "service"
                  ? "Everyone with access calls the API under the token you enter below."
                  : "Users are prompted to link their own credential the first time they use it — you don't enter a token here."}
              </p>
            </div>
          )}
          {authType !== "none" && authType !== "connected_account" && authMode === "service" && (
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Config (JSON)
              </label>
              <Textarea
                className="mt-1 font-mono text-xs"
                rows={4}
                placeholder={placeholders[authType]}
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
              {authType === "oauth2" && (
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Provide a refresh_token (+ client_id/secret + token_url) and the access token is
                  refreshed automatically. A bare access_token also works but will expire.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save Auth
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// In-app user guide. Kept in sync with docs/connector-studio-guide.md.
const GUIDE_MD = `
Connect any app or service (Zoho, a vendor tool, an internal portal) to the AI assistant
— **without any coding**. Once connected, the assistant can use it to answer questions and
take actions for your team.

> You're a Super Admin, so you can set this up here. Once a connector is **published**,
> everyone (or the people you choose under **Access**) can use it just by chatting — they
> don't need this screen.

## What you'll need

1. **An "API description" file** for the service — an *OpenAPI spec*, a \`.json\` or
   \`.yaml\` file. It's the menu of things the service can do.
2. **The website address** of the service (e.g. \`https://people.zoho.com\`).
3. **A login credential** (API key, token, or username/password) — unless it's public.

### How to get the API description file

You almost never write this yourself:

- **Ask the service directly** — many publish it at \`https://theservice.com/openapi.json\`
  or \`/swagger.json\`. Open it in a browser and save the file.
- **Check the service's docs/developer page** — search for "OpenAPI" or "Swagger".
- **Export from Postman** — *Export → OpenAPI 3.0*.
- **Ask the vendor or your IT team** if you can't find it.

## Step by step

1. **Create the connector** (＋ in the sidebar): Name, Slug, Base URL, Description.
2. **Import Spec** — upload the \`.json\`/\`.yaml\`. It auto-lists every action.
3. **Auth** — choose the credential type and paste the key/token. Secrets are encrypted
   and hidden after saving.
4. **Tidy actions** (pencil icon) — improve descriptions, turn on *Requires confirmation*
   for anything that changes data, set *Minutes saved*, disable actions you don't want.
5. **Test** (play icon) — run an action with sample values before exposing it.
6. **Access** — pick **Everyone** (default) or **Restricted** by role, department, or specific people.
7. **Publish** — within ~30 seconds the assistant can use these actions.
8. **Usage & ROI tab** — track calls, latency, success rate, and time saved.

## Who can use a connector (Access)

| Choice | What it means |
|---|---|
| **Everyone** | Any user in the company can use it (default). |
| **Restricted → Roles** | Only the roles you pick (e.g. HR, Manager, IT). |
| **Restricted → Departments** | Only the departments you list (e.g. Engineering). |
| **Restricted → Specific users** | Only the named people you add (search by name/email). |

A person gets access if they match **any** one of your selections. This only controls who
can *use* it in chat — editing here stays Super-Admin only.

## If something isn't working

- **Import found 0 actions** — the file may not be a valid OpenAPI/Swagger file.
- **Test shows 401/403** — the login isn't set or is wrong; re-open **Auth**.
- **Assistant never uses it** — make sure it's *published*, the action is *enabled*, and
  the description clearly says what it does.
- **Changes don't show up** — click **Re-publish** to apply immediately.
- **Right people can't use it** — check **Access** matches their role/department.
`;

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>How to use Connector Studio</DialogTitle>
          <DialogDescription>
            Connect a service to the assistant — no coding required.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto pr-2 prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{GUIDE_MD}</ReactMarkdown>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Roles recognized by the backend (app/auth.py VALID_ROLES), minus super_admin
// (super admins see everything anyway). Stored lowercase to match scope matching.
const SCOPE_ROLES: { value: string; label: string }[] = [
  { value: "employee", label: "Employee" },
  { value: "manager", label: "Manager" },
  { value: "functional manager", label: "Functional Manager" },
  { value: "hr", label: "HR" },
  { value: "it", label: "IT" },
  { value: "pmo", label: "PMO" },
  { value: "admin", label: "Admin" },
];

function AccessDialog({
  connectorId,
  connectorName,
  open,
  onClose,
}: {
  connectorId: number;
  connectorName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"global" | "restricted">("global");
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [deptInput, setDeptInput] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<{ name: string; email: string }[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current access rules whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setUserQuery("");
    setUserResults([]);
    apiFetch(`/api/admin/connectors/${connectorId}/scopes`)
      .then((d) => {
        setMode(d.mode === "restricted" ? "restricted" : "global");
        setRoles(new Set((d.roles ?? []).map((r: string) => r.toLowerCase())));
        setDepartments(d.departments ?? []);
        setUserEmails((d.user_emails ?? []).map((e: string) => e.toLowerCase()));
      })
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open, connectorId]);

  // Debounced employee search for the "specific user" picker.
  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    setSearchingUsers(true);
    const t = setTimeout(() => {
      apiFetch(`/api/admin/connectors/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => setUserResults(r ?? []))
        .catch(() => setUserResults([]))
        .finally(() => setSearchingUsers(false));
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery]);

  const addUser = (email: string) => {
    const e = email.trim().toLowerCase();
    if (e && !userEmails.includes(e)) setUserEmails((arr) => [...arr, e]);
    setUserQuery("");
    setUserResults([]);
  };

  const toggleRole = (value: string) =>
    setRoles((prev) => {
      const s = new Set(prev);
      s.has(value) ? s.delete(value) : s.add(value);
      return s;
    });

  const addDept = () => {
    const v = deptInput.trim();
    if (v && !departments.includes(v)) setDepartments((d) => [...d, v]);
    setDeptInput("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const body =
        mode === "global"
          ? { roles: [], departments: [], persona_ids: [], user_emails: [] }
          : {
              roles: Array.from(roles),
              departments,
              persona_ids: [],
              user_emails: userEmails,
            };
      if (
        mode === "restricted" &&
        body.roles.length === 0 &&
        body.departments.length === 0 &&
        body.user_emails.length === 0
      ) {
        toast.error("Pick at least one role, department, or user — or choose Everyone.");
        setSaving(false);
        return;
      }
      const r = await apiFetch(`/api/admin/connectors/${connectorId}/scopes`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      toast.success(r.mode === "global" ? "Now visible to everyone" : "Access restricted");
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Who can use {connectorName}?</DialogTitle>
          <DialogDescription>
            Choose who sees this connector's tools in the assistant. This does not affect who
            can edit it here (that stays Super Admin only).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-4 max-h-[60dvh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === "global"}
                  onChange={() => setMode("global")}
                />
                <span>
                  <span className="text-sm font-medium">Everyone</span>
                  <span className="block text-xs text-gray-500">
                    All users can use this connector (default).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === "restricted"}
                  onChange={() => setMode("restricted")}
                />
                <span>
                  <span className="text-sm font-medium">Restricted</span>
                  <span className="block text-xs text-gray-500">
                    Only matching roles, departments, or specific users.
                  </span>
                </span>
              </label>
            </div>

            {mode === "restricted" && (
              <div className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Roles
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SCOPE_ROLES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => toggleRole(r.value)}
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full border transition-colors",
                          roles.has(r.value)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300",
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Departments
                  </p>
                  <div className="flex gap-2">
                    <Input
                      className="text-sm"
                      placeholder="e.g. Engineering"
                      value={deptInput}
                      onChange={(e) => setDeptInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addDept();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addDept}>
                      Add
                    </Button>
                  </div>
                  {departments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {departments.map((d) => (
                        <span
                          key={d}
                          className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full flex items-center gap-1"
                        >
                          {d}
                          <button
                            type="button"
                            onClick={() => setDepartments((arr) => arr.filter((x) => x !== d))}
                            className="text-gray-400 hover:text-red-500"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Specific users
                  </p>
                  <div className="relative">
                    <Input
                      className="text-sm"
                      placeholder="Search by name or email…"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                    />
                    {userQuery.trim().length >= 2 && (
                      <div className="absolute z-10 mt-1 w-full max-h-44 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                        {searchingUsers ? (
                          <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                          </div>
                        ) : userResults.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
                        ) : (
                          userResults.map((u) => (
                            <button
                              key={u.email}
                              type="button"
                              onClick={() => addUser(u.email)}
                              disabled={userEmails.includes(u.email.toLowerCase())}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <span className="font-medium">{u.name}</span>
                              <span className="block text-xs text-gray-400 font-mono">{u.email}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {userEmails.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {userEmails.map((em) => (
                        <span
                          key={em}
                          className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono"
                        >
                          {em}
                          <button
                            type="button"
                            onClick={() => setUserEmails((arr) => arr.filter((x) => x !== em))}
                            className="text-gray-400 hover:text-red-500"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  A user gets access if they match <strong>any</strong> selected role, department, or
                  are listed as a specific user.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSpecDialog({
  connectorId,
  open,
  onClose,
  onImported,
}: {
  connectorId: number;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; operations: string[] } | null>(null);

  const submit = async () => {
    if (!file) {
      toast.error("Select a file first");
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/connectors/${connectorId}/import-spec`, {
        method: "POST",
        body: fd,
        // No Content-Type: the browser sets the multipart boundary itself.
        headers: { ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? res.statusText);
      }
      const r = await res.json();
      setResult(r);
      toast.success(`Imported ${r.imported} operations`);
      onImported();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setResult(null);
          setFile(null);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import OpenAPI Spec</DialogTitle>
          <DialogDescription>
            Upload a JSON or YAML OpenAPI 2/3 spec to extract operations automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60dvh] overflow-y-auto pr-1">
          <div
            className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => document.getElementById("spec-file-input")?.click()}
          >
            <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {file ? file.name : "Click to upload openapi.json / openapi.yaml"}
            </p>
            <input
              id="spec-file-input"
              type="file"
              accept=".json,.yaml,.yml"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {result && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  {result.imported} operations imported
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {result.operations.map((op) => (
                  <span
                    key={op}
                    className="text-xs font-mono bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700 px-2 py-0.5 rounded"
                  >
                    {op}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={submit} disabled={!file || importing}>
            {importing && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestOpDialog({
  op,
  connectorId,
  open,
  onClose,
}: {
  op: Operation;
  connectorId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"readable" | "json">("readable");

  // The parsed response body for the readable/pretty views. Prefer the structured
  // `data` the executor returns; fall back to parsing the (possibly trimmed) text.
  const parsedData = (() => {
    if (!result?.ok) return null;
    if (result.data !== undefined && result.data !== null) return result.data;
    try {
      return JSON.parse(result.text);
    } catch {
      return result.text;
    }
  })();
  const prettyJson = (() => {
    if (parsedData === null) return result?.text ?? "";
    if (typeof parsedData === "string") return parsedData;
    try {
      return JSON.stringify(parsedData, null, 2);
    } catch {
      return result?.text ?? "";
    }
  })();

  const run = async () => {
    let parsed: any = {};
    try {
      parsed = JSON.parse(args);
    } catch {
      toast.error("Args must be valid JSON");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const r = await apiFetch(`/api/admin/connectors/${connectorId}/operations/${op.id}/test`, {
        method: "POST",
        body: JSON.stringify({ args: parsed }),
      });
      setResult(r);
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setResult(null);
        }
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-2xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Test: {op.name}</DialogTitle>
          <DialogDescription>{op.description || op.display_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
          {op.params_schema && op.params_schema.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Expected parameters</p>
              <div className="flex flex-wrap gap-1.5">
                {op.params_schema.map((p: any, i: number) => (
                  <span
                    key={i}
                    className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
                  >
                    {p.name}
                    {p.required ? "*" : "?"} <span className="text-gray-400">({p.type})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Args (JSON)
            </label>
            <Textarea
              className="mt-1 font-mono text-xs"
              rows={4}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </div>
          {result && (
            <div
              className={cn(
                "rounded-lg border p-3",
                result.ok
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
                  : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700",
              )}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-2 mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {result.ok ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-green-700 dark:text-green-400">
                        Success ({result.latency_ms}ms)
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <span className="text-red-700 dark:text-red-400">Error</span>
                    </>
                  )}
                </div>
                {result.ok && (
                  <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
                    {(["readable", "json"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setView(m)}
                        className={cn(
                          "px-2.5 py-1 transition-colors",
                          view === m
                            ? "bg-green-600 text-white"
                            : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800",
                        )}
                      >
                        {m === "readable" ? "Readable" : "Raw JSON"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!result.ok ? (
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-48 sm:max-h-80 overflow-y-auto">
                  {result.error}
                </pre>
              ) : view === "json" ? (
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-64 sm:max-h-96 overflow-auto bg-white/60 dark:bg-black/20 rounded p-2">
                  {prettyJson}
                </pre>
              ) : (
                <div className="max-h-64 sm:max-h-96 overflow-auto bg-white/60 dark:bg-black/20 rounded p-2">
                  <JsonView value={parsedData} />
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={run} disabled={running}>
            {running ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-2" />
            )}
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditOpDialog({
  op,
  connectorId,
  open,
  onClose,
  onSaved,
}: {
  op: Operation;
  connectorId: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    display_name: op.display_name ?? "",
    description: op.description ?? "",
    minutes_saved: String(op.minutes_saved ?? 0),
    requires_confirmation: op.requires_confirmation,
    response_mode: op.response_mode ?? "passthrough",
    enabled: op.enabled,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/connectors/${connectorId}/operations/${op.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          minutes_saved: parseFloat(form.minutes_saved) || 0,
        }),
      });
      toast.success("Operation updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit: {op.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Display Name
            </label>
            <Input
              className="mt-1"
              value={form.display_name}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <Textarea
              className="mt-1 text-sm"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Minutes saved per use
              </label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.5"
                value={form.minutes_saved}
                onChange={(e) => setForm((f) => ({ ...f, minutes_saved: e.target.value }))}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Response mode
              </label>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
                value={form.response_mode}
                onChange={(e) => setForm((f) => ({ ...f, response_mode: e.target.value }))}
              >
                {["passthrough", "template", "agent"].map((m) => (
                  <option key={m} value={m}>
                    {RESPONSE_MODE_LABELS[m] ?? titleCase(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.requires_confirmation}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requires_confirmation: e.target.checked }))
                }
              />
              Requires confirmation
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Enabled
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
