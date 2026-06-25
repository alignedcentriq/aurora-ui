import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  Search,
  Shield,
  UserCheck,
  UserX,
  ChevronDown,
  Save,
  Trash2,
  Loader2,
  Info,
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
import { cn } from "@/lib/utils";

interface UserAccess {
  email: string;
  name: string | null;
  job_title: string | null;
  department: string | null;
  has_override: boolean;
  assigned_role: string | null;
  scopes: string[];
  granted_by: string | null;
  granted_at: string | null;
}

const ASSIGNABLE_ROLES = [
  {
    value: "employee",
    label: "Employee",
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  {
    value: "hr",
    label: "HR",
    color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  },
  {
    value: "it",
    label: "IT",
    color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  },
  {
    value: "pmo",
    label: "PMO",
    color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
  },
  {
    value: "admin",
    label: "Admin",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
  {
    value: "functional manager",
    label: "Functional Manager",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
  {
    value: "super admin",
    label: "Super Admin",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
];

interface ScopeAction {
  id: string;
  label: string;
  description: string;
}
interface ScopeGroup {
  id: string;
  label: string;
  description: string;
  actions: ScopeAction[];
}

// Per-role scope catalogue with granular actions (mirrors backend SCOPE_CATALOGUE + ROLE_SCOPES)
const ROLE_SCOPES: Record<string, ScopeGroup[]> = {
  admin: [
    {
      id: "food_complaints",
      label: "Food & Facility Complaints",
      description: "Food vendor feedback and facility complaints",
      actions: [
        { id: "read", label: "View", description: "View all complaints" },
        { id: "manage", label: "Manage", description: "Update status, close tickets" },
      ],
    },
    {
      id: "reimbursements",
      label: "Reimbursements",
      description: "Expense, travel, and certification reimbursements",
      actions: [
        { id: "read", label: "View", description: "View all reimbursement requests" },
        { id: "approve", label: "Approve", description: "Approve or reject claims" },
      ],
    },
    {
      id: "parking",
      label: "Parking Management",
      description: "Parking stickers, dues, and payment reminders",
      actions: [
        { id: "read", label: "View", description: "View sticker applications and dues" },
        { id: "manage", label: "Manage", description: "Issue/revoke stickers, mark dues paid" },
      ],
    },
    {
      id: "desk_keys",
      label: "Desk & Access Keys",
      description: "Desk key requests and office access",
      actions: [
        { id: "read", label: "View", description: "View desk key requests" },
        { id: "manage", label: "Manage", description: "Approve, reject, or release desk keys" },
      ],
    },
    {
      id: "bookshelf",
      label: "Bookshelf Buddy",
      description: "Company book library, borrow requests, extensions",
      actions: [
        { id: "read", label: "View", description: "View books and requests" },
        { id: "manage", label: "Manage", description: "Approve requests, add books, mark returns" },
      ],
    },
    {
      id: "announcements",
      label: "Announcements",
      description: "Company-wide announcements and status updates",
      actions: [
        { id: "read", label: "View", description: "View posted announcements" },
        { id: "write", label: "Write", description: "Create and post announcements" },
      ],
    },
    {
      id: "email_automation",
      label: "Email Automation Hub",
      description: "Automated email workflows and scheduling",
      actions: [
        { id: "read", label: "View", description: "View automations and history" },
        { id: "manage", label: "Manage", description: "Create and trigger automations" },
      ],
    },
    {
      id: "people_directory",
      label: "People Directory",
      description: "Employee directory search and profiles",
      actions: [{ id: "read", label: "View", description: "Search and view employee profiles" }],
    },
    {
      id: "prompt_config",
      label: "AI Prompt Config",
      description: "AI prompt templates for each domain",
      actions: [
        { id: "read", label: "View", description: "View prompt configs" },
        { id: "write", label: "Edit", description: "Edit and save prompt templates" },
      ],
    },
    {
      id: "form_library",
      label: "Form Library",
      description: "Dynamic admin form templates and submissions",
      actions: [
        { id: "read", label: "View", description: "View forms and submissions" },
        { id: "write", label: "Write", description: "Create and edit form templates" },
      ],
    },
    {
      id: "manage_access",
      label: "Manage Admin Access",
      description: "Grant or revoke Admin roles for other users",
      actions: [
        { id: "manage", label: "Manage", description: "Assign and revoke roles (delegated)" },
      ],
    },
  ],
  hr: [
    {
      id: "leave_management",
      label: "HR Portal",
      description: "Employee leave requests and approvals",
      actions: [
        { id: "read", label: "View", description: "View leave requests and balances" },
        { id: "approve", label: "Approve", description: "Approve or reject leave requests" },
      ],
    },
    {
      id: "document_generation",
      label: "Document Generation",
      description: "NOC, experience letters, and other HR documents",
      actions: [
        { id: "read", label: "View", description: "View generated documents" },
        { id: "generate", label: "Generate", description: "Create and release new documents" },
      ],
    },
    {
      id: "skills_management",
      label: "Skills & Certifications",
      description: "Employee skills, certifications, and profiles",
      actions: [
        { id: "read", label: "View", description: "View skills and certifications" },
        { id: "edit", label: "Edit", description: "Update skills and profiles" },
      ],
    },
    {
      id: "people_directory",
      label: "People Directory",
      description: "Employee directory search and profiles",
      actions: [{ id: "read", label: "View", description: "Search and view employee profiles" }],
    },
    {
      id: "email_automation",
      label: "Email Automation Hub",
      description: "Automated email workflows",
      actions: [
        { id: "read", label: "View", description: "View automations" },
        { id: "manage", label: "Manage", description: "Create and trigger automations" },
      ],
    },
    {
      id: "prompt_config",
      label: "AI Prompt Config",
      description: "AI prompt templates",
      actions: [
        { id: "read", label: "View", description: "View prompt configs" },
        { id: "write", label: "Edit", description: "Edit prompt templates" },
      ],
    },
  ],
  it: [
    {
      id: "it_support",
      label: "IT Support Portal",
      description: "IT tickets, software requests, and support",
      actions: [
        { id: "read", label: "View", description: "View tickets and requests" },
        { id: "manage", label: "Manage", description: "Assign, resolve, and close tickets" },
      ],
    },
    {
      id: "observability",
      label: "AI Observability",
      description: "AI conversation logs and system observability",
      actions: [{ id: "read", label: "View", description: "View AI logs, metrics, and data" }],
    },
    {
      id: "llm_controls",
      label: "LLM Model Controls",
      description: "LLM model settings, tiers, and kill switches",
      actions: [
        { id: "read", label: "View", description: "View model configurations" },
        { id: "manage", label: "Manage", description: "Change models, toggle kill switches" },
      ],
    },
    {
      id: "email_automation",
      label: "Email Automation Hub",
      description: "Automated email workflows",
      actions: [
        { id: "read", label: "View", description: "View automations" },
        { id: "manage", label: "Manage", description: "Create and trigger automations" },
      ],
    },
    {
      id: "prompt_config",
      label: "AI Prompt Config",
      description: "AI prompt templates",
      actions: [
        { id: "read", label: "View", description: "View prompt configs" },
        { id: "write", label: "Edit", description: "Edit prompt templates" },
      ],
    },
  ],
  pmo: [
    {
      id: "pmo_portal",
      label: "PMO Portal",
      description: "Udemy licenses and PMO workflows",
      actions: [
        { id: "read", label: "View", description: "View licenses" },
        { id: "manage", label: "Manage", description: "Approve licenses, configure PMO settings" },
      ],
    },
    {
      id: "people_directory",
      label: "People Directory",
      description: "Employee directory",
      actions: [{ id: "read", label: "View", description: "Search and view employee profiles" }],
    },
    {
      id: "email_automation",
      label: "Email Automation Hub",
      description: "Automated email workflows",
      actions: [
        { id: "read", label: "View", description: "View automations" },
        { id: "manage", label: "Manage", description: "Create and trigger automations" },
      ],
    },
    {
      id: "prompt_config",
      label: "AI Prompt Config",
      description: "AI prompt templates",
      actions: [
        { id: "read", label: "View", description: "View prompt configs" },
        { id: "write", label: "Edit", description: "Edit prompt templates" },
      ],
    },
  ],
  "functional manager": [
    {
      id: "attendance_reports",
      label: "Manager Attendance Portal",
      description: "Team attendance reports and exports",
      actions: [
        { id: "read", label: "View", description: "View team attendance data" },
        { id: "export", label: "Export", description: "Export and schedule reports" },
      ],
    },
    {
      id: "people_directory",
      label: "People Directory",
      description: "Employee directory",
      actions: [{ id: "read", label: "View", description: "Search and view employee profiles" }],
    },
    {
      id: "email_automation",
      label: "Email Automation Hub",
      description: "Automated email workflows",
      actions: [
        { id: "read", label: "View", description: "View automations" },
        { id: "manage", label: "Manage", description: "Create and trigger automations" },
      ],
    },
  ],
  employee: [],
  "super admin": [], // full platform access — no scope granularity
};

function roleBadgeColor(role: string | null) {
  return (
    ASSIGNABLE_ROLES.find((r) => r.value === role?.toLowerCase())?.color ??
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
  );
}

function roleLabel(role: string | null) {
  if (!role) return "Azure AD Default";
  return ASSIGNABLE_ROLES.find((r) => r.value === role.toLowerCase())?.label ?? role;
}

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(" ");
    return (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "");
  }
  return email[0]?.toUpperCase() ?? "?";
}

export function AccessManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editUser, setEditUser] = useState<UserAccess | null>(null);
  const [editRole, setEditRole] = useState<string>("employee");
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const headers = {
    "x-user-email": user?.email ?? "",
    "x-user-role": "super admin",
    "Content-Type": "application/json",
  };

  const fetchUsers = async (q = "") => {
    setLoading(true);
    try {
      const url = q ? `/api/access/users?search=${encodeURIComponent(q)}` : "/api/access/users";
      const res = await fetch(url, { headers });
      if (res.ok) setUsers(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchUsers(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  function openEdit(u: UserAccess) {
    setEditUser(u);
    setEditRole(u.assigned_role ?? "employee");
    setEditScopes(u.scopes ?? []);
  }

  function closeEdit() {
    setEditUser(null);
    setEditRole("employee");
    setEditScopes([]);
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function save() {
    if (!editUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/access/users/${encodeURIComponent(editUser.email)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ role: editRole, scopes: editScopes }),
      });
      if (res.ok) {
        showToast(
          `Role '${roleLabel(editRole)}' assigned to ${editUser.name ?? editUser.email}`,
          true,
        );
        closeEdit();
        fetchUsers(search);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to assign role", false);
      }
    } catch {
      showToast("Network error", false);
    }
    setSaving(false);
  }

  async function revoke() {
    if (!editUser) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/access/users/${encodeURIComponent(editUser.email)}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        showToast(
          `Override removed for ${editUser.name ?? editUser.email} — reverts to Azure AD role`,
          true,
        );
        closeEdit();
        fetchUsers(search);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail ?? "Failed to revoke", false);
      }
    } catch {
      showToast("Network error", false);
    }
    setRevoking(false);
  }

  const overriddenCount = useMemo(() => users.filter((u) => u.has_override).length, [users]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-none px-6 py-5 border-b border-border bg-background">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Access Management</h1>
          {overriddenCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {overriddenCount} overridden
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground ml-11">
          Assign roles and feature scopes to users. Overrides take precedence over Azure AD claims
          immediately.
        </p>
      </div>

      {/* Search bar */}
      <div className="flex-none px-6 py-3 border-b border-border bg-muted/30">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </div>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
            No users found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Department
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Assigned Role
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scopes</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.email} className="hover:bg-muted/40 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                        {initials(u.name, u.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {u.name ?? u.email}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.department ?? u.job_title ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.has_override ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                          roleBadgeColor(u.assigned_role),
                        )}
                      >
                        {roleLabel(u.assigned_role)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Azure AD default</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.scopes && u.scopes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {u.scopes.map((s) => {
                          const allScopes = Object.values(ROLE_SCOPES).flat();
                          // handles both "scope_id" and "scope_id:action_id"
                          const [baseId, actionId] = s.split(":");
                          const group = allScopes.find((sc) => sc.id === baseId);
                          const action = actionId
                            ? group?.actions.find((a) => a.id === actionId)
                            : undefined;
                          const label = action
                            ? `${group!.label}: ${action.label}`
                            : (group?.label ?? s);
                          return (
                            <span
                              key={s}
                              className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 text-xs"
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    ) : u.has_override ? (
                      <span className="text-xs text-muted-foreground">
                        Full {u.assigned_role} access
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(u)}
                      className="h-7 text-xs"
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-500" />
              Assign Role
            </DialogTitle>
          </DialogHeader>

          {editUser && (
            <div className="space-y-5 py-1">
              {/* User info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {initials(editUser.name, editUser.email)}
                </div>
                <div>
                  <div className="font-medium text-foreground">
                    {editUser.name ?? editUser.email}
                  </div>
                  <div className="text-xs text-muted-foreground">{editUser.email}</div>
                  {editUser.job_title && (
                    <div className="text-xs text-muted-foreground">{editUser.job_title}</div>
                  )}
                </div>
              </div>

              {/* Role selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Role</label>
                <Select
                  value={editRole}
                  onValueChange={(v) => {
                    setEditRole(v);
                    setEditScopes([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mr-2",
                            r.color,
                          )}
                        >
                          {r.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editRole === "employee" && (
                  <p className="text-xs text-muted-foreground">
                    Setting to Employee overrides any Azure AD role and grants default access only.
                  </p>
                )}
                {editRole === "super admin" && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                    <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      <span className="font-semibold">Highest privilege.</span> Super Admin can
                      manage all roles, access all portals, and change LLM controls. Assign only to
                      trusted administrators.
                    </p>
                  </div>
                )}
              </div>

              {/* Feature scopes — grouped with per-action granularity */}
              {(ROLE_SCOPES[editRole] ?? []).length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-foreground">Feature Scopes</label>
                    <span className="text-xs text-muted-foreground">
                      (leave all unchecked = full role access)
                    </span>
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(ROLE_SCOPES[editRole] ?? []).map((group) => {
                      const hasFull = editScopes.includes(group.id);
                      const hasAny =
                        hasFull ||
                        group.actions.some((a) => editScopes.includes(`${group.id}:${a.id}`));

                      const toggleFull = () => {
                        if (hasFull) {
                          // remove full + all action entries
                          setEditScopes((prev) =>
                            prev.filter((s) => s !== group.id && !s.startsWith(`${group.id}:`)),
                          );
                        } else {
                          // add full, remove action-level entries
                          setEditScopes((prev) => [
                            ...prev.filter((s) => !s.startsWith(`${group.id}:`)),
                            group.id,
                          ]);
                        }
                      };

                      const toggleAction = (actionId: string) => {
                        const key = `${group.id}:${actionId}`;
                        if (hasFull) {
                          // full → remove full, add all other actions except this one
                          const others = group.actions
                            .filter((a) => a.id !== actionId)
                            .map((a) => `${group.id}:${a.id}`);
                          setEditScopes((prev) => [
                            ...prev.filter((s) => s !== group.id && !s.startsWith(`${group.id}:`)),
                            ...others,
                          ]);
                        } else if (editScopes.includes(key)) {
                          setEditScopes((prev) => prev.filter((s) => s !== key));
                        } else {
                          setEditScopes((prev) => [...prev, key]);
                        }
                      };

                      return (
                        <div
                          key={group.id}
                          className={cn(
                            "rounded-lg border transition-colors",
                            hasAny ? "border-primary/30 bg-primary/5" : "border-border",
                          )}
                        >
                          {/* Scope header row */}
                          <div className="flex items-center justify-between px-4 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{group.label}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {group.description}
                              </p>
                            </div>
                            <label className="flex items-center gap-1.5 ml-3 shrink-0 cursor-pointer">
                              <Checkbox checked={hasFull} onCheckedChange={toggleFull} />
                              <span className="text-xs text-muted-foreground">Full</span>
                            </label>
                          </div>

                          {/* Per-action checkboxes */}
                          {group.actions.length > 1 && (
                            <div className="border-t border-border/60 px-4 py-2 flex flex-wrap gap-x-4 gap-y-1.5 bg-muted/20">
                              {group.actions.map((action) => (
                                <label
                                  key={action.id}
                                  className="flex items-center gap-1.5 cursor-pointer"
                                  title={action.description}
                                >
                                  <Checkbox
                                    checked={
                                      hasFull || editScopes.includes(`${group.id}:${action.id}`)
                                    }
                                    onCheckedChange={() => toggleAction(action.id)}
                                    className="h-3.5 w-3.5"
                                  />
                                  <span className="text-xs text-foreground/80">{action.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {editScopes.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                      <Info className="h-3.5 w-3.5 flex-shrink-0" />
                      No scopes selected — this user will have full access to all{" "}
                      {ASSIGNABLE_ROLES.find((r) => r.value === editRole)?.label ?? editRole}{" "}
                      features.
                    </div>
                  )}
                </div>
              )}

              {/* Granted info */}
              {editUser.has_override && editUser.granted_by && (
                <p className="text-xs text-muted-foreground">
                  Last updated by {editUser.granted_by}
                  {editUser.granted_at
                    ? ` on ${new Date(editUser.granted_at).toLocaleDateString()}`
                    : ""}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2 pt-2">
            {editUser?.has_override && (
              <Button
                variant="ghost"
                size="sm"
                onClick={revoke}
                disabled={revoking || saving}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
              >
                {revoking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Remove Override
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={closeEdit} disabled={saving || revoking}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || revoking}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Assign Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast notification */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all",
            toast.ok ? "bg-green-600 text-white" : "bg-destructive text-destructive-foreground",
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
