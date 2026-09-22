import { env } from "cloudflare:workers";

type PublishedMediaRecord = {
  fingerprint: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  mediaType: "image" | "video";
  instagramMediaId: string;
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
      .prepare(`SELECT fingerprint FROM published_media WHERE fingerprint IN (${placeholders})`)
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    found.push(...result.results.map((row) => row.fingerprint));
  }

  return found;
}

export async function recordPublishedMedia(record: PublishedMediaRecord) {
  const database = getDatabase();
  await database
    .prepare(
      `INSERT INTO published_media (
        fingerprint, file_name, file_size, last_modified, media_type,
        instagram_media_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        last_modified = excluded.last_modified,
        media_type = excluded.media_type,
        instagram_media_id = excluded.instagram_media_id,
        published_at = excluded.published_at`,
    )
    .bind(
      record.fingerprint,
      record.fileName,
      record.fileSize,
      record.lastModified,
      record.mediaType,
      record.instagramMediaId,
      Date.now(),
    )
    .run();
}
