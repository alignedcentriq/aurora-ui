import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
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
  Pencil,
  Trash2,
  Key,
  Zap,
  BarChart2,
  AlertCircle,
  CheckCircle2,
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
};

const RESPONSE_MODE_LABELS: Record<string, string> = {
  passthrough: "Passthrough",
  template: "Template",
  agent: "Agent",
};

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
  const [usageLoading, setUsageLoading] = useState(false);
  const [tab, setTab] = useState("operations");

  // Dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
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
    } catch {
      setUsage([]);
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

  return (
    <div className="flex h-full min-h-[calc(100vh-64px)] bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <span className="font-semibold text-sm">Connectors</span>
          <div className="flex gap-1">
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
              onClick={() => setShowCreate(true)}
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
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{c.name}</span>
                {statusBadge(c.status)}
              </div>
              <span className="text-xs text-gray-400 font-mono">{c.slug}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <Globe className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Select a connector or create one</p>
            <p className="text-sm text-gray-400 mt-1">
              Import an OpenAPI spec, configure auth, and publish
            </p>
            <Button className="mt-6" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Connector
            </Button>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold">{selected.name}</h1>
                  {statusBadge(selected.status)}
                  <span className="text-xs text-gray-400">v{selected.version}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {selected.description || "No description"}
                </p>
                {selected.base_url && (
                  <p className="text-xs font-mono text-gray-400 mt-1">{selected.base_url}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAuth(true)}>
                  <Key className="h-3.5 w-3.5 mr-1.5" /> Auth
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
                            <span className="text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Confirm
                            </span>
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
                            <p className="font-mono text-xs text-gray-400">{op.path_template}</p>
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

              <TabsContent value="usage">
                {usageLoading ? (
                  <div className="space-y-2 py-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between">
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-medium text-gray-500">
                          <th className="pb-2 pr-4">Operation</th>
                          <th className="pb-2 pr-4 text-right">Calls</th>
                          <th className="pb-2 pr-4 text-right">Avg latency</th>
                          <th className="pb-2 pr-4 text-right">Success rate</th>
                          <th className="pb-2 text-right">Time saved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.map((u) => (
                          <tr
                            key={u.operation_id}
                            className="border-b border-gray-100 dark:border-gray-800"
                          >
                            <td className="py-2 pr-4 font-mono text-xs">{u.name}</td>
                            <td className="py-2 pr-4 text-right">{u.calls.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right">{u.avg_latency_ms}ms</td>
                            <td className="py-2 pr-4 text-right">
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
                            </td>
                            <td className="py-2 text-right font-medium text-blue-600">
                              {u.total_minutes_saved.toFixed(0)} min
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-sm">
                          <td className="pt-3">Total</td>
                          <td className="pt-3 text-right">
                            {usage.reduce((s, u) => s + u.calls, 0).toLocaleString()}
                          </td>
                          <td />
                          <td />
                          <td className="pt-3 text-right text-blue-600">
                            {usage.reduce((s, u) => s + u.total_minutes_saved, 0).toFixed(0)} min
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <CreateConnectorDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async (id) => {
          await fetchConnectors();
          await selectConnector(id);
          setShowImport(true);
        }}
      />

      {selected && (
        <>
          <AuthDialog
            connectorId={selected.id}
            open={showAuth}
            onClose={() => setShowAuth(false)}
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
        <div className="space-y-3">
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

function AuthDialog({
  connectorId,
  open,
  onClose,
}: {
  connectorId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [authType, setAuthType] = useState("api_key");
  const [config, setConfig] = useState("");
  const [saving, setSaving] = useState(false);

  const AUTH_TYPES = ["none", "api_key", "bearer", "basic", "oauth2"];

  const submit = async () => {
    setSaving(true);
    try {
      let parsed: any = {};
      if (config.trim() && authType !== "none") {
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
        body: JSON.stringify({ auth_type: authType, config: parsed }),
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
    oauth2: '{"access_token": "your-access-token"}',
    none: "",
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
        <div className="space-y-3">
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
          {authType !== "none" && (
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
        <div className="space-y-4">
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test: {op.name}</DialogTitle>
          <DialogDescription>{op.description || op.display_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
              <div className="flex items-center gap-2 mb-2 text-sm font-medium">
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
              <pre className="text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {result.ok ? result.text : result.error}
              </pre>
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
        <div className="space-y-3">
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
