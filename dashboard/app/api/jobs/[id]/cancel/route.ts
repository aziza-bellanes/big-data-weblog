import { connection } from "next/server";
import { controlErrorResponse, rejectCrossOrigin } from "@/lib/api";
import { cancelJob } from "@/lib/sources/control";

/** Stop a running job; its current step is terminated and the next steps are skipped. */
export async function POST(request: Request, { params }: RouteContext<"/api/jobs/[id]/cancel">) {
  await connection();
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  try {
    return Response.json(await cancelJob((await params).id), { status: 202 });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
