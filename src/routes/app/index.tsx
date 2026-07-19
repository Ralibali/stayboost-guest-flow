import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/app/")({
  component: AppIndex,
});

function AppIndex() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/app/bokningar", replace: true });
  }, [navigate]);
  return null;
}
