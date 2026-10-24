import { findMediaPreferences, saveMediaPreference } from "@/db/media-preferences";

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { fingerprints?: unknown };
  if (!Array.isArray(body.fingerprints)) {
    return Response.json({ error: "Ongeldige lijst met bestanden." }, { status: 400 });
  }
  const fingerprints = body.fingerprints.filter(validFingerprint);
  try {
    const preferences = await findMediaPreferences(fingerprints);
    return Response.json({ preferences }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voorkeuren laden is mislukt.";
    return Response.json({ error: message }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    fingerprint?: unknown;
    favorite?: unknown;
    forgotten?: unknown;
  };
  if (
    !validFingerprint(body.fingerprint) ||
    typeof body.favorite !== "boolean" ||
    typeof body.forgotten !== "boolean" ||
    (body.favorite && body.forgotten)
  ) {
    return Response.json({ error: "Ongeldige mediavoorkeur." }, { status: 400 });
  }
  try {
    await saveMediaPreference({
      fingerprint: body.fingerprint,
      favorite: body.favorite,
      forgotten: body.forgotten,
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voorkeur opslaan is mislukt.";
    return Response.json({ error: message }, { status: 503 });
  }
}
