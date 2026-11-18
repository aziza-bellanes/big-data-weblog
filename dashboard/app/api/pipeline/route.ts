import { connection } from "next/server";
import { takeSnapshot } from "@/lib/pipeline";

/** Live state of every pipeline stage, polled by the Pipeline page. */
export async function GET() {
  await connection();
  return Response.json(await takeSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
