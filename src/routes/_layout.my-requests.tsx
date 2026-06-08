import { createFileRoute } from "@tanstack/react-router";
import { MyRequests } from "@/pages/MyRequests";

export const Route = createFileRoute("/_layout/my-requests")({
  component: MyRequests,
});
