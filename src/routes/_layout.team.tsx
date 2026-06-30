import { createFileRoute } from "@tanstack/react-router";
import { ManagerPortal } from "@/pages/ManagerPortal";

export const Route = createFileRoute("/_layout/team")({
  component: ManagerPortal,
});
