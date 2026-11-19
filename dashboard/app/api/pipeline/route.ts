import { connection } from "next/server";
import { takeSnapshot } from "@/lib/pipeline";

/** Live state of every stage of the pipeline. */
export async function GET() {
  await connection();
  return Response.json(await takeSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
