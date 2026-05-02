import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState } from "react";
import { Plus, Trash2, Save, Search, Tag, Filter, Zap, MessageSquare, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/config")({
  component: ConfigPage,
});

interface PromptConfig {
  id: number;
  trigger: string;
  response: string;
  category: string;
  active: boolean;
}

function ConfigPage() {
  const { user } = useAuth();
  const [prompts, setPrompts] = useState<PromptConfig[]>([
    {
      id: 1,
      trigger: "How to reset VPN?",
      response: "Please visit vpn.nexus.com and follow the automated reset wizard. If the issue persists, contact IT Support at ext. 4500.",
      category: "IT",
      active: true,
    },
    {
      id: 2,
      trigger: "What is the leave policy?",
      response: "Employees are entitled to 24 earned leaves, 12 casual leaves, and 12 sick leaves per year. Leave requests must be submitted at least 3 days in advance for approval.",
      category: "HR",
      active: true,
    },
    {
      id: 3,
      trigger: "How do I book a meeting room?",
      response: "Use the Nexus Room Booking portal at rooms.nexus.com or ask me to check availability for a specific date and time.",
      category: "Admin",
      active: false,
    },
  ]);
  const [newTrigger, setNewTrigger] = useState("");
  const [newResponse, setNewResponse] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [isFormOpen, setIsFormOpen] = useState(false);

  if (!user || user.role === "Employee" || user.role === "Functional Manager") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <HelpCircle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">Prompt configuration is available for HR, IT, PMO and Admins.</p>
        </div>
      </div>
    );
  }

  const handleAdd = () => {
    if (!newTrigger.trim() || !newResponse.trim()) {
      toast.error("Please fill in both trigger and response fields");
      return;
    }
    setPrompts([
      { id: Date.now(), trigger: newTrigger, response: newResponse, category: newCategory, active: true },
      ...prompts,
    ]);
    setNewTrigger("");
    setNewResponse("");
    setNewCategory("General");
    setIsFormOpen(false);
    toast.success("Configuration saved");
  };

  const handleDelete = (id: number) => {
    setPrompts(prompts.filter((p) => p.id !== id));
    toast.info("Configuration removed");
  };

  const toggleActive = (id: number) => {
    setPrompts(prompts.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  };

  const categories = ["All", ...Array.from(new Set(prompts.map((p) => p.category)))];

  const filtered = prompts.filter((p) => {
    const matchesSearch =
      p.trigger.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.response.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === "All" || p.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Prompt Configuration</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Define automated responses for {user.role} department queries
            </p>
          </div>
          <button
            onClick={() => setIsFormOpen(!isFormOpen)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all",
              isFormOpen
                ? "bg-[var(--muted)] text-foreground"
                : "bg-primary text-white hover:bg-primary/90"
            )}
          >
            <Plus className="h-4 w-4" />
            {isFormOpen ? "Cancel" : "New Config"}
          </button>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-6">
        {/* Add Form */}
        {isFormOpen && (
          <div className="rounded-2xl border-2 border-primary/20 bg-card p-6 animate-in slide-in-from-top-2 duration-200">
            <h3 className="text-[15px] font-semibold text-foreground mb-5 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> New Automated Response
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Trigger Question</label>
                <input
                  type="text"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  placeholder="e.g., How do I apply for parental leave?"
                  className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/40"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">AI Response</label>
                <textarea
                  value={newResponse}
                  onChange={(e) => setNewResponse(e.target.value)}
                  placeholder="Enter the standard response for this query..."
                  className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/5 min-h-[120px] resize-y placeholder:text-muted-foreground/40"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                  >
                    <option>General</option>
                    <option>HR</option>
                    <option>IT</option>
                    <option>Admin</option>
                    <option>PMO</option>
                  </select>
                </div>
                <button
                  onClick={handleAdd}
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-[13px] font-medium text-white transition-colors hover:bg-primary/90"
                >
                  <Save className="h-4 w-4" /> Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search configurations..."
              className="w-full rounded-xl border border-[var(--border)] bg-card pl-10 pr-4 py-2.5 text-[13px] outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card px-1.5 py-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all",
                  filterCategory === cat
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Config List */}
        <div className="space-y-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group rounded-2xl border bg-card p-5 transition-all duration-150",
                p.active ? "border-[var(--border)]" : "border-[var(--border)] opacity-50"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <Tag className="h-3 w-3" />
                      {p.category}
                    </span>
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      p.active ? "bg-emerald-500/10 text-emerald-500" : "bg-[var(--muted)] text-muted-foreground"
                    )}>
                      {p.active ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 mb-2">
                    <MessageSquare className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-[13px] font-semibold text-foreground">{p.trigger}</p>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed ml-6">{p.response}</p>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => toggleActive(p.id)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[11px] font-medium border transition-colors",
                      p.active
                        ? "border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                        : "border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                    )}
                  >
                    {p.active ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/20 mb-4" />
              <p className="text-[13px] font-medium text-muted-foreground">No configurations found</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
