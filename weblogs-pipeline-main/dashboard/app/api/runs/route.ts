import { connection } from "next/server";
import { controlErrorResponse } from "@/lib/api";
import { fetchRuns } from "@/lib/sources/control";

/** Recorded runs and comparisons, most recent first (without their progress samples). */
export async function GET() {
  await connection();
  try {
    return Response.json(await fetchRuns(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
