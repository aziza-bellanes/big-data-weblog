import { connection } from "next/server";
import { controlErrorResponse, rejectCrossOrigin } from "@/lib/api";
import { JOB_ACTIONS, RATED_ACTIONS, REPLAY_RATES, startJob, type StartJobRequest } from "@/lib/sources/control";

const isLimit = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function parse(body: unknown): StartJobRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { action, rate, limit } = body as Record<string, unknown>;
  if (!JOB_ACTIONS.includes(action as StartJobRequest["action"])) return null;
  const job: StartJobRequest = { action: action as StartJobRequest["action"], arch: "parallel" };
  if (RATED_ACTIONS.includes(job.action)) {
    if (!REPLAY_RATES.includes(rate as (typeof REPLAY_RATES)[number]) || !isLimit(limit)) return null;
    Object.assign(job, { rate, limit });
  }
  return job;
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
