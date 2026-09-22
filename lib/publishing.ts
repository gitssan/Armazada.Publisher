type PublishingEnv = {
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  INSTAGRAM_ACCOUNT_ID?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  META_GRAPH_VERSION?: string;
};

type UploadedAsset = {
  publicId: string;
  resourceType: "image" | "video";
  publicUrl: string;
};

type JsonRecord = Record<string, unknown>;

function requireValue(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} ontbreekt in de app-instellingen.`);
  return value;
}

async function sha1(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSignatureInput(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function parseJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    const nestedError = payload.error as JsonRecord | undefined;
    const message =
      (nestedError?.message as string | undefined) ||
      (payload.message as string | undefined) ||
      `Externe dienst gaf foutcode ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

export function publishingConfiguration(env: PublishingEnv) {
  const instagram = Boolean(env.INSTAGRAM_ACCOUNT_ID && env.INSTAGRAM_ACCESS_TOKEN);
  const temporaryMedia = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
  return {
    instagram,
    temporaryMedia,
    ready: instagram && temporaryMedia,
  };
}

export async function uploadTemporaryAsset(file: File, env: PublishingEnv): Promise<UploadedAsset> {
  const cloudName = requireValue(env.CLOUDINARY_CLOUD_NAME, "Cloudinary cloud name");
  const apiKey = requireValue(env.CLOUDINARY_API_KEY, "Cloudinary API-key");
  const apiSecret = requireValue(env.CLOUDINARY_API_SECRET, "Cloudinary API-secret");
  const resourceType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const publicId = `armazada-${crypto.randomUUID()}`;
  const params = {
    folder: "armazada-instagram-temp",
    public_id: publicId,
    timestamp,
  };
  const signature = await sha1(`${buildSignatureInput(params)}${apiSecret}`);
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("api_key", apiKey);
  body.set("signature", signature);
  Object.entries(params).forEach(([key, value]) => body.set(key, value));

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`,
    { method: "POST", body },
  );
  const payload = await parseJson(response);
  const secureUrl = payload.secure_url as string | undefined;
  const returnedPublicId = payload.public_id as string | undefined;
  if (!secureUrl || !returnedPublicId) throw new Error("Tijdelijke upload leverde geen bruikbare URL op.");

  const publicUrl =
    resourceType === "image"
      ? secureUrl.replace("/upload/", "/upload/c_limit,w_1440,q_auto,f_jpg/")
      : secureUrl;

  return { publicId: returnedPublicId, resourceType, publicUrl };
}

export async function removeTemporaryAsset(asset: UploadedAsset, env: PublishingEnv) {
  const cloudName = requireValue(env.CLOUDINARY_CLOUD_NAME, "Cloudinary cloud name");
  const apiKey = requireValue(env.CLOUDINARY_API_KEY, "Cloudinary API-key");
  const apiSecret = requireValue(env.CLOUDINARY_API_SECRET, "Cloudinary API-secret");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { invalidate: "true", public_id: asset.publicId, timestamp };
  const signature = await sha1(`${buildSignatureInput(params)}${apiSecret}`);
  const body = new URLSearchParams({ ...params, api_key: apiKey, signature });
  await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${asset.resourceType}/destroy`,
    { method: "POST", body },
  );
}

async function waitUntilReady(baseUrl: string, containerId: string, token: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await fetch(
      `${baseUrl}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    const payload = await parseJson(response);
    const status = payload.status_code as string | undefined;
    if (status === "FINISHED" || !status) return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error((payload.status as string | undefined) || `Instagram-status: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error("Instagram had te lang nodig om het bestand te verwerken.");
}

export async function publishToInstagram(
  asset: UploadedAsset,
  caption: string,
  env: PublishingEnv,
  collaborator?: string,
) {
  const accountId = requireValue(env.INSTAGRAM_ACCOUNT_ID, "Instagram account-ID");
  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const baseUrl = `https://graph.instagram.com/${version}`;
  const createBody = new URLSearchParams({ caption, access_token: accessToken });

  if (collaborator) {
    createBody.set("collaborators", JSON.stringify([collaborator]));
  }

  if (asset.resourceType === "video") {
    createBody.set("media_type", "REELS");
    createBody.set("video_url", asset.publicUrl);
    createBody.set("share_to_feed", "true");
  } else {
    createBody.set("image_url", asset.publicUrl);
  }

  const createResponse = await fetch(`${baseUrl}/${encodeURIComponent(accountId)}/media`, {
    method: "POST",
    body: createBody,
  });
  const created = await parseJson(createResponse);
  const containerId = created.id as string | undefined;
  if (!containerId) throw new Error("Instagram maakte geen publicatiecontainer aan.");

  await waitUntilReady(baseUrl, containerId, accessToken);
  const publishResponse = await fetch(`${baseUrl}/${encodeURIComponent(accountId)}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
  });
  const published = await parseJson(publishResponse);
  const mediaId = published.id as string | undefined;
  if (!mediaId) throw new Error("Instagram bevestigde de publicatie niet.");
  return { mediaId };
}

export type { PublishingEnv };
