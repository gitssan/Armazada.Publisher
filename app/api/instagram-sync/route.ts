import { env } from "cloudflare:workers";

import {
  listPublishedMedia,
  updateCollaborationStatuses,
  updateInstagramMediaPresence,
} from "@/db/media-history";
import {
  listInstagramMediaIds,
  publishingConfiguration,
  verifyInstagramCollaborators,
  type PublishingEnv,
} from "@/lib/publishing";

export async function POST() {
  const runtimeEnv = env as unknown as PublishingEnv;
  if (!publishingConfiguration(runtimeEnv).instagram) {
    return Response.json({ error: "Instagram is nog niet gekoppeld." }, { status: 503 });
  }

  try {
    const [records, instagramIds] = await Promise.all([
      listPublishedMedia(),
      listInstagramMediaIds(runtimeEnv),
    ]);
    const checkedAt = Date.now();
    const presence = records.map((record) => ({
      fingerprint: record.fingerprint,
      active: instagramIds.has(record.instagramMediaId),
    }));
    await updateInstagramMediaPresence(presence, checkedAt);

    const collaborationRecords = records.filter(
      (record) =>
        instagramIds.has(record.instagramMediaId) && record.collaboratorsRequested.length > 0,
    );
    const collaborations: Array<{
      fingerprint: string;
      requested: string[];
      status: "not_requested" | "confirmed" | "partial" | "unverified";
      details: Array<{ username: string; inviteStatus?: string }>;
      checkedAt: number | null;
    }> = [];
    for (let offset = 0; offset < collaborationRecords.length; offset += 4) {
      const batch = collaborationRecords.slice(offset, offset + 4);
      const results = await Promise.all(
        batch.map(async (record) => ({
          fingerprint: record.fingerprint,
          ...(await verifyInstagramCollaborators(
            record.instagramMediaId,
            record.collaboratorsRequested,
            runtimeEnv,
            0,
          )),
        })),
      );
      collaborations.push(...results);
    }
    await updateCollaborationStatuses(collaborations);

    const active = presence.filter((record) => record.active).map((record) => record.fingerprint);
    const removed = presence.filter((record) => !record.active).map((record) => record.fingerprint);
    const trackedIds = new Set(records.map((record) => record.instagramMediaId));
    const otherInstagramPosts = [...instagramIds].filter((id) => !trackedIds.has(id)).length;

    return Response.json(
      {
        ok: true,
        checkedAt,
        active,
        removed,
        collaborations,
        instagramPostCount: instagramIds.size,
        otherInstagramPosts,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram controleren is mislukt.";
    return Response.json({ error: message }, { status: 502 });
  }
}
