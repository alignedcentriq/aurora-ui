import { createFileRoute } from "@tanstack/react-router";
import { useAuth, type TeamMember } from "@/lib/auth-store";
import { useState } from "react";
import {
  Users, Plus, Trash2, Send, CheckCircle2, Clock,
  BookOpen, FileSpreadsheet, AlertCircle, ChevronDown,
  ChevronRight, User, CalendarDays, Target, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/team")({
  component: TeamPage,
});

type TaskPriority = "low" | "medium" | "high";
type TaskStatus = "pending" | "in_progress" | "completed";

interface TeamTask {
  id: number;
  title: string;
  description: string;
  assignedTo: string[]; // member IDs or "all"
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  type: "learning" | "form" | "action";
  createdAt: string;
}

function TeamPage() {
  const { user } = useAuth();

  const [tasks, setTasks] = useState<TeamTask[]>([
    {
      id: 1,
      title: "Complete Q2 Security Awareness Training",
      description: "All team members must complete the mandatory security awareness module on the LMS portal by end of this month.",
      assignedTo: ["all"],
      priority: "high",
      status: "pending",
      dueDate: "2026-05-31",
      type: "learning",
      createdAt: "2026-05-01",
    },
    {
      id: 2,
      title: "Fill Monthly Timesheet — April",
      description: "Submit your April timesheet with accurate project allocation hours. Use the standard Excel template.",
      assignedTo: ["t1", "t2", "t3"],
      priority: "medium",
      status: "in_progress",
      dueDate: "2026-05-10",
      type: "form",
      createdAt: "2026-05-02",
    },
    {
      id: 3,
      title: "Review & Update Skill Matrix",
      description: "Update your skills and certifications in the team skill matrix spreadsheet shared on OneDrive.",
      assignedTo: ["all"],
      priority: "low",
      status: "completed",
      dueDate: "2026-04-30",
      type: "action",
      createdAt: "2026-04-15",
    },
  ]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [newType, setNewType] = useState<"learning" | "form" | "action">("learning");
  const [newDueDate, setNewDueDate] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>(["all"]);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | TaskStatus>("all");

  if (!user || user.role !== "Functional Manager") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">Team management is available for Functional Managers only.</p>
        </div>
      </div>
    );
  }

  const team = user.team || [];

  const toggleMember = (id: string) => {
    if (id === "all") {
      setSelectedMembers(["all"]);
      return;
    }
    setSelectedMembers((prev) => {
      const without = prev.filter((m) => m !== "all" && m !== id);
      if (prev.includes(id)) return without.length === 0 ? ["all"] : without;
      return [...without, id];
    });
  };

  const handleCreate = () => {
    if (!newTitle.trim() || !newDueDate) {
      toast.error("Title and due date are required");
      return;
    }
    const task: TeamTask = {
      id: Date.now(),
      title: newTitle,
      description: newDesc,
      assignedTo: selectedMembers,
      priority: newPriority,
      status: "pending",
      dueDate: newDueDate,
      type: newType,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setTasks([task, ...tasks]);
    setNewTitle("");
    setNewDesc("");
    setNewDueDate("");
    setNewPriority("medium");
    setNewType("learning");
    setSelectedMembers(["all"]);
    setIsFormOpen(false);
    toast.success("Task assigned to team");
  };

  const updateStatus = (id: number, status: TaskStatus) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, status } : t)));
    toast.success(`Status updated to ${status.replace("_", " ")}`);
  };

  const deleteTask = (id: number) => {
    setTasks(tasks.filter((t) => t.id !== id));
    toast.info("Task removed");
  };

  const filteredTasks = filterStatus === "all" ? tasks : tasks.filter((t) => t.status === filterStatus);

  const getAssigneeLabel = (assignedTo: string[]) => {
    if (assignedTo.includes("all")) return "All Team Members";
    return assignedTo
      .map((id) => team.find((m) => m.id === id)?.name || id)
      .join(", ");
  };

  const priorityConfig: Record<TaskPriority, { label: string; classes: string }> = {
    high: { label: "High", classes: "bg-rose-500/10 text-rose-500" },
    medium: { label: "Medium", classes: "bg-amber-500/10 text-amber-500" },
    low: { label: "Low", classes: "bg-emerald-500/10 text-emerald-500" },
  };

  const statusConfig: Record<TaskStatus, { label: string; icon: typeof Clock; classes: string }> = {
    pending: { label: "Pending", icon: Clock, classes: "text-amber-500" },
    in_progress: { label: "In Progress", icon: Zap, classes: "text-blue-500" },
    completed: { label: "Completed", icon: CheckCircle2, classes: "text-emerald-500" },
  };

  const typeIcon: Record<string, typeof BookOpen> = {
    learning: BookOpen,
    form: FileSpreadsheet,
    action: Target,
  };

  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Team Management</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Assign tasks, learnings, and forms to your team of {team.length} members
            </p>
          </div>
          <button
            onClick={() => setIsFormOpen(!isFormOpen)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all",
              isFormOpen ? "bg-[var(--muted)] text-foreground" : "bg-primary text-white hover:bg-primary/90"
            )}
          >
            <Plus className="h-4 w-4" />
            {isFormOpen ? "Cancel" : "Assign Task"}
          </button>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Tasks", value: stats.total, icon: Target, color: "text-violet-500" },
            { label: "Pending", value: stats.pending, icon: Clock, color: "text-amber-500" },
            { label: "In Progress", value: stats.inProgress, icon: Zap, color: "text-blue-500" },
            { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-emerald-500" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--muted)]">
                    <Icon className={cn("h-4 w-4", s.color)} />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{s.value}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Team Members */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-5">
          <h3 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Your Team
          </h3>
          <div className="flex flex-wrap gap-2">
            {team.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 bg-[var(--muted)]/50"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {member.avatar}
                </div>
                <div>
                  <p className="text-[12px] font-medium text-foreground leading-tight">{member.name}</p>
                  <p className="text-[10px] text-muted-foreground">{member.department}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Create Form */}
        {isFormOpen && (
          <div className="rounded-2xl border-2 border-primary/20 bg-card p-6 animate-in slide-in-from-top-2 duration-200">
            <h3 className="text-[15px] font-semibold text-foreground mb-5 flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" /> Assign New Task
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Task Title</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g., Complete AWS Certification Module"
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Describe what needs to be done..."
                  className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 min-h-[100px] resize-y placeholder:text-muted-foreground/40"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as typeof newType)}
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                  >
                    <option value="learning">📚 Learning / Training</option>
                    <option value="form">📋 Form / Spreadsheet</option>
                    <option value="action">🎯 Action Item</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-foreground mb-1.5">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                  </select>
                </div>
              </div>

              {/* Member Assignment */}
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">Assign To</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleMember("all")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-all",
                      selectedMembers.includes("all")
                        ? "bg-primary text-white border-primary"
                        : "border-[var(--border)] text-muted-foreground hover:border-[var(--border-strong)]"
                    )}
                  >
                    All Members
                  </button>
                  {team.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleMember(m.id)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-all",
                        selectedMembers.includes(m.id) && !selectedMembers.includes("all")
                          ? "bg-primary text-white border-primary"
                          : "border-[var(--border)] text-muted-foreground hover:border-[var(--border-strong)]"
                      )}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-[13px] font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  <Send className="h-4 w-4" /> Assign Task
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card p-1.5 w-fit">
          {(["all", "pending", "in_progress", "completed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "rounded-lg px-4 py-2 text-[12px] font-medium transition-all capitalize",
                filterStatus === s
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const TypeIcon = typeIcon[task.type];
            const statusMeta = statusConfig[task.status];
            const StatusIcon = statusMeta.icon;
            const isExpanded = expandedTask === task.id;

            return (
              <div
                key={task.id}
                className="group rounded-2xl border border-[var(--border)] bg-card transition-all duration-150 hover:border-[var(--border-strong)]"
              >
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--muted)] shrink-0">
                    <TypeIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[13px] font-semibold text-foreground truncate">{task.title}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className={cn("inline-flex items-center gap-1 font-medium", statusMeta.classes)}>
                        <StatusIcon className="h-3 w-3" />
                        {statusMeta.label}
                      </span>
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", priorityConfig[task.priority].classes)}>
                        {priorityConfig[task.priority].label}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        Due {task.dueDate}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {getAssigneeLabel(task.assignedTo)}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                    isExpanded && "rotate-180"
                  )} />
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--border)] px-5 py-4 animate-in slide-in-from-top-1 duration-150 space-y-4">
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{task.description}</p>

                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[11px] text-muted-foreground font-medium">Update Status:</span>
                      {(["pending", "in_progress", "completed"] as TaskStatus[]).map((s) => {
                        const meta = statusConfig[s];
                        const SIcon = meta.icon;
                        return (
                          <button
                            key={s}
                            onClick={(e) => { e.stopPropagation(); updateStatus(task.id, s); }}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium border transition-all",
                              task.status === s
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "border-[var(--border)] text-muted-foreground hover:border-[var(--border-strong)]"
                            )}
                          >
                            <SIcon className="h-3 w-3" />
                            {meta.label}
                          </button>
                        );
                      })}
                      <div className="flex-1" />
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium border border-rose-500/20 text-rose-500 hover:bg-rose-500/5 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Target className="h-10 w-10 text-muted-foreground/20 mb-4" />
              <p className="text-[13px] font-medium text-muted-foreground">No tasks found</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Create a new task to assign to your team</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
