import { env } from "cloudflare:workers";

type PublishedMediaRecord = {
  fingerprint: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  mediaType: "image" | "video";
  instagramMediaId: string;
  collaboratorsRequested: string[];
  collaboratorStatus: "not_requested" | "confirmed" | "partial" | "unverified";
  collaboratorDetails: Array<{ username: string; inviteStatus?: string }>;
  collaboratorCheckedAt: number | null;
};

type PublicationHistoryRecord = {
  publicationId: number;
  fingerprint: string;
  instagramMediaId: string;
  publishedAt: number;
  instagramStatus: "active" | "removed";
  instagramCheckedAt: number | null;
  instagramRemovedAt: number | null;
  collaboratorsRequested: string[];
  collaboratorStatus: "not_requested" | "confirmed" | "partial" | "unverified" | "unknown";
  collaboratorDetails: Array<{ username: string; inviteStatus?: string }>;
  collaboratorCheckedAt: number | null;
};

function getDatabase() {
  if (!env.DB) throw new Error("De publicatiegeschiedenis is niet beschikbaar.");
  return env.DB;
}

export async function findPublishedFingerprints(fingerprints: string[]) {
  const unique = [...new Set(fingerprints)].slice(0, 500);
  if (!unique.length) return [];
  const database = getDatabase();
  const found: string[] = [];

  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT DISTINCT fingerprint FROM published_media
         WHERE instagram_status = 'active' AND fingerprint IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    found.push(...result.results.map((row) => row.fingerprint));
  }

  return found;
}

export async function findRemovedFingerprints(fingerprints: string[]) {
  const unique = [...new Set(fingerprints)].slice(0, 500);
  if (!unique.length) return [];
  const database = getDatabase();
  const found: string[] = [];

  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT fingerprint FROM published_media
         WHERE fingerprint IN (${placeholders})
         GROUP BY fingerprint
         HAVING SUM(CASE WHEN instagram_status = 'active' THEN 1 ELSE 0 END) = 0
            AND SUM(CASE WHEN instagram_status = 'removed' THEN 1 ELSE 0 END) > 0`,
      )
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    found.push(...result.results.map((row) => row.fingerprint));
  }

  return found;
}

export async function findCollaborationStatuses(fingerprints: string[]) {
  const unique = [...new Set(fingerprints)].slice(0, 500);
  if (!unique.length) return [];
  const database = getDatabase();
  const found: Array<{
    fingerprint: string;
    requested: string[];
    status: string;
    details: Array<{ username: string; inviteStatus?: string }>;
  }> = [];

  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT media.fingerprint, media.collaborators_requested AS requested,
                media.collaborator_status AS status, media.collaborator_details AS details
         FROM published_media AS media
         INNER JOIN (
           SELECT fingerprint, MAX(publication_id) AS latestPublicationId
           FROM published_media
           WHERE fingerprint IN (${placeholders})
           GROUP BY fingerprint
         ) AS latest ON latest.latestPublicationId = media.publication_id`,
      )
      .bind(...chunk)
      .all<{ fingerprint: string; requested: string; status: string; details: string | null }>();

    for (const row of result.results) {
      try {
        found.push({
          fingerprint: row.fingerprint,
          requested: JSON.parse(row.requested) as string[],
          status: row.status,
          details: row.details ? (JSON.parse(row.details) as Array<{ username: string; inviteStatus?: string }>) : [],
        });
      } catch {
        found.push({ fingerprint: row.fingerprint, requested: [], status: "unknown", details: [] });
      }
    }
  }

  return found;
}

export async function listPublishedMedia() {
  const database = getDatabase();
  const result = await database
    .prepare(
      `SELECT publication_id AS publicationId, fingerprint,
              file_name AS fileName, media_type AS mediaType,
              instagram_media_id AS instagramMediaId,
              published_at AS publishedAt,
              instagram_status AS instagramStatus,
              instagram_checked_at AS instagramCheckedAt,
              instagram_removed_at AS instagramRemovedAt,
              collaborators_requested AS collaboratorsRequested,
              collaborator_status AS collaboratorStatus,
              collaborator_details AS collaboratorDetails,
              collaborator_checked_at AS collaboratorCheckedAt
       FROM published_media`,
    )
    .all<{
      publicationId: number;
      fingerprint: string;
      fileName: string;
      mediaType: "image" | "video";
      instagramMediaId: string;
      publishedAt: number;
      instagramStatus: "active" | "removed";
      instagramCheckedAt: number | null;
      instagramRemovedAt: number | null;
      collaboratorsRequested: string;
      collaboratorStatus: "not_requested" | "confirmed" | "partial" | "unverified" | "unknown";
      collaboratorDetails: string | null;
      collaboratorCheckedAt: number | null;
    }>();
  return result.results.map((record) => {
    try {
      return {
        ...record,
        collaboratorsRequested: JSON.parse(record.collaboratorsRequested) as string[],
        collaboratorDetails: record.collaboratorDetails
          ? (JSON.parse(record.collaboratorDetails) as Array<{ username: string; inviteStatus?: string }>)
          : [],
      };
    } catch {
      return {
        ...record,
        collaboratorsRequested: [] as string[],
        collaboratorDetails: [] as Array<{ username: string; inviteStatus?: string }>,
      };
    }
  });
}

