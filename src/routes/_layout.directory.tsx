import { createFileRoute } from "@tanstack/react-router";
import { EmployeeDirectory } from "@/pages/EmployeeDirectory";

export const Route = createFileRoute("/_layout/directory")({
  component: EmployeeDirectory,
});
