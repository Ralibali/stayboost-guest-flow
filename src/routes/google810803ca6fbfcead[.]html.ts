import { createFileRoute } from "@tanstack/react-router";
import { GSC_HTML_BODY } from "@/lib/gsc-verification";

export const Route = createFileRoute("/google810803ca6fbfcead.html")({
  server: {
    handlers: {
      GET: async () =>
        new Response(GSC_HTML_BODY, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
    },
  },
});
