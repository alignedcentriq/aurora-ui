import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  Search,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  Loader2,
  Info,
  Plus,
  ChevronRight,
  Users,
  Lock,
  Globe,
  Zap,
  Layers,
  Save,
  Edit2,
  X,
  Check,
  Menu,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CapabilityAction {
  id: string;
  label: string;
  description: string;
}
interface Capability {
  key: string;
  label: string;
  description: string;
  category: "portal" | "mode" | "feature";
  actions: CapabilityAction[];
}
interface AppRole {
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string | null;
  capabilities: string[];
  capability_count: number;
}
interface UserAccess {
  email: string;
  name: string | null;
  job_title: string | null;
  department: string | null;
  has_override: boolean;
  assigned_role: string | null;
  scopes: string[];
  extra_capabilities: string[];
  granted_by: string | null;
  granted_at: string | null;
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

const SYSTEM_COLORS: Record<string, string> = {
  employee: "#64748b",
  hr: "#22C55E",
  it: "#14B8A6",
  pmo: "#4F6FEF",
  admin: "#3B8FE8",
  "functional manager": "#10B981",
  "super admin": "#F59E0B",
};

function roleColor(role: AppRole) {
  return role.color ?? SYSTEM_COLORS[role.slug] ?? "#6366F1";
}

function hexToTailwind(hex: string | null) {
  return { backgroundColor: hex ?? "#6366F1" + "22", color: hex ?? "#6366F1" };
}

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(" ");
    return (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "");
  }
  return email[0]?.toUpperCase() ?? "?";
}

// ── Category icons ─────────────────────────────────────────────────────────────
const CAT_ICON: Record<string, React.FC<{ className?: string }>> = {
  portal: Globe,
  mode: Zap,
  feature: Layers,
};
const CAT_LABEL: Record<string, string> = {
  portal: "Portals",
  mode: "Focus Modes",
  feature: "Features",
};

