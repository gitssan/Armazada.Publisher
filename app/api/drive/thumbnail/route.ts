import { env } from "cloudflare:workers";

import { fetchGoogleDriveThumbnail, type GoogleDriveEnv } from "@/lib/google-drive";

export async function GET(request: Request) {
  const fileId = new URL(request.url).searchParams.get("id") || "";
  if (!fileId || fileId.length > 256) {
    return Response.json({ error: "Ongeldig Google Drive-bestand." }, { status: 400 });
  }

  try {
    const source = await fetchGoogleDriveThumbnail(fileId, env as unknown as GoogleDriveEnv);
    return new Response(source.body, {
      headers: {
        "Content-Type": source.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voorbeeld kon niet worden geladen.";
    return Response.json({ error: message }, { status: 502 });
  }
}
