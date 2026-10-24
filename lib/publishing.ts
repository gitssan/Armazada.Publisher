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

type CollaboratorVerification = {
  requested: string[];
  status: "not_requested" | "confirmed" | "partial" | "unverified";
  details: Array<{ username: string; inviteStatus?: string }>;
  checkedAt: number | null;
  warning?: string;
};

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
  collaborators: string[] = [],
) {
  const accountId = requireValue(env.INSTAGRAM_ACCOUNT_ID, "Instagram account-ID");
  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const baseUrl = `https://graph.instagram.com/${version}`;
  const createBody = new URLSearchParams({ caption, access_token: accessToken });

  if (collaborators.length) {
    createBody.set("collaborators", JSON.stringify(collaborators));
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
  const collaboration = await verifyInstagramCollaborators(mediaId, collaborators, env);
  return { mediaId, collaboration };
}

async function verifyInstagramCollaborators(
  mediaId: string,
  requested: string[],
  env: PublishingEnv,
): Promise<CollaboratorVerification> {
  if (!requested.length) {
    return { requested: [], status: "not_requested", details: [], checkedAt: null };
  }

  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const url = new URL(
    `https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/collaborators`,
  );
  url.searchParams.set("fields", "username,invite_status");
  url.searchParams.set("access_token", accessToken);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const checkedAt = Date.now();
  try {
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return {
        requested,
        status: "unverified",
        details: [],
        checkedAt,
        warning: "De post is geplaatst, maar Instagram liet de collaborator-uitnodigingen niet automatisch controleren.",
      };
    }
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    const data = Array.isArray(payload.data) ? payload.data : [];
    const details = data.flatMap((entry) => {
      const record = entry as JsonRecord;
      const username = typeof record.username === "string" ? record.username : "";
      if (!username) return [];
      return [{
        username,
        inviteStatus: typeof record.invite_status === "string" ? record.invite_status : undefined,
      }];
    });
    const confirmed = new Set(details.map((detail) => detail.username.toLowerCase()));
    const missing = requested.filter((username) => !confirmed.has(username.toLowerCase()));
    return {
      requested,
      status: missing.length ? "partial" : "confirmed",
      details,
      checkedAt,
      warning: missing.length
        ? `Instagram bevestigde de collaborator-uitnodiging niet voor @${missing.join(", @")}. Controleer deze post handmatig.`
        : undefined,
    };
  } catch {
    return {
      requested,
      status: "unverified",
      details: [],
      checkedAt,
      warning: "De post is geplaatst, maar de collaborator-uitnodigingen konden niet worden gecontroleerd.",
    };
  }
}

export async function listInstagramMediaIds(env: PublishingEnv) {
  const accountId = requireValue(env.INSTAGRAM_ACCOUNT_ID, "Instagram account-ID");
  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const baseUrl = `https://graph.instagram.com/${version}`;
  const firstPage = new URL(`${baseUrl}/${encodeURIComponent(accountId)}/media`);
  firstPage.searchParams.set("fields", "id");
  firstPage.searchParams.set("limit", "100");
  firstPage.searchParams.set("access_token", accessToken);

  const ids = new Set<string>();
  let nextUrl: string | null = firstPage.toString();
  let pageCount = 0;

  while (nextUrl) {
    pageCount += 1;
    if (pageCount > 100) {
      throw new Error("Instagram heeft meer dan 10.000 posts; de controle is daarom gestopt.");
    }

    const response = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    const payload = await parseJson(response);
    const data = Array.isArray(payload.data) ? payload.data : [];
    for (const entry of data) {
      const id = (entry as JsonRecord).id;
      if (typeof id === "string" && id) ids.add(id);
    }

    const next = (payload.paging as JsonRecord | undefined)?.next;
    if (typeof next !== "string" || !next) {
      nextUrl = null;
      continue;
    }
    const parsedNext = new URL(next);
    if (parsedNext.origin !== "https://graph.instagram.com") {
      throw new Error("Instagram gaf een ongeldige vervolgpagina terug.");
    }
    nextUrl = parsedNext.toString();
  }

  return ids;
}

export type { PublishingEnv };
