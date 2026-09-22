import { env } from "cloudflare:workers";

import { recordPublishedMedia } from "@/db/media-history";
import { downloadGoogleDriveMedia, type GoogleDriveEnv } from "@/lib/google-drive";

import {
  publishToInstagram,
  publishingConfiguration,
  removeTemporaryAsset,
  uploadTemporaryAsset,
  type PublishingEnv,
} from "@/lib/publishing";

const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

export async function POST(request: Request) {
  const runtimeEnv = env as unknown as PublishingEnv & GoogleDriveEnv;
  if (!publishingConfiguration(runtimeEnv).ready) {
    return Response.json(
      { error: "Instagram en de tijdelijke media-opslag zijn nog niet gekoppeld." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const caption = String(form.get("caption") || "").trim();
  const fingerprint = String(form.get("fingerprint") || "");
  const collaborator = String(form.get("collaborator") || "")
    .trim()
    .replace(/^@/, "");
  const localMedia = form.get("media");
  const driveFileId = String(form.get("driveFileId") || "").trim();

  if (!(localMedia instanceof File) && !driveFileId) {
    return Response.json({ error: "Er is geen foto of video ontvangen." }, { status: 400 });
  }
  if (driveFileId.length > 256) {
    return Response.json({ error: "Ongeldig Google Drive-bestand." }, { status: 400 });
  }
  if (!fingerprint || fingerprint.length > 1024) {
    return Response.json({ error: "De bestandsherkenning ontbreekt." }, { status: 400 });
  }
  if (!caption || caption.length > 2200) {
    return Response.json({ error: "De caption moet tussen 1 en 2.200 tekens bevatten." }, { status: 400 });
  }
  if (collaborator && !/^[A-Za-z0-9._]{1,30}$/.test(collaborator)) {
    return Response.json({ error: "De Instagram-gebruikersnaam van de collaborator is ongeldig." }, { status: 400 });
  }

  let temporaryAsset: Awaited<ReturnType<typeof uploadTemporaryAsset>> | null = null;
  let media: File | null = null;
  let mediaName = driveFileId ? `Google Drive-bestand ${driveFileId}` : "lokaal bestand";
  try {
    media =
      localMedia instanceof File
        ? localMedia
        : await downloadGoogleDriveMedia(driveFileId, runtimeEnv);
    mediaName = media.name;

    if (!media.type.startsWith("image/") && !media.type.startsWith("video/")) {
      return Response.json({ error: "Dit bestandstype wordt niet ondersteund." }, { status: 415 });
    }
    if (media.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "Dit bestand is groter dan 95 MB." }, { status: 413 });
    }

    temporaryAsset = await uploadTemporaryAsset(media, runtimeEnv);
    const result = await publishToInstagram(temporaryAsset, caption, runtimeEnv, collaborator || undefined);
    let historySaved = true;

    try {
      await recordPublishedMedia({
        fingerprint,
        fileName: media.name,
        fileSize: media.size,
        lastModified: media.lastModified,
        mediaType: temporaryAsset.resourceType,
        instagramMediaId: result.mediaId,
      });
    } catch (error) {
      historySaved = false;
      console.error("Published media history could not be saved", {
        filename: media.name,
        error,
      });
    }

    return Response.json({
      ok: true,
      mediaId: result.mediaId,
      historySaved,
      warning: historySaved
        ? undefined
        : "De post staat op Instagram, maar kon niet in de lokale historie worden opgeslagen.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publiceren is mislukt.";
    console.error("Instagram publish failed", { filename: mediaName, message });
    return Response.json({ error: message }, { status: 502 });
  } finally {
    if (temporaryAsset) {
      await removeTemporaryAsset(temporaryAsset, runtimeEnv).catch((error) =>
        console.error("Temporary media cleanup failed", error),
      );
    }
  }
}
