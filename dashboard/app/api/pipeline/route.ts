import { connection } from "next/server";
import { selectedArch } from "@/lib/architectures";
import { takeSnapshot } from "@/lib/pipeline";

/** Live state of every stage of the selected architecture (?arch=…, else the switch's choice). */
export async function GET(request: Request) {
  await connection();
  const arch = await selectedArch(new URL(request.url).searchParams.get("arch"));
  return Response.json(await takeSnapshot(arch), {
    headers: { "Cache-Control": "no-store" },
  });
}