export async function findPublicationHistories(fingerprints: string[]) {
  const unique = [...new Set(fingerprints)].slice(0, 500);
  if (!unique.length) return [];
  const database = getDatabase();
  const found: PublicationHistoryRecord[] = [];

  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT publication_id AS publicationId, fingerprint,
                instagram_media_id AS instagramMediaId,
                published_at AS publishedAt,
                instagram_status AS instagramStatus,
                instagram_checked_at AS instagramCheckedAt,
                instagram_removed_at AS instagramRemovedAt,
                collaborators_requested AS collaboratorsRequested,
                collaborator_status AS collaboratorStatus,
                collaborator_details AS collaboratorDetails,
                collaborator_checked_at AS collaboratorCheckedAt
         FROM published_media
         WHERE fingerprint IN (${placeholders})
         ORDER BY published_at DESC, publication_id DESC`,
      )
      .bind(...chunk)
      .all<{
        publicationId: number;
        fingerprint: string;
        instagramMediaId: string;
        publishedAt: number;
        instagramStatus: "active" | "removed";
        instagramCheckedAt: number | null;
        instagramRemovedAt: number | null;
        collaboratorsRequested: string;
        collaboratorStatus: PublicationHistoryRecord["collaboratorStatus"];
        collaboratorDetails: string | null;
        collaboratorCheckedAt: number | null;
      }>();

    for (const record of result.results) {
      try {
        found.push({
          ...record,
          collaboratorsRequested: JSON.parse(record.collaboratorsRequested) as string[],
          collaboratorDetails: record.collaboratorDetails
            ? (JSON.parse(record.collaboratorDetails) as Array<{ username: string; inviteStatus?: string }>)
            : [],
        });
      } catch {
        found.push({
          ...record,
          collaboratorsRequested: [],
          collaboratorDetails: [],
        });
      }
    }
  }
  return found;
}

export async function updateCollaborationStatuses(
  updates: Array<{
    publicationId: number;
    status: "not_requested" | "confirmed" | "partial" | "unverified";
    details: Array<{ username: string; inviteStatus?: string }>;
    checkedAt: number | null;
  }>,
) {
  if (!updates.length) return;
  const database = getDatabase();
  for (let offset = 0; offset < updates.length; offset += 50) {
    const chunk = updates.slice(offset, offset + 50);
    await database.batch(
      chunk.map((update) =>
        database
          .prepare(
            `UPDATE published_media
             SET collaborator_status = ?, collaborator_details = ?, collaborator_checked_at = ?
             WHERE publication_id = ?`,
          )
          .bind(
            update.status,
            JSON.stringify(update.details),
            update.checkedAt,
            update.publicationId,
          ),
      ),
    );
  }
}

export async function listPublishedMediaForInsights() {
  const database = getDatabase();
  const result = await database
    .prepare(
      `SELECT fingerprint,
              file_name AS fileName,
              media_type AS mediaType,
              instagram_media_id AS instagramMediaId,
              published_at AS publishedAt,
              instagram_status AS instagramStatus
       FROM published_media
       WHERE instagram_status = 'active'
       ORDER BY published_at DESC`,
    )
    .all<{
      fingerprint: string;
      fileName: string;
      mediaType: "image" | "video";
      instagramMediaId: string;
      publishedAt: number;
      instagramStatus: string;
    }>();
  return result.results;
}

export async function updateInstagramMediaPresence(
  presence: Array<{ publicationId: number; active: boolean }>,
  checkedAt: number,
) {
  if (!presence.length) return;
  const database = getDatabase();

  for (let offset = 0; offset < presence.length; offset += 50) {
    const chunk = presence.slice(offset, offset + 50);
    await database.batch(
      chunk.map((record) =>
        database
          .prepare(
            `UPDATE published_media
             SET instagram_status = ?,
                 instagram_checked_at = ?,
                 instagram_removed_at = CASE
                   WHEN ? = 'removed' THEN COALESCE(instagram_removed_at, ?)
                   ELSE NULL
                 END
             WHERE publication_id = ?`,
          )
          .bind(
            record.active ? "active" : "removed",
            checkedAt,
            record.active ? "active" : "removed",
            checkedAt,
            record.publicationId,
          ),
      ),
    );
  }
}

export async function recordPublishedMedia(record: PublishedMediaRecord) {
  const database = getDatabase();
  const result = await database
    .prepare(
      `INSERT INTO published_media (
        fingerprint, file_name, file_size, last_modified, media_type,
        instagram_media_id, published_at, collaborators_requested,
        collaborator_status, collaborator_details, collaborator_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.fingerprint,
      record.fileName,
      record.fileSize,
      record.lastModified,
      record.mediaType,
      record.instagramMediaId,
      Date.now(),
      JSON.stringify(record.collaboratorsRequested),
      record.collaboratorStatus,
      JSON.stringify(record.collaboratorDetails),
      record.collaboratorCheckedAt,
    )
    .run();
  return Number((result.meta as { last_row_id?: number }).last_row_id || 0);
}
