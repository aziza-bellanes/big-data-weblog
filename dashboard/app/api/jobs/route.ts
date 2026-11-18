import { connection } from "next/server";
import { controlErrorResponse, rejectCrossOrigin } from "@/lib/api";
import { JOB_ACTIONS, REPLAY_RATES, startJob, type StartJobRequest } from "@/lib/sources/control";

function parse(body: unknown): StartJobRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { action, rate, limit } = body as Record<string, unknown>;
  if (!JOB_ACTIONS.includes(action as StartJobRequest["action"])) return null;
  if (action !== "replay") return { action: action as StartJobRequest["action"] };
  if (!REPLAY_RATES.includes(rate as (typeof REPLAY_RATES)[number])) return null;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) return null;
  return { action: "replay", rate: rate as number, limit };
}

/** Start a replay, the batch pipeline or a single step. */
export async function POST(request: Request) {
  await connection();
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const job = parse(await request.json().catch(() => null));
  if (!job) return Response.json({ error: "invalid job request" }, { status: 400 });
  try {
    return Response.json(await startJob(job), { status: 202 });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
