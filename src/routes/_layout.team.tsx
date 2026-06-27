import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState } from "react";
import {
  Users,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  Clock,
  BookOpen,
  FileSpreadsheet,
  ChevronDown,
  User,
  CalendarDays,
  Target,
  Zap,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Shadcn UI Imports
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      description:
        "All team members must complete the mandatory security awareness module on the LMS portal by end of this month.",
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
      description:
        "Submit your April timesheet with accurate project allocation hours. Use the standard Excel template.",
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
      description:
        "Update your skills and certifications in the team skill matrix spreadsheet shared on OneDrive.",
      assignedTo: ["all"],
      priority: "low",
      status: "completed",
      dueDate: "2026-04-30",
      type: "action",
      createdAt: "2026-04-15",
    },
  ]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
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
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md w-full border-dashed">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Access Restricted</CardTitle>
            <CardDescription className="text-sm mt-1">
              Team management capabilities are reserved exclusively for Functional Managers.
            </CardDescription>
          </CardHeader>
        </Card>
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
    setIsDialogOpen(false);
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

  const filteredTasks =
    filterStatus === "all" ? tasks : tasks.filter((t) => t.status === filterStatus);

  const getAssigneeLabel = (assignedTo: string[]) => {
    if (assignedTo.includes("all")) return "All Team Members";
    return assignedTo.map((id) => team.find((m) => m.id === id)?.name || id).join(", ");
  };

  const priorityConfig: Record<TaskPriority, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    high: { label: "High", variant: "destructive" },
    medium: { label: "Medium", variant: "default" },
    low: { label: "Low", variant: "secondary" },
  };

  const statusConfig: Record<TaskStatus, { label: string; icon: typeof Clock; color: string; bg: string }> = {
    pending: { label: "Pending", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    in_progress: { label: "In Progress", icon: Zap, color: "text-blue-500", bg: "bg-blue-500/10" },
    completed: { label: "Completed", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
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
    <div className="flex h-full flex-col overflow-y-auto bg-background/30">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Portal</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Assign objectives, monitor progress, and coordinate with your team of {team.length} members.
            </p>
          </div>
          <Button
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Assign Task
          </Button>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-8 max-w-7xl w-full mx-auto">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Assignments", value: stats.total, icon: Target, color: "text-violet-500", bg: "bg-violet-500/10" },
            { label: "Pending Tasks", value: stats.pending, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
            { label: "In Progress", value: stats.inProgress, icon: Zap, color: "text-blue-500", bg: "bg-blue-500/10" },
            { label: "Completed Objectives", value: stats.completed, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl shrink-0", s.bg)}>
                    <Icon className={cn("h-6 w-6", s.color)} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight">{s.value}</p>
                    <p className="text-xs font-medium text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Team Members Roster */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Active Roster
                </CardTitle>
                <CardDescription>Members currently assigned to your department</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {team.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 rounded-xl border bg-card/50 hover:bg-card transition-all duration-200"
                  >
                    <Avatar className="h-9 w-9 border">
                      <AvatarFallback className="bg-primary/5 text-primary text-xs font-semibold">
                        {member.avatar || member.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate leading-none mb-1">
                        {member.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.department}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      {member.role === "Functional Manager" ? "Manager" : "Member"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Tasks Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Filter Tabs */}
            <div className="flex justify-between items-center gap-4">
              <Tabs
                defaultValue={filterStatus}
                value={filterStatus}
                onValueChange={(val) => setFilterStatus(val as any)}
                className="w-full"
              >
                <TabsList className="grid w-full max-w-[420px] grid-cols-4">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="pending">Pending</TabsTrigger>
                  <TabsTrigger value="in_progress">Active</TabsTrigger>
                  <TabsTrigger value="completed">Done</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Task List */}
            <div className="space-y-4">
              {filteredTasks.map((task) => {
                const TypeIcon = typeIcon[task.type];
                const statusMeta = statusConfig[task.status];
                const StatusIcon = statusMeta.icon;
                const isExpanded = expandedTask === task.id;

                return (
                  <Card
                    key={task.id}
                    className={cn(
                      "transition-all duration-300 hover:shadow-md",
                      isExpanded && "ring-1 ring-primary/20",
                    )}
                  >
                    <div
                      className="flex items-center gap-4 p-5 cursor-pointer select-none"
                      onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0">
                        <TypeIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold truncate mb-1">
                          {task.title}
                        </h4>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs mt-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                              statusMeta.color,
                              statusMeta.bg,
                            )}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {statusMeta.label}
                          </span>
                          <Badge variant={priorityConfig[task.priority].variant} className="text-[10px] font-bold">
                            {priorityConfig[task.priority].label} Priority
                          </Badge>
                          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                            <CalendarDays className="h-3.5 w-3.5" />
                            Due {task.dueDate}
                          </span>
                        </div>
                      </div>
                      <ChevronDown
                        className={cn(
                          "h-5 w-5 text-muted-foreground transition-transform duration-300 shrink-0",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </div>

                    {isExpanded && (
                      <CardContent className="border-t pt-5 space-y-5 animate-in fade-in duration-200">
                        <div>
                          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Description</h5>
                          <p className="text-sm leading-relaxed text-foreground/80">
                            {task.description || "No description provided."}
                          </p>
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-semibold">Assigned:</span>
                            <span className="text-xs font-medium text-foreground bg-muted px-2.5 py-1 rounded-lg">
                              {getAssigneeLabel(task.assignedTo)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground font-semibold mr-1">Status:</span>
                            {(["pending", "in_progress", "completed"] as TaskStatus[]).map((s) => {
                              const meta = statusConfig[s];
                              return (
                                <Button
                                  key={s}
                                  size="sm"
                                  variant={task.status === s ? "default" : "outline"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateStatus(task.id, s);
                                  }}
                                  className="h-8 text-xs"
                                >
                                  {meta.label}
                                </Button>
                              );
                            })}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(task.id);
                              }}
                              className="h-8 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500 ml-1"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}

              {filteredTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center border rounded-2xl bg-card border-dashed">
                  <Target className="h-10 w-10 text-muted-foreground/30 mb-4" />
                  <h4 className="text-sm font-semibold text-foreground">No tasks found</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                    Try altering your filter configuration or assign a new objective to the roster.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task Assignment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Assign Objective</DialogTitle>
            <DialogDescription>
              Assign a new action item, training exercise, or reporting task to your roster.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Task Title</label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Complete Security Audit"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Due Date</label>
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <Textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Scope of work and guidelines..."
                className="min-h-[100px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Task Type</label>
                <Select
                  value={newType}
                  onValueChange={(val) => setNewType(val as any)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="learning">📚 Learning / Training</SelectItem>
                    <SelectItem value="form">📋 Form / Spreadsheet</SelectItem>
                    <SelectItem value="action">🎯 Action Item</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Priority</label>
                <Select
                  value={newPriority}
                  onValueChange={(val) => setNewPriority(val as any)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="high">High Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <label className="text-xs font-semibold text-muted-foreground">Assignees</label>
              <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto p-1.5 border rounded-lg bg-muted/40">
                <Button
                  size="sm"
                  variant={selectedMembers.includes("all") ? "default" : "outline"}
                  onClick={() => toggleMember("all")}
                  className="h-8 text-xs"
                >
                  {selectedMembers.includes("all") && <Check className="h-3 w-3 mr-1" />}
                  All Members
                </Button>
                {team.map((m) => {
                  const isChecked = selectedMembers.includes(m.id) && !selectedMembers.includes("all");
                  return (
                    <Button
                      key={m.id}
                      size="sm"
                      variant={isChecked ? "default" : "outline"}
                      onClick={() => toggleMember(m.id)}
                      className="h-8 text-xs"
                    >
                      {isChecked && <Check className="h-3 w-3 mr-1" />}
                      {m.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>
              Assign Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
