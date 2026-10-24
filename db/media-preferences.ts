import { env } from "cloudflare:workers";

type MediaPreference = {
  fingerprint: string;
  favorite: boolean;
  forgotten: boolean;
};

function getDatabase() {
  if (!env.DB) throw new Error("De mediavoorkeuren zijn niet beschikbaar.");
  return env.DB;
}

export async function findMediaPreferences(fingerprints: string[]) {
  const unique = [...new Set(fingerprints)].slice(0, 500);
  if (!unique.length) return [];
  const database = getDatabase();
  const found: MediaPreference[] = [];

  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT fingerprint, favorite, forgotten
         FROM media_preferences
         WHERE fingerprint IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ fingerprint: string; favorite: number; forgotten: number }>();
    found.push(
      ...result.results.map((row) => ({
        fingerprint: row.fingerprint,
        favorite: Boolean(row.favorite),
        forgotten: Boolean(row.forgotten),
      })),
    );
  }

  return found;
}

export async function saveMediaPreference(preference: MediaPreference) {
  const database = getDatabase();
  await database
    .prepare(
      `INSERT INTO media_preferences (fingerprint, favorite, forgotten, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         favorite = excluded.favorite,
         forgotten = excluded.forgotten,
         updated_at = excluded.updated_at`,
    )
    .bind(
      preference.fingerprint,
      preference.favorite ? 1 : 0,
      preference.forgotten ? 1 : 0,
      Date.now(),
    )
    .run();
}
