import "server-only";
import { ControlError } from "@/lib/sources/control";

/**
 * Accept only same-origin JSON requests for endpoints that start or stop work. Another web page
 * open in the browser cannot send JSON cross-origin without a CORS preflight, which is refused.
 */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const json = request.headers.get("content-type")?.startsWith("application/json");
  if (!json || (origin && host && new URL(origin).host !== host)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/** Turn a control API failure into a JSON response for the browser. */
export function controlErrorResponse(error: unknown): Response {
  if (error instanceof ControlError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "The control service in the client container is not reachable." }, { status: 503 });
}
