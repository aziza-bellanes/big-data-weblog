import { connection } from "next/server";
import { architectureChoices, selectedArch } from "@/lib/architectures";

/** The two architectures and the one selected, for the switch in the top bar. */
export async function GET() {
  await connection();
  return Response.json({ selected: await selectedArch(), choices: architectureChoices() });
}