// ── Colour palette for new roles ───────────────────────────────────────────────
const PALETTE = [
  "#6366F1", "#8B5CF6", "#EC4899", "#14B8A6", "#10B981",
  "#F59E0B", "#EF4444", "#3B82F6", "#06B6D4", "#84CC16",
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AccessManagement() {
  const { user } = useAuth();

  // Data
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [users, setUsers] = useState<UserAccess[]>([]);

  // UI state
  const [panel, setPanel] = useState<"roles" | "users">("roles");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);
  const [roleCapsDraft, setRoleCapsDraft] = useState<Set<string>>(new Set());
  const [roleDirty, setRoleDirty] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  // User panel
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [editUser, setEditUser] = useState<UserAccess | null>(null);
  const [editRole, setEditRole] = useState<string>("employee");
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editExtra, setEditExtra] = useState<string[]>([]);
  const [savingUser, setSavingUser] = useState(false);
  const [revokingUser, setRevokingUser] = useState(false);

  // Create role dialog
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleSlug, setNewRoleSlug] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [newRoleColor, setNewRoleColor] = useState(PALETTE[0]);
  const [creatingRole, setCreatingRole] = useState(false);

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const headers = useMemo(() => ({
    "x-user-email": user?.email ?? "",
    "x-user-role": "super admin",
    "Content-Type": "application/json",
  }), [user?.email]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/access/roles", { headers });
      if (res.ok) setRoles(await res.json());
    } catch { }
  }, [headers]);

  const loadCapabilities = useCallback(async () => {
    try {
      const res = await fetch("/api/access/capabilities", { headers });
      if (res.ok) setCapabilities(await res.json());
    } catch { }
  }, [headers]);

  const loadUsers = useCallback(async (q = "", role = "") => {
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (role) params.set("role", role);
      const qs = params.toString();
      const url = qs ? `/api/access/users?${qs}` : "/api/access/users";
      const res = await fetch(url, { headers });
      if (res.ok) setUsers(await res.json());
    } catch { }
    setLoadingUsers(false);
  }, [headers]);

  useEffect(() => {
    loadRoles();
    loadCapabilities();
  }, [loadRoles, loadCapabilities]);

  useEffect(() => {
    if (panel === "users") loadUsers(userSearch, roleFilter);
  }, [panel, loadUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => { if (panel === "users") loadUsers(userSearch, roleFilter); }, 300);
    return () => clearTimeout(t);
  }, [userSearch, roleFilter, panel, loadUsers]);

  // Copilot sidebar navigation:
  //   panel="roles" + role → switch to Roles tab and select that role
  //   panel="users" + role → switch to Users tab and filter by role
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panel?: string; role?: string }>).detail;
      if (detail.panel === "roles" && detail.role) {
        setPanel("roles");
        const slug = detail.role.toLowerCase();
        // roles state may not be populated yet if user lands here fresh; wait one tick
        setRoles((prev) => {
          const match = prev.find(
            (r) => r.slug.toLowerCase() === slug || r.name.toLowerCase() === slug,
          );
          if (match) selectRole(match);
          return prev;
        });
      } else if (detail.panel === "users") {
        setPanel("users");
        setRoleFilter(detail.role ?? "");
        setUserSearch("");
        loadUsers("", detail.role ?? "");
      }
    };
    window.addEventListener("centriq:access-filter", handler);
    return () => window.removeEventListener("centriq:access-filter", handler);
  }, [loadUsers, selectRole]);

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Role editor ────────────────────────────────────────────────────────────

  function selectRole(role: AppRole) {
    setSelectedRole(role);
    setRoleCapsDraft(new Set(role.capabilities));
    setRoleDirty(false);
  }

  function toggleCap(key: string) {
    setRoleCapsDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setRoleDirty(true);
  }

  async function saveRoleCapabilities() {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      const res = await fetch(`/api/access/roles/${encodeURIComponent(selectedRole.slug)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ capabilities: Array.from(roleCapsDraft) }),
      });
      if (res.ok) {
        showToast(`${selectedRole.name} capabilities saved.`, true);
        setRoleDirty(false);
        await loadRoles();
        // refresh selected role data
        const updated = await fetch("/api/access/roles", { headers });
        if (updated.ok) {
          const all: AppRole[] = await updated.json();
          const r = all.find((x) => x.slug === selectedRole.slug);
          if (r) { setSelectedRole(r); setRoleCapsDraft(new Set(r.capabilities)); }
          setRoles(all);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to save capabilities.", false);
      }
    } catch { showToast("Network error", false); }
    setSavingRole(false);
  }

  // ── Create role ────────────────────────────────────────────────────────────

  async function createRole() {
    if (!newRoleName.trim()) return;
    setCreatingRole(true);
    const slug = newRoleSlug.trim() || newRoleName.toLowerCase().replace(/\s+/g, "_");
    try {
      const res = await fetch("/api/access/roles", {
        method: "POST",
        headers,
        body: JSON.stringify({ slug, name: newRoleName.trim(), description: newRoleDesc.trim(), color: newRoleColor }),
      });
      if (res.ok) {
        showToast(`Role '${newRoleName}' created.`, true);
        setShowCreateRole(false);
        setNewRoleName(""); setNewRoleSlug(""); setNewRoleDesc(""); setNewRoleColor(PALETTE[0]);
        await loadRoles();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to create role.", false);
      }
    } catch { showToast("Network error", false); }
    setCreatingRole(false);
  }

  async function deleteRole(role: AppRole) {
    if (role.is_system) return;
    if (!confirm(`Delete role '${role.name}'? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/access/roles/${encodeURIComponent(role.slug)}`, {
        method: "DELETE", headers,
      });
      if (res.ok) {
        showToast(`Role '${role.name}' deleted.`, true);
        if (selectedRole?.slug === role.slug) setSelectedRole(null);
        await loadRoles();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to delete role.", false);
      }
    } catch { showToast("Network error", false); }
  }

  // ── User editor ────────────────────────────────────────────────────────────

  function openEditUser(u: UserAccess) {
    setEditUser(u);
    setEditRole(u.assigned_role ?? "employee");
    setEditScopes(u.scopes ?? []);
    setEditExtra(u.extra_capabilities ?? []);
  }

  function closeEditUser() {
    setEditUser(null);
    setEditRole("employee");
    setEditScopes([]);
    setEditExtra([]);
  }

  async function saveUser() {
    if (!editUser) return;
    setSavingUser(true);
    try {
      const res = await fetch(`/api/access/users/${encodeURIComponent(editUser.email)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ role: editRole, scopes: editScopes, extra_capabilities: editExtra }),
      });
      if (res.ok) {
        showToast(`Role '${editRole}' assigned to ${editUser.name ?? editUser.email}`, true);
        closeEditUser();
        loadUsers(userSearch);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to assign role", false);
      }
    } catch { showToast("Network error", false); }
    setSavingUser(false);
  }

  async function revokeUser() {
    if (!editUser) return;
    setRevokingUser(true);
    try {
      const res = await fetch(`/api/access/users/${encodeURIComponent(editUser.email)}`, {
        method: "DELETE", headers,
      });
      if (res.ok) {
        showToast(`Override removed for ${editUser.name ?? editUser.email}`, true);
        closeEditUser();
        loadUsers(userSearch);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to revoke", false);
      }
    } catch { showToast("Network error", false); }
    setRevokingUser(false);
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const systemRoles = useMemo(() => roles.filter((r) => r.is_system), [roles]);
  const customRoles = useMemo(() => roles.filter((r) => !r.is_system), [roles]);

  const capsByCategory = useMemo(() => {
    const map: Record<string, Capability[]> = { portal: [], mode: [], feature: [] };
    for (const cap of capabilities) map[cap.category]?.push(cap);
    return map;
  }, [capabilities]);

  // Feature caps that belong to the currently edited user's role (for scope restriction)
  const roleFeatureCaps = useMemo(() => {
    if (!editUser && !editRole) return [];
    const role = roles.find((r) => r.slug === editRole);
    return (role?.capabilities ?? []).filter((k) => {
      const cap = capabilities.find((c) => c.key === k);
      return cap?.category === "feature";
    });
  }, [editRole, roles, capabilities, editUser]);

  const overriddenCount = useMemo(() => users.filter((u) => u.has_override).length, [users]);

  const filteredUsers = useMemo(() => {
    if (!roleFilter) return users;
    const norm = roleFilter.toLowerCase();
    return users.filter((u) => u.assigned_role?.toLowerCase() === norm);
  }, [users, roleFilter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Plain JSX variable instead of an inline component — an inline component
  // re-creates its identity on every render, causing React to unmount/remount
  // the subtree and steal focus from the search input on each keystroke.
  const sidebarContent = (
    <>
      <Tabs value={panel} onValueChange={(v) => setPanel(v as "roles" | "users")} className="w-full flex-none">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-auto">
          <TabsTrigger value="roles" className="flex-1 rounded-none border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-foreground py-3 text-xs font-medium transition-colors">
            <Lock className="h-3.5 w-3.5 mr-1.5" /> Roles
          </TabsTrigger>
          <TabsTrigger value="users" className="flex-1 rounded-none border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-foreground py-3 text-xs font-medium transition-colors relative">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Users
            {overriddenCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] px-1.5 py-0 leading-4">{overriddenCount}</span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className="flex-1 min-h-0">
        {panel === "roles" && (
          <div className="flex flex-col gap-1 p-3">
            <p className="px-2 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System Roles</p>
            {systemRoles.map((role) => (
              <RoleSidebarItem key={role.slug} role={role} selected={selectedRole?.slug === role.slug} onClick={() => { selectRole(role); setIsMobileMenuOpen(false); }} />
            ))}
            {customRoles.length > 0 && (
              <>
                <p className="px-2 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom Roles</p>
                {customRoles.map((role) => (
                  <RoleSidebarItem key={role.slug} role={role} selected={selectedRole?.slug === role.slug} onClick={() => { selectRole(role); setIsMobileMenuOpen(false); }} onDelete={() => deleteRole(role)} />
                ))}
              </>
            )}
            <button onClick={() => setShowCreateRole(true)} className="mt-4 mx-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Role
            </button>
          </div>
        )}
        {panel === "users" && (
          <div className="p-3">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search…" className="pl-8 h-8 text-xs bg-muted/50" />
            </div>
            {roleFilter && (
              <div className="flex items-center gap-1.5 mb-2">
                <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium px-2 py-0.5 border border-amber-200 dark:border-amber-800/40 max-w-[calc(100%-28px)] truncate">
                  <Shield className="h-2.5 w-2.5 flex-shrink-0" />
                  <span className="truncate capitalize">{roleFilter}</span>
                </span>
                <button onClick={() => { setRoleFilter(""); loadUsers(""); }} className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Clear role filter">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {loadingUsers ? (
              <div className="flex items-center justify-center h-20 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {roleFilter ? `No users with the "${roleFilter}" role found.` : "No users found."}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredUsers.map((u) => (
                  <button key={u.email} onClick={() => { openEditUser(u); setIsMobileMenuOpen(false); }} className={cn("w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-colors", editUser?.email === u.email ? "bg-primary/10 text-foreground" : "hover:bg-muted/60 text-foreground")}>
                    <Avatar className="h-7 w-7 border border-primary/10">
                      <AvatarFallback className="bg-primary/10 text-[10px] text-primary font-semibold">{initials(u.name, u.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{u.name ?? u.email}</div>
                      {u.has_override && <div className="text-[10px] text-amber-600 dark:text-amber-400 truncate mt-0.5 font-medium">{u.assigned_role}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-none px-4 md:px-6 py-4 border-b border-border flex items-center gap-3 bg-card z-10 shadow-sm">
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="md:hidden shrink-0 h-8 w-8">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 flex flex-col bg-card">
            {sidebarContent}
          </SheetContent>
        </Sheet>
        <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 shadow-inner">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground leading-tight tracking-tight">Access Management</h1>
          <p className="text-[11px] text-muted-foreground hidden sm:block mt-0.5">
            Create roles, assign capabilities, and manage per-user access overrides.
          </p>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* ── Left sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-64 flex-none hidden md:flex flex-col border-r border-border bg-muted/10">
          {sidebarContent}
        </aside>

        {/* ── Main content area ─────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {panel === "roles" && !selectedRole && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Lock className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Select a role to manage its capabilities</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Or create a custom role using the button in the sidebar
              </p>
            </div>
          )}

          {panel === "roles" && selectedRole && (
            <RoleCapabilityEditor
              role={selectedRole}
              capsDraft={roleCapsDraft}
              capsByCategory={capsByCategory}
              dirty={roleDirty}
              saving={savingRole}
              onToggleCap={toggleCap}
              onSetCaps={(newCaps) => { setRoleCapsDraft(newCaps); setRoleDirty(true); }}
              onSave={saveRoleCapabilities}
              onDiscard={() => { setRoleCapsDraft(new Set(selectedRole.capabilities)); setRoleDirty(false); }}
            />
          )}

          {panel === "users" && !editUser && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Select a user to manage their access</p>
            </div>
          )}

          {panel === "users" && editUser && (
            <UserAccessEditor
              editUser={editUser}
              roles={roles}
              capabilities={capabilities}
              capsByCategory={capsByCategory}
              roleFeatureCaps={roleFeatureCaps}
              editRole={editRole}
              editScopes={editScopes}
              editExtra={editExtra}
              saving={savingUser}
              revoking={revokingUser}
              onRoleChange={(r) => { setEditRole(r); setEditScopes([]); }}
              onScopesChange={setEditScopes}
              onExtraChange={setEditExtra}
              onSave={saveUser}
              onRevoke={revokeUser}
              onClose={closeEditUser}
              headers={headers}
            />
          )}
        </main>
      </div>

      {/* Create Role Dialog */}
      <Dialog open={showCreateRole} onOpenChange={(o) => !o && setShowCreateRole(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Create Custom Role
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Role Name *</label>
              <Input
                value={newRoleName}
                onChange={(e) => {
                  setNewRoleName(e.target.value);
                  setNewRoleSlug(e.target.value.toLowerCase().replace(/\s+/g, "_"));
                }}
                placeholder="e.g. DevOps Lead"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Slug (auto-generated)</label>
              <Input
                value={newRoleSlug}
                onChange={(e) => setNewRoleSlug(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder="e.g. devops_lead"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Used as the role identifier. Lowercase, underscores only.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Description</label>
              <Input
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                placeholder="What does this role do?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Colour</label>
              <div className="flex gap-2 flex-wrap">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewRoleColor(c)}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform",
                      newRoleColor === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2">
              <div className="h-5 w-5 rounded-full flex-shrink-0" style={{ backgroundColor: newRoleColor }} />
              <span className="text-xs font-medium">{newRoleName || "Role Name"}</span>
              <span className="text-xs text-muted-foreground ml-auto">{newRoleSlug || "slug"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateRole(false)} disabled={creatingRole}>
              Cancel
            </Button>
            <Button size="sm" onClick={createRole} disabled={!newRoleName.trim() || creatingRole}>
              {creatingRole && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm font-medium",
            toast.ok ? "bg-green-600 text-white" : "bg-destructive text-destructive-foreground",
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Role sidebar item ──────────────────────────────────────────────────────────

function RoleSidebarItem({
  role,
  selected,
  onClick,
  onDelete,
}: {
  role: AppRole;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const color = roleColor(role);
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors",
        selected ? "bg-primary/10 text-foreground" : "hover:bg-muted/60 text-foreground",
      )}
      onClick={onClick}
    >
      <div
        className="h-2 w-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 text-xs font-medium truncate">{role.name}</span>
      <span className="text-[10px] text-muted-foreground flex-shrink-0">{role.capability_count}</span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="hidden group-hover:flex items-center justify-center h-4 w-4 rounded text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Role capability editor ─────────────────────────────────────────────────────

function RoleCapabilityEditor({
  role,
  capsDraft,
  capsByCategory,
  dirty,
  saving,
  onToggleCap,
  onSetCaps,
  onSave,
  onDiscard,
}: {
  role: AppRole;
  capsDraft: Set<string>;
  capsByCategory: Record<string, Capability[]>;
  dirty: boolean;
  saving: boolean;
  onToggleCap: (key: string) => void;
  onSetCaps: (newCaps: Set<string>) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const color = roleColor(role);
  const categories: Array<"portal" | "mode" | "feature"> = ["portal", "mode", "feature"];

  return (
    <Card className="flex flex-col flex-1 min-h-0 border-0 rounded-none shadow-none bg-transparent">
      {/* Role header */}
      <div className="flex-none px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="h-8 w-8 rounded-full flex-shrink-0" style={{ backgroundColor: color + "33" }}>
          <div className="h-full w-full rounded-full flex items-center justify-center">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{role.name}</h2>
            {role.is_system && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">System</Badge>
            )}
          </div>
          {role.description && (
            <p className="text-xs text-muted-foreground truncate">{role.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <>
              <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving} className="h-7 text-xs">
                Discard
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving} className="h-7 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save
              </Button>
            </>
          )}
          {!dirty && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-500" />
              {capsDraft.size} capabilities
            </div>
          )}
        </div>
      </div>

      {/* flex-1 h-0: forces flex-basis to 0 so overflow-y-auto gets a bounded height */}
      <div className="flex-1 h-0 overflow-y-auto">
        <div className="px-6 py-4 space-y-6">
          {role.slug === "super admin" && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-4 py-3">
              <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <span className="font-semibold">Super Admin</span> has unrestricted access to all portals, modes, and features — capability assignments don't apply.
              </p>
            </div>
          )}

          {categories.map((cat) => {
            const caps = capsByCategory[cat] ?? [];
            if (!caps.length) return null;
            const Icon = CAT_ICON[cat];
            const selectedCount = caps.filter((c) => capsDraft.has(c.key)).length;

            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">{CAT_LABEL[cat]}</h3>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {selectedCount} / {caps.length} enabled
                  </span>
                  <button
                    type="button"
                    className="text-[10px] ml-2 font-medium text-primary hover:underline"
                    disabled={role.slug === "super admin"}
                    onClick={() => {
                      const next = new Set(capsDraft);
                      const allSelected = selectedCount === caps.length;
                      for (const c of caps) {
                        if (allSelected) next.delete(c.key);
                        else next.add(c.key);
                      }
                      onSetCaps(next);
                    }}
                  >
                    {selectedCount === caps.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {cat === "feature" ? (
                  <div className="space-y-2">
                    {caps.map((cap) => (
                      <FeatureCapabilityRow
                        key={cap.key}
                        cap={cap}
                        enabled={capsDraft.has(cap.key)}
                        disabled={role.slug === "super admin"}
                        onToggle={() => onToggleCap(cap.key)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {caps.map((cap) => (
                      <button
                        key={cap.key}
                        onClick={() => role.slug !== "super admin" && onToggleCap(cap.key)}
                        disabled={role.slug === "super admin"}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
                          capsDraft.has(cap.key)
                            ? "border-primary/40 bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/20 hover:bg-muted/40",
                          role.slug === "super admin" && "opacity-40 cursor-not-allowed",
                        )}
                      >
                        <div className={cn(
                          "h-4 w-4 rounded flex-shrink-0 mt-0.5 flex items-center justify-center border",
                          capsDraft.has(cap.key)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border",
                        )}>
                          {capsDraft.has(cap.key) && <Check className="h-2.5 w-2.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium leading-tight">{cap.label}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">
                            {cap.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function FeatureCapabilityRow({
  cap,
  enabled,
  disabled,
  onToggle,
}: {
  cap: Capability;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        enabled ? "border-primary/30 bg-primary/5" : "border-border",
        disabled && "opacity-40",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{cap.label}</p>
          <p className="text-[10px] text-muted-foreground">{cap.description}</p>
        </div>
        <label className="flex items-center gap-1.5 ml-3 shrink-0 cursor-pointer">
          <Checkbox
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">Enable</span>
        </label>
      </div>
      {cap.actions.length > 1 && enabled && (
        <div className="border-t border-border/60 px-3 py-1.5 flex flex-wrap gap-2 bg-muted/10">
          {cap.actions.map((a) => (
            <span
              key={a.id}
              title={a.description}
              className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
            >
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── User access editor ─────────────────────────────────────────────────────────

function UserAccessEditor({
  editUser,
  roles,
  capabilities,
  capsByCategory,
  roleFeatureCaps,
  editRole,
  editScopes,
  editExtra,
  saving,
  revoking,
  onRoleChange,
  onScopesChange,
  onExtraChange,
  onSave,
  onRevoke,
  onClose,
  headers,
}: {
  editUser: UserAccess;
  roles: AppRole[];
  capabilities: Capability[];
  capsByCategory: Record<string, Capability[]>;
  roleFeatureCaps: string[];
  editRole: string;
  editScopes: string[];
  editExtra: string[];
  saving: boolean;
  revoking: boolean;
  onRoleChange: (r: string) => void;
  onScopesChange: (s: string[]) => void;
  onExtraChange: (e: string[]) => void;
  onSave: () => void;
  onRevoke: () => void;
  onClose: () => void;
  headers: Record<string, string>;
}) {
  const currentRole = roles.find((r) => r.slug === editRole);
  const roleCaps = new Set(currentRole?.capabilities ?? []);

  function toggleExtra(key: string) {
    onExtraChange(
      editExtra.includes(key) ? editExtra.filter((k) => k !== key) : [...editExtra, key],
    );
  }

  // Build scope toggle helpers (same as old UI)
  const featureCaps = capabilities.filter(
    (c) => c.category === "feature" && roleFeatureCaps.includes(c.key),
  );

  function toggleScope(capKey: string) {
    const hasFull = editScopes.includes(capKey);
    if (hasFull) {
      onScopesChange(editScopes.filter((s) => s !== capKey && !s.startsWith(`${capKey}:`)));
    } else {
      onScopesChange([...editScopes.filter((s) => !s.startsWith(`${capKey}:`)), capKey]);
    }
  }

  return (
    <Card className="flex flex-col flex-1 min-h-0 border-0 rounded-none shadow-none bg-transparent">
      {/* User header */}
      <div className="flex-none px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0">
          {initials(editUser.name, editUser.email)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-foreground">{editUser.name ?? editUser.email}</div>
          <div className="text-xs text-muted-foreground truncate">{editUser.email}</div>
          {editUser.job_title && <div className="text-xs text-muted-foreground">{editUser.job_title}</div>}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 h-0 overflow-y-auto">
        <div className="px-6 py-4 space-y-6">
          {/* Role assignment */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Assigned Role</label>
            <Select value={editRole} onValueChange={onRoleChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.slug} value={r.slug}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: roleColor(r) }} />
                      {r.name}
                      {r.is_system && <span className="text-[10px] text-muted-foreground ml-1">(system)</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editRole === "super admin" && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">Highest privilege.</span> Super Admin has full platform access.
                </p>
              </div>
            )}
          </div>

          {/* Scope restrictions — limit what role features this user can access */}
          {featureCaps.length > 0 && (
            <div className="space-y-3">
              <div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <label className="text-sm font-semibold text-foreground">Feature Scope Restrictions</label>
                  <button
                    type="button"
                    className="text-[10px] font-medium text-primary hover:underline"
                    onClick={() => {
                      const allSelected = featureCaps.every(c => editScopes.includes(c.key));
                      if (allSelected) {
                        onScopesChange(editScopes.filter(e => !featureCaps.some(c => c.key === e)));
                      } else {
                        const newScopes = [...editScopes];
                        featureCaps.forEach(c => {
                          if (!newScopes.includes(c.key)) newScopes.push(c.key);
                        });
                        onScopesChange(newScopes);
                      }
                    }}
                  >
                    {featureCaps.every(c => editScopes.includes(c.key)) ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Check to restrict this user to only these features within their role. Leave all unchecked for full role access.
                </p>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {featureCaps.map((cap) => {
                  const hasFull = editScopes.includes(cap.key);
                  return (
                    <div
                      key={cap.key}
                      className={cn(
                        "rounded-lg border transition-colors",
                        hasFull ? "border-primary/30 bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-3 py-2">
                        <p className="text-xs font-medium text-foreground">{cap.label}</p>
                        <label className="flex items-center gap-1.5 cursor-pointer ml-3 shrink-0">
                          <Checkbox checked={hasFull} onCheckedChange={() => toggleScope(cap.key)} />
                          <span className="text-xs text-muted-foreground">Restrict</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              {editScopes.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                  <Info className="h-3.5 w-3.5 flex-shrink-0" />
                  No restrictions — user gets full access to all {currentRole?.name ?? editRole} features.
                </div>
              )}
            </div>
          )}

          {/* Extra capability grants — additive beyond role */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold text-foreground">Individual Capability Grants</label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Grant this user access to portals or modes beyond what their role normally provides.
              </p>
            </div>
            {(["portal", "mode"] as const).map((cat) => {
              const catCaps = (capsByCategory[cat] ?? []).filter((c) => !roleCaps.has(c.key));
              if (!catCaps.length) return null;
              const Icon = CAT_ICON[cat];
              return (
                <div key={cat}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">{CAT_LABEL[cat]}</span>
                    <button
                      type="button"
                      className="ml-auto text-[10px] font-medium text-primary hover:underline"
                      onClick={() => {
                        const allSelected = catCaps.every(c => editExtra.includes(c.key));
                        if (allSelected) {
                          onExtraChange(editExtra.filter(e => !catCaps.some(c => c.key === e)));
                        } else {
                          const newExtras = [...editExtra];
                          catCaps.forEach(c => {
                            if (!newExtras.includes(c.key)) newExtras.push(c.key);
                          });
                          onExtraChange(newExtras);
                        }
                      }}
                    >
                      {catCaps.every(c => editExtra.includes(c.key)) ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catCaps.map((cap) => (
                      <button
                        key={cap.key}
                        onClick={() => toggleExtra(cap.key)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-all",
                          editExtra.includes(cap.key)
                            ? "border-primary/40 bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/20 hover:bg-muted/40",
                        )}
                      >
                        <div className={cn(
                          "h-3.5 w-3.5 rounded flex-shrink-0 flex items-center justify-center border",
                          editExtra.includes(cap.key) ? "bg-primary border-primary text-primary-foreground" : "border-border",
                        )}>
                          {editExtra.includes(cap.key) && <Check className="h-2 w-2" />}
                        </div>
                        <span className="truncate">{cap.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Granted info */}
          {editUser.has_override && editUser.granted_by && (
            <p className="text-xs text-muted-foreground">
              Last updated by {editUser.granted_by}
              {editUser.granted_at ? ` on ${new Date(editUser.granted_at).toLocaleDateString()}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex-none px-6 py-3 border-t border-border flex items-center gap-2">
        {editUser.has_override && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRevoke}
            disabled={revoking || saving}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
          >
            {revoking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <UserX className="h-3.5 w-3.5 mr-1.5" />
            )}
            Remove Override
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving || revoking}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || revoking}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <UserCheck className="h-3.5 w-3.5 mr-1.5" />
          )}
          Assign Role
        </Button>
      </div>
    </Card>
  );
}
