import { connection } from "next/server";
import { controlErrorResponse } from "@/lib/api";
import { fetchRun } from "@/lib/sources/control";

/** One run or comparison record, with its progress samples. */
export async function GET(_request: Request, { params }: RouteContext<"/api/runs/[id]">) {
  await connection();
  const { id } = await params;
  if (!/^[a-f0-9]{1,32}$/.test(id)) return Response.json({ error: "invalid run id" }, { status: 400 });
  try {
    return Response.json(await fetchRun(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
