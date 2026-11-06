import { env } from "cloudflare:workers";

import { listPublishedMediaForInsights } from "@/db/media-history";
import {
  getInstagramMediaInsights,
  publishingConfiguration,
  type PublishingEnv,
} from "@/lib/publishing";

export async function GET() {
  const runtimeEnv = env as unknown as PublishingEnv;
  if (!publishingConfiguration(runtimeEnv).instagram) {
    return Response.json({ error: "Instagram is nog niet gekoppeld." }, { status: 503 });
  }

  try {
    const records = await listPublishedMediaForInsights();
    const insights = [];

    for (let offset = 0; offset < records.length; offset += 4) {
      const batch = records.slice(offset, offset + 4);
      const results = await Promise.all(
        batch.map(async (record) => {
          try {
            const metrics = await getInstagramMediaInsights(record.instagramMediaId, runtimeEnv);
            return { ...record, ...metrics };
          } catch (error) {
            return {
              ...record,
              mediaId: record.instagramMediaId,
              likes: 0,
              comments: 0,
              views: null,
              reach: null,
              saved: null,
              shares: null,
              totalInteractions: null,
              warning:
                error instanceof Error ? error.message : "Statistieken ophalen is mislukt.",
            };
          }
        }),
      );
      insights.push(...results);
    }

    const warnings = [...new Set(insights.flatMap((item) => (item.warning ? [item.warning] : [])))];
    return Response.json(
      { checkedAt: Date.now(), insights, warnings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram-statistieken laden is mislukt.";
    return Response.json({ error: message }, { status: 502 });
  }
}
