import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, BookOpen, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface ReadinessRow {
  name: string;
  email: string | null;
  employee_id: number | null;
  matched_skills: string[];
  missing_skills: string[];
  free_pct: number;
  status: "ready" | "one_course_away" | "gap";
  suggested_course: string | null;
  suggested_course_id: number | null;
}

interface AssignTrainingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employee: ReadinessRow | null;
  authHeaders: Record<string, string>;
  onSuccess: () => void;
}

export function AssignTrainingDialog({
  isOpen,
  onClose,
  employee,
  authHeaders,
  onSuccess,
}: AssignTrainingDialogProps) {
  const [activeTab, setActiveTab] = useState<"internal" | "external">("internal");

  // Internal
  const [internalCourses, setInternalCourses] = useState<any[]>([]);
  const [loadingInternal, setLoadingInternal] = useState(false);
  const [selectedInternalId, setSelectedInternalId] = useState<number | null>(null);

  // External (Udemy)
  const [udemyQuery, setUdemyQuery] = useState("");
  const [udemyResults, setUdemyResults] = useState<any[]>([]);
  const [loadingUdemy, setLoadingUdemy] = useState(false);
  const [selectedUdemyCourse, setSelectedUdemyCourse] = useState<any | null>(null);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab("internal");
      setSelectedInternalId(null);
      setUdemyQuery(employee?.missing_skills[0] || "");
      setSelectedUdemyCourse(null);
      setUdemyResults([]);
      fetchInternalCourses();
    }
  }, [isOpen, employee]);

  const fetchInternalCourses = async () => {
    setLoadingInternal(true);
    try {
      const res = await fetch("/api/portal/te-local/trainings", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch internal trainings");
      const data = await res.json();
      setInternalCourses(data.results || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingInternal(false);
    }
  };

  const searchUdemy = async () => {
    if (!udemyQuery.trim()) return;
    setLoadingUdemy(true);
    try {
      const res = await fetch(`/api/portal/udemy/courses?q=${encodeURIComponent(udemyQuery)}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed to search Udemy");
      const data = await res.json();
      setUdemyResults(data.results || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingUdemy(false);
    }
  };

  const handleAssignInternal = async () => {
    if (!employee || !selectedInternalId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/manager/team/readiness/assign", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.employee_id,
          email: employee.email,
          training_id: selectedInternalId,
          due_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to assign");
      toast.success("Training assigned successfully!");
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestExternal = async () => {
    if (!employee || !selectedUdemyCourse) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/manager/team/readiness/request-udemy", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.employee_id,
          email: employee.email,
          course_name: selectedUdemyCourse.title,
          skill: employee.missing_skills[0] || "",
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to request license");
      const data = await res.json();
      toast.success(data.message || "Requested external training");
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Assign Training to {employee?.name}</DialogTitle>
          <DialogDescription>
            {employee?.missing_skills.length
              ? `Missing skills: ${employee.missing_skills.join(", ")}`
              : "Select a course to assign."}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v: any) => setActiveTab(v)}
          className="mt-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="internal" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              TechElevate Catalog
            </TabsTrigger>
            <TabsTrigger value="external" className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Udemy Search
            </TabsTrigger>
          </TabsList>

          <TabsContent value="internal" className="pt-4 space-y-4">
            {loadingInternal ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : internalCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-4">No internal courses found.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {internalCourses.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-lg border text-sm cursor-pointer transition-colors ${
                      selectedInternalId === c.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedInternalId(c.id)}
                  >
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-muted-foreground text-xs line-clamp-1">{c.description}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleAssignInternal}
                disabled={!selectedInternalId || submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Assign Selected Course
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="external" className="pt-4 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search Udemy courses..."
                value={udemyQuery}
                onChange={(e) => setUdemyQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchUdemy()}
              />
              <Button variant="secondary" onClick={searchUdemy} disabled={loadingUdemy}>
                {loadingUdemy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {loadingUdemy ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : udemyResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center p-4">
                  Search for a course to request a license.
                </p>
              ) : (
                udemyResults.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-lg border text-sm cursor-pointer flex gap-3 transition-colors ${
                      selectedUdemyCourse?.id === c.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedUdemyCourse(c)}
                  >
                    {c.image_125_H && (
                      <img src={c.image_125_H} alt="" className="w-16 h-12 object-cover rounded" />
                    )}
                    <div>
                      <p className="font-semibold line-clamp-1">{c.title}</p>
                      <p className="text-muted-foreground text-xs line-clamp-1 mt-0.5">
                        {c.headline || c.visible_instructors?.[0]?.title}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleRequestExternal}
                disabled={!selectedUdemyCourse || submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Assign Course
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
