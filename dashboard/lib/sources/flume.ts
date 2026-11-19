import "server-only";
import { getJson } from "@/lib/sources/http";
import type { FlumeAgentStatus } from "@/lib/types";

// Flume's HTTP monitoring returns one object per component, keyed "SOURCE.x", "CHANNEL.x",
// "SINK.x", with every counter as a string.
type FlumeMetrics = Record<string, Record<string, string>>;

function component(metrics: FlumeMetrics, kind: "SOURCE" | "CHANNEL" | "SINK") {
  const key = Object.keys(metrics).find((name) => name.startsWith(`${kind}.`));
  return key ? metrics[key] : {};
}

const count = (value: string | undefined) => Number(value ?? 0);

export async function fetchFlumeAgent(url: string): Promise<FlumeAgentStatus> {
  const metrics = await getJson<FlumeMetrics>(url);
  const source = component(metrics, "SOURCE");
  const channel = component(metrics, "CHANNEL");
  const sink = component(metrics, "SINK");
  const channelSize = count(channel.ChannelSize);
  return {
    // Flume has no "busy" flag; a non-empty channel means events are in transit.
    state: channelSize > 0 ? "active" : "idle",
    eventsIn: count(source.EventAcceptedCount),
    eventsOut: count(sink.EventDrainSuccessCount),
    channelSize,
    channelFillPct: count(channel.ChannelFillPercentage),
  };
}
