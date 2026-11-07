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

type InstagramMediaInsights = {
  mediaId: string;
  permalink?: string;
  mediaProductType?: string;
  likes: number;
  comments: number;
  views: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  warning?: string;
};

type InstagramMediaSummary = {
  id: string;
  mediaType?: string;
  mediaProductType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
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

export async function verifyInstagramCollaborators(
  mediaId: string,
  requested: string[],
  env: PublishingEnv,
  delayMs = 1500,
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

  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const checkedAt = Date.now();
  try {
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return {
        requested,
        status: "unverified",
        details: requested.map((username) => ({ username, inviteStatus: "Unknown" })),
        checkedAt,
        warning: "De post is geplaatst, maar Instagram liet de collaborator-uitnodigingen niet automatisch controleren.",
      };
    }
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    const data = Array.isArray(payload.data) ? payload.data : [];
    const returnedDetails = data.flatMap((entry) => {
      const record = entry as JsonRecord;
      const username = typeof record.username === "string" ? record.username : "";
      if (!username) return [];
      return [{
        username,
        inviteStatus: typeof record.invite_status === "string" ? record.invite_status : undefined,
      }];
    });
    const returnedByUsername = new Map(
      returnedDetails.map((detail) => [detail.username.toLowerCase(), detail]),
    );
    const details = requested.map(
      (username) =>
        returnedByUsername.get(username.toLowerCase()) || { username, inviteStatus: "Unknown" },
    );
    const accepted = details.filter(
      (detail) => detail.inviteStatus?.toLowerCase() === "accepted",
    );
    const declined = details.filter(
      (detail) => detail.inviteStatus?.toLowerCase() === "declined",
    );
    const unknown = details.filter(
      (detail) => !detail.inviteStatus || detail.inviteStatus.toLowerCase() === "unknown",
    );
    return {
      requested,
      status: accepted.length === requested.length ? "confirmed" : "partial",
      details,
      checkedAt,
      warning: declined.length
        ? `Instagram meldt dat @${declined.map((detail) => detail.username).join(", @")} de collaborator-uitnodiging heeft geweigerd.`
        : unknown.length
          ? `Instagram gaf nog geen controleerbare collaborator-status voor @${unknown.map((detail) => detail.username).join(", @")}.`
          : undefined,
    };
  } catch {
    return {
      requested,
      status: "unverified",
      details: requested.map((username) => ({ username, inviteStatus: "Unknown" })),
      checkedAt,
      warning: "De post is geplaatst, maar de collaborator-uitnodigingen konden niet worden gecontroleerd.",
    };
  }
}

export async function listInstagramMedia(env: PublishingEnv) {
  const accountId = requireValue(env.INSTAGRAM_ACCOUNT_ID, "Instagram account-ID");
  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const baseUrl = `https://graph.instagram.com/${version}`;
  const firstPage = new URL(`${baseUrl}/${encodeURIComponent(accountId)}/media`);
  firstPage.searchParams.set(
    "fields",
    "id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,caption",
  );
  firstPage.searchParams.set("limit", "100");
  firstPage.searchParams.set("access_token", accessToken);

  const media: InstagramMediaSummary[] = [];
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
      const record = entry as JsonRecord;
      const id = record.id;
      if (typeof id !== "string" || !id) continue;
      media.push({
        id,
        mediaType: typeof record.media_type === "string" ? record.media_type : undefined,
        mediaProductType:
          typeof record.media_product_type === "string" ? record.media_product_type : undefined,
        mediaUrl: typeof record.media_url === "string" ? record.media_url : undefined,
        thumbnailUrl:
          typeof record.thumbnail_url === "string" ? record.thumbnail_url : undefined,
        permalink: typeof record.permalink === "string" ? record.permalink : undefined,
        timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
        caption: typeof record.caption === "string" ? record.caption : undefined,
      });
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

  return media;
}

export async function listInstagramMediaIds(env: PublishingEnv) {
  return new Set((await listInstagramMedia(env)).map((item) => item.id));
}

function metricValue(payload: JsonRecord, metric: string) {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const entry = data.find((item) => (item as JsonRecord).name === metric) as JsonRecord | undefined;
  if (!entry) return null;

  const totalValue = entry.total_value as JsonRecord | undefined;
  if (typeof totalValue?.value === "number") return totalValue.value;

  const values = Array.isArray(entry.values) ? entry.values : [];
  const firstValue = values[0] as JsonRecord | undefined;
  return typeof firstValue?.value === "number" ? firstValue.value : null;
}

export async function getInstagramMediaInsights(
  mediaId: string,
  env: PublishingEnv,
): Promise<InstagramMediaInsights> {
  const accessToken = requireValue(env.INSTAGRAM_ACCESS_TOKEN, "Instagram access-token");
  const version = env.META_GRAPH_VERSION || "v25.0";
  const baseUrl = `https://graph.instagram.com/${version}`;
  const metadataUrl = new URL(`${baseUrl}/${encodeURIComponent(mediaId)}`);
  metadataUrl.searchParams.set(
    "fields",
    "id,media_product_type,permalink,like_count,comments_count",
  );
  metadataUrl.searchParams.set("access_token", accessToken);

  const metadataResponse = await fetch(metadataUrl, { headers: { Accept: "application/json" } });
  const metadata = await parseJson(metadataResponse);
  const metrics = ["views", "reach", "saved", "shares", "total_interactions"];
  const insightsUrl = new URL(`${baseUrl}/${encodeURIComponent(mediaId)}/insights`);
  insightsUrl.searchParams.set("metric", metrics.join(","));
  insightsUrl.searchParams.set("access_token", accessToken);

  let insights: JsonRecord = {};
  let warning: string | undefined;
  try {
    const insightsResponse = await fetch(insightsUrl, { headers: { Accept: "application/json" } });
    insights = await parseJson(insightsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram Insights is niet beschikbaar.";
    warning = /permission|insufficient|manage_insights|toegang|machtiging/i.test(message)
      ? "De Instagram-token mist waarschijnlijk de Insights-toestemming. Maak een nieuwe token met instagram_business_manage_insights."
      : `Niet alle Insights zijn beschikbaar: ${message}`;
  }

  return {
    mediaId,
    permalink: typeof metadata.permalink === "string" ? metadata.permalink : undefined,
    mediaProductType:
      typeof metadata.media_product_type === "string" ? metadata.media_product_type : undefined,
    likes: typeof metadata.like_count === "number" ? metadata.like_count : 0,
    comments: typeof metadata.comments_count === "number" ? metadata.comments_count : 0,
    views: metricValue(insights, "views"),
    reach: metricValue(insights, "reach"),
    saved: metricValue(insights, "saved"),
    shares: metricValue(insights, "shares"),
    totalInteractions: metricValue(insights, "total_interactions"),
    warning,
  };
}

export type { InstagramMediaInsights, InstagramMediaSummary, PublishingEnv };
