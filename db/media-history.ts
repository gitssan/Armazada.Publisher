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
        `SELECT fingerprint FROM published_media
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
         WHERE instagram_status = 'removed' AND fingerprint IN (${placeholders})`,
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
        `SELECT fingerprint, collaborators_requested AS requested,
                collaborator_status AS status, collaborator_details AS details
         FROM published_media WHERE fingerprint IN (${placeholders})`,
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
      `SELECT fingerprint, instagram_media_id AS instagramMediaId
       FROM published_media`,
    )
    .all<{ fingerprint: string; instagramMediaId: string }>();
  return result.results;
}

export async function updateInstagramMediaPresence(
  presence: Array<{ fingerprint: string; active: boolean }>,
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
             WHERE fingerprint = ?`,
          )
          .bind(
            record.active ? "active" : "removed",
            checkedAt,
            record.active ? "active" : "removed",
            checkedAt,
            record.fingerprint,
          ),
      ),
    );
  }
}

export async function recordPublishedMedia(record: PublishedMediaRecord) {
  const database = getDatabase();
  await database
    .prepare(
      `INSERT INTO published_media (
        fingerprint, file_name, file_size, last_modified, media_type,
        instagram_media_id, published_at, collaborators_requested,
        collaborator_status, collaborator_details, collaborator_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        last_modified = excluded.last_modified,
        media_type = excluded.media_type,
        instagram_media_id = excluded.instagram_media_id,
        published_at = excluded.published_at,
        instagram_status = 'active',
        instagram_checked_at = NULL,
        instagram_removed_at = NULL,
        collaborators_requested = excluded.collaborators_requested,
        collaborator_status = excluded.collaborator_status,
        collaborator_details = excluded.collaborator_details,
        collaborator_checked_at = excluded.collaborator_checked_at`,
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
}
