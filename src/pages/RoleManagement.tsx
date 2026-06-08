import { useAuth, Role } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Shield, Trash2, Loader2, UserCheck, RefreshCw, X, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface EmployeeSearchResult {
  id: number;
  name: string;
  email: string;
  department: string;
  designation: string;
}

interface AssignedRoleRecord {
  id: number;
  name: string;
  email: string;
  role: Role;
  designation: string;
  department: string;
}

const ROLE_COLORS: Record<Role, string> = {
  Employee: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
  HR: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  IT: "bg-teal-500/15 text-teal-400 border border-teal-500/20",
  PMO: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20",
  Admin: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "Functional Manager": "bg-purple-500/15 text-purple-400 border border-purple-500/20",
  "Super Admin": "bg-amber-500/15 text-amber-400 border border-amber-500/20",
};

export function RoleManagement() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmployeeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<EmployeeSearchResult | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>("Employee");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignedRoles, setAssignedRoles] = useState<AssignedRoleRecord[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  // Fetch all assigned roles
  const fetchAssignedRoles = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const res = await fetch("/api/employees/roles/assigned", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch assigned roles");
      const data = await res.json();
      setAssignedRoles(data);
    } catch {
      toast.error("Failed to load assigned roles");
    } finally {
      setIsLoadingList(false);
    }
  }, [user]);

  // Autocomplete search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/employees/autocomplete?q=${encodeURIComponent(searchQuery)}`, {
          headers: authHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch {
        // autocomplete fetch failed
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, user]);

  useEffect(() => {
    fetchAssignedRoles();
  }, [fetchAssignedRoles]);

  // Click outside autocomplete dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectUser = (emp: EmployeeSearchResult) => {
    setSelectedUser(emp);
    setDropdownOpen(false);
    setSearchQuery("");
    // Find current role of selected user from list if exists, default to Employee
    const activeOverride = assignedRoles.find((r) => r.email.toLowerCase() === emp.email.toLowerCase());
    setSelectedRole(activeOverride ? activeOverride.role : "Employee");
  };

  const handleAssignRole = async (email: string, roleToAssign: Role) => {
    setIsAssigning(true);
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(email)}/role`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ role: roleToAssign }),
      });
      if (!res.ok) throw new Error("Failed to assign role");
      toast.success(`Assigned role ${roleToAssign} to ${email}`);
      setSelectedUser(null);
      fetchAssignedRoles();
    } catch {
      toast.error("Failed to assign role");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleResetRole = async (email: string) => {
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(email)}/role`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ role: "Employee" }),
      });
      if (!res.ok) throw new Error("Failed to reset role");
      toast.success(`Reset ${email} to Employee role`);
      fetchAssignedRoles();
    } catch {
      toast.error("Failed to reset role");
    }
  };

  const roles: Role[] = [
    "Employee",
    "HR",
    "IT",
    "PMO",
    "Admin",
    "Functional Manager",
    "Super Admin",
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-[var(--clarity)]" />
            User Role Control
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Dynamically switch, manage, and assign roles for development and testing.
          </p>
        </div>
        <button
          onClick={fetchAssignedRoles}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh List
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-8">
        {/* Assign Role Panel */}
        <div className="rounded-xl border border-[var(--border)] bg-card/40 p-6 space-y-6">
          <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
            <UserCheck className="h-4.5 w-4.5 text-[var(--connectivity)]" />
            Search & Assign Custom Role
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Search Input and autocomplete */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5">
                Search Employee by Name or Email
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder="Type to search..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  className="w-full bg-background border border-[var(--border)] rounded-xl pl-10 pr-4 py-2.5 text-[13px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[var(--clarity)]/30 focus:border-[var(--clarity)]"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Autocomplete Dropdown */}
              {dropdownOpen && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-popover border border-[var(--border)] rounded-xl shadow-2xl max-h-60 overflow-y-auto z-50">
                  {searchResults.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => handleSelectUser(emp)}
                      className="w-full text-left px-4 py-3 hover:bg-secondary/40 border-b border-[var(--border)]/30 last:border-b-0 transition-colors flex flex-col"
                    >
                      <span className="text-[13px] font-semibold text-foreground">{emp.name}</span>
                      <span className="text-[11px] text-muted-foreground">{emp.email}</span>
                      <span className="text-[10px] text-muted-foreground/75 mt-0.5">
                        {emp.designation || "No Designation"} • {emp.department || "No Department"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Config & Assign Box */}
            {selectedUser ? (
              <div className="rounded-xl bg-background border border-[var(--border)] p-4 relative animate-fade-in space-y-4">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="absolute right-2.5 top-2.5 p-1 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>

                <div>
                  <h3 className="text-[13px] font-bold text-foreground">{selectedUser.name}</h3>
                  <p className="text-[11px] text-muted-foreground">{selectedUser.email}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    {selectedUser.designation} • {selectedUser.department}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Choose Role
                    </label>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as Role)}
                      className="w-full bg-background border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--clarity)]/30"
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => handleAssignRole(selectedUser.email, selectedRole)}
                    disabled={isAssigning}
                    className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-4 py-2 text-[13px] font-semibold flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-50"
                  >
                    {isAssigning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                    Assign Role
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center border border-dashed border-[var(--border)] rounded-xl p-6 text-center text-muted-foreground">
                <p className="text-[12px]">Select an employee from the search results to configure their role override.</p>
              </div>
            )}
          </div>
        </div>

        {/* Assigned Roles List */}
        <div className="rounded-xl border border-[var(--border)] bg-card/40 p-6 space-y-6">
          <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
            <Shield className="h-4.5 w-4.5 text-[var(--clarity)]" />
            Assigned Overrides & Custom Roles
          </h2>

          <div className="overflow-x-auto">
            {isLoadingList ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : assignedRoles.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 border border-dashed border-[var(--border)] rounded-xl text-center text-muted-foreground">
                <ShieldAlert className="h-5 w-5" />
                <span className="text-[13px]">No active role overrides set in the database.</span>
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    {["Employee Details", "Designation", "Department", "Assigned Role", "Actions"].map((h) => (
                      <th
                        key={h}
                        className="pb-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assignedRoles.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-[var(--border)]/50 last:border-b-0 hover:bg-white/[0.01] transition-colors"
                    >
                      <td className="py-3.5 pr-4">
                        <div className="font-semibold text-foreground">{record.name}</div>
                        <div className="text-[11px] text-muted-foreground">{record.email}</div>
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/80">{record.designation || "—"}</td>
                      <td className="py-3.5 pr-4 text-foreground/80">{record.department || "—"}</td>
                      <td className="py-3.5 pr-4">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium border", ROLE_COLORS[record.role])}>
                          {record.role}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4">
                        <button
                          onClick={() => handleResetRole(record.email)}
                          className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/15 rounded-lg px-2.5 py-1 text-[11px] transition-all font-semibold"
                          title="Reset to default Employee role"
                        >
                          <Trash2 className="h-3 w-3" />
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
