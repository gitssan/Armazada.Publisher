import { env } from "cloudflare:workers";

import { googleDriveConfiguration, type GoogleDriveEnv } from "@/lib/google-drive";
import { publishingConfiguration, type PublishingEnv } from "@/lib/publishing";

export async function GET() {
  const runtimeEnv = env as unknown as PublishingEnv & GoogleDriveEnv;
  const configuration = publishingConfiguration(runtimeEnv);
  const googleDrive = googleDriveConfiguration(runtimeEnv).ready;
  return Response.json({ ...configuration, googleDrive }, {
    headers: { "Cache-Control": "no-store" },
  });
}
