import { env } from "cloudflare:workers";

import {
  googleDriveConfiguration,
  listGoogleDriveMedia,
  type GoogleDriveEnv,
} from "@/lib/google-drive";

export async function GET() {
  const runtimeEnv = env as unknown as GoogleDriveEnv;
  if (!googleDriveConfiguration(runtimeEnv).ready) {
    return Response.json({ error: "Google Drive is nog niet gekoppeld." }, { status: 503 });
  }

  try {
    const items = await listGoogleDriveMedia(runtimeEnv);
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive kon niet worden ingelezen.";
    return Response.json({ error: message }, { status: 502 });
  }
}
