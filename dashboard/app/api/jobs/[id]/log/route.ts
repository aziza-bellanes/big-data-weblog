import { connection } from "next/server";
import { controlErrorResponse } from "@/lib/api";
import { fetchJobLog } from "@/lib/sources/control";

/** Log lines of a job newer than ?after=<seq>, polled by the console. */
export async function GET(request: Request, { params }: RouteContext<"/api/jobs/[id]/log">) {
  await connection();
  const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
  try {
    const log = await fetchJobLog((await params).id, Number.isFinite(after) ? after : -1);
    return Response.json(log, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
