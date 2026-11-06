import { env } from "cloudflare:workers";

import { fetchGoogleDriveMedia, type GoogleDriveEnv } from "@/lib/google-drive";

export async function GET(request: Request) {
  const fileId = new URL(request.url).searchParams.get("id") || "";
  if (!fileId || fileId.length > 256) {
    return Response.json({ error: "Ongeldig Google Drive-bestand." }, { status: 400 });
  }

  try {
    const { response, file } = await fetchGoogleDriveMedia(
      fileId,
      env as unknown as GoogleDriveEnv,
      request.headers.get("Range"),
    );
    const headers = new Headers({
      "Content-Type": response.headers.get("Content-Type") || file.mimeType,
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": response.headers.get("Accept-Ranges") || "bytes",
    });
    for (const name of ["Content-Length", "Content-Range"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media kon niet worden geladen.";
    return Response.json({ error: message }, { status: 502 });
  }
}
