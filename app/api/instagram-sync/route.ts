import { env } from "cloudflare:workers";

import {
  listPublishedMedia,
  updateCollaborationStatuses,
  updateInstagramMediaPresence,
} from "@/db/media-history";
import {
  listInstagramMedia,
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
    const [records, instagramMedia] = await Promise.all([
      listPublishedMedia(),
      listInstagramMedia(runtimeEnv),
    ]);
    const instagramIds = new Set(instagramMedia.map((item) => item.id));
    const checkedAt = Date.now();
    const presence = records.map((record) => ({
      publicationId: record.publicationId,
      fingerprint: record.fingerprint,
      active: instagramIds.has(record.instagramMediaId),
    }));
    await updateInstagramMediaPresence(presence, checkedAt);

    const collaborationRecords = records.filter(
      (record) =>
        instagramIds.has(record.instagramMediaId) && record.collaboratorsRequested.length > 0,
    );
    const collaborations: Array<{
      publicationId: number;
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
          publicationId: record.publicationId,
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

    const active = [
      ...new Set(presence.filter((record) => record.active).map((record) => record.fingerprint)),
    ];
    const allFingerprints = new Set(records.map((record) => record.fingerprint));
    const activeFingerprints = new Set(active);
    const removed = [...allFingerprints].filter(
      (fingerprint) => !activeFingerprints.has(fingerprint),
    );
    const collaborationByPublication = new Map(
      collaborations.map((collaboration) => [collaboration.publicationId, collaboration]),
    );
    const publications = records.map((record) => {
      const collaboration = collaborationByPublication.get(record.publicationId);
      return {
        ...record,
        instagramStatus: instagramIds.has(record.instagramMediaId) ? "active" : "removed",
        instagramCheckedAt: checkedAt,
        collaboratorStatus: collaboration?.status ?? record.collaboratorStatus,
        collaboratorDetails: collaboration?.details ?? record.collaboratorDetails,
        collaboratorCheckedAt: collaboration?.checkedAt ?? record.collaboratorCheckedAt,
      };
    });
    const trackedIds = new Set(records.map((record) => record.instagramMediaId));
    const otherInstagramMedia = instagramMedia.filter((item) => !trackedIds.has(item.id));
    const otherInstagramPosts = otherInstagramMedia.length;

    return Response.json(
      {
        ok: true,
        checkedAt,
        active,
        removed,
        collaborations,
        publications,
        instagramMedia,
        otherInstagramMedia,
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
