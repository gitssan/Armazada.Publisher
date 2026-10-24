import { findPublishedFingerprints, findRemovedFingerprints } from "@/db/media-history";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { fingerprints?: unknown };
  if (!Array.isArray(body.fingerprints)) {
    return Response.json({ error: "Ongeldige lijst met bestanden." }, { status: 400 });
  }
  const fingerprints = body.fingerprints.filter(
    (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024,
  );
  try {
    const [published, removed] = await Promise.all([
      findPublishedFingerprints(fingerprints),
      findRemovedFingerprints(fingerprints),
    ]);
    return Response.json({ published, removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Geschiedenis laden is mislukt.";
    return Response.json({ error: message }, { status: 503 });
  }
}
