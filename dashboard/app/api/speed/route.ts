import { connection } from "next/server";
import { getArchitecture } from "@/lib/architectures";
import { orFallback } from "@/lib/sources/http";
import { fetchSpeed } from "@/lib/sources/mysql";

/**
 * The speed layer, read from the serving tables Spark fills in MySQL: latest minutes, alerts and the
 * day-by-day comparison with the batch layer. Polled by the Real-time page.
 */
export async function GET() {
  await connection();
  const database = getArchitecture().mysqlDb;
  const speed = await orFallback("speed", () => fetchSpeed(database), null);
  if (!speed) {
    return Response.json(
      { error: "The speed layer tables are not readable. Is MySQL up and the schema applied (make db-init)?" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(speed, { headers: { "Cache-Control": "no-store" } });
}
