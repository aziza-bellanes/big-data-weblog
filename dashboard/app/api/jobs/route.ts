import { connection } from "next/server";
import { controlErrorResponse, rejectCrossOrigin } from "@/lib/api";
import { isArchName } from "@/lib/arch";
import { selectedArch } from "@/lib/architectures";
import { JOB_ACTIONS, RATED_ACTIONS, REPLAY_RATES, startJob, type StartJobRequest } from "@/lib/sources/control";

const isLimit = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

async function parse(body: unknown): Promise<StartJobRequest | null> {
  if (typeof body !== "object" || body === null) return null;
  const { action, arch, rate, limit, fresh } = body as Record<string, unknown>;
  if (!JOB_ACTIONS.includes(action as StartJobRequest["action"])) return null;
  if (arch !== undefined && !isArchName(arch)) return null;
  const job: StartJobRequest = { action: action as StartJobRequest["action"] };
  // A comparison runs both architectures; every other job runs the one asked for or selected.
  if (job.action !== "compare") job.arch = isArchName(arch) ? arch : await selectedArch();
  if (RATED_ACTIONS.includes(job.action)) {
    if (!REPLAY_RATES.includes(rate as (typeof REPLAY_RATES)[number]) || !isLimit(limit)) return null;
    Object.assign(job, { rate, limit });
  }
  if (job.action === "compare") job.fresh = fresh !== false;
  return job;
}

/** Start a replay, the batch pipeline, a single step or a comparison. */
export async function POST(request: Request) {
  await connection();
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const job = await parse(await request.json().catch(() => null));
  if (!job) return Response.json({ error: "invalid job request" }, { status: 400 });
  try {
    return Response.json(await startJob(job), { status: 202 });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
