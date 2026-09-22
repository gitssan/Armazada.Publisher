type GoogleDriveEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
};

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  thumbnailLink?: string;
  parents?: string[];
};

export type GoogleDriveMediaItem = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "video";
  size: number;
  lastModified: number;
  fingerprint: string;
  thumbnailUrl: string;
};

let cachedToken: { email: string; value: string; expiresAt: number } | null = null;

function requireValue(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} ontbreekt in de app-instellingen.`);
  return value;
}

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function privateKeyBytes(value: string) {
  const normalized = value.replace(/\\n/g, "\n");
  const encoded = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createServiceAccountToken(env: GoogleDriveEnv) {
  const email = requireValue(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, "Google service-account e-mail");
  const privateKey = requireValue(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, "Google private key");
  if (cachedToken?.email === email && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "Google Drive kon niet worden geautoriseerd.");
  }
  cachedToken = {
    email,
    value: result.access_token,
    expiresAt: Date.now() + (result.expires_in || 3600) * 1000,
  };
  return result.access_token;
}

async function authorizedFetch(url: string, env: GoogleDriveEnv) {
  const token = await createServiceAccountToken(env);
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function readGoogleError(response: Response) {
  const result = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return result.error?.message || `Google Drive gaf foutcode ${response.status}.`;
}

function configuredFolderId(env: GoogleDriveEnv) {
  return requireValue(env.GOOGLE_DRIVE_FOLDER_ID, "Google Drive-map-ID");
}

function isSupportedMedia(file: GoogleDriveFile) {
  return file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/");
}

async function getGoogleDriveFile(fileId: string, env: GoogleDriveEnv) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,md5Checksum,thumbnailLink,parents");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await authorizedFetch(url.toString(), env);
  if (!response.ok) throw new Error(await readGoogleError(response));
  const file = (await response.json()) as GoogleDriveFile;
  if (!file.parents?.includes(configuredFolderId(env))) {
    throw new Error("Dit bestand staat niet rechtstreeks in de gekoppelde Google Drive-map.");
  }
  if (!isSupportedMedia(file)) {
    throw new Error("Dit Google Drive-bestand is geen ondersteunde foto of video.");
  }
  return file;
}

export function googleDriveConfiguration(env: GoogleDriveEnv) {
  return {
    ready: Boolean(
      env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
        env.GOOGLE_DRIVE_FOLDER_ID,
    ),
  };
}

export async function listGoogleDriveMedia(env: GoogleDriveEnv): Promise<GoogleDriveMediaItem[]> {
  const folderId = configuredFolderId(env);
  const files: GoogleDriveFile[] = [];
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,thumbnailLink)");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await authorizedFetch(url.toString(), env);
    if (!response.ok) throw new Error(await readGoogleError(response));
    const result = (await response.json()) as {
      files?: GoogleDriveFile[];
      nextPageToken?: string;
    };
    files.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);

  return files.filter(isSupportedMedia).map((file) => {
    const size = Number(file.size || 0);
    const checksum = file.md5Checksum || `${file.id}:${file.modifiedTime || ""}:${size}`;
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.mimeType.startsWith("video/") ? "video" : "image",
      size,
      lastModified: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
      fingerprint: `drive:${checksum}`,
      thumbnailUrl: `/api/drive/thumbnail?id=${encodeURIComponent(file.id)}`,
    };
  });
}

export async function downloadGoogleDriveMedia(fileId: string, env: GoogleDriveEnv) {
  const file = await getGoogleDriveFile(fileId, env);
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await authorizedFetch(url.toString(), env);
  if (!response.ok) throw new Error(await readGoogleError(response));
  const bytes = await response.arrayBuffer();
  return new File([bytes], file.name, {
    type: file.mimeType,
    lastModified: file.modifiedTime ? Date.parse(file.modifiedTime) : Date.now(),
  });
}

export async function fetchGoogleDriveThumbnail(fileId: string, env: GoogleDriveEnv) {
  const file = await getGoogleDriveFile(fileId, env);
  if (file.thumbnailLink) {
    const thumbnailUrl = file.thumbnailLink.replace(/=s\d+$/, "=s800");
    const response = await authorizedFetch(thumbnailUrl, env);
    if (response.ok) return response;
  }

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await authorizedFetch(url.toString(), env);
  if (!response.ok) throw new Error(await readGoogleError(response));
  return response;
}

export type { GoogleDriveEnv };
