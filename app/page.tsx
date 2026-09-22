"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Camera,
  ChevronDown,
  Cloud,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_CAPTION = `Casa Armazada · Our home overlooking the Atlantic · Algarve, Portugal

A vision held for five years and brought to life through purposeful action, trust and inner alignment — a home and a way of life rooted in freedom and nature.`;
const DEFAULT_COLLABORATOR = "m1ndcycle";

type LibraryItem = {
  id: string;
  source: "drive" | "local";
  file?: File;
  driveFileId?: string;
  name: string;
  fingerprint: string;
  url: string;
  kind: "image" | "video";
  size: number;
  lastModified: number;
  selected: boolean;
  status: "idle" | "publishing" | "published" | "error";
};

type DriveMediaItem = {
  id: string;
  name: string;
  fingerprint: string;
  thumbnailUrl: string;
  kind: "image" | "video";
  size: number;
  lastModified: number;
};

type Configuration = {
  instagram: boolean;
  temporaryMedia: boolean;
  googleDrive: boolean;
  ready: boolean;
};

type PublishResult = {
  error?: string;
};

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function makeItem(file: File): Promise<LibraryItem | null> {
  const kind = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : null;
  if (!kind) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id: fingerprint,
    source: "local",
    fingerprint,
    file,
    name: file.name,
    url: URL.createObjectURL(file),
    kind,
    size: file.size,
    lastModified: file.lastModified,
    selected: true,
    status: "idle",
  };
}

async function publishDriveItem(form: FormData) {
  const response = await fetch("/api/publish", { method: "POST", body: form });
  const result = (await response.json().catch(() => ({}))) as PublishResult;
  if (!response.ok) throw new Error(result.error || "Publiceren is mislukt.");
  return result;
}

function uploadForPublishing(
  form: FormData,
  onUploadProgress: (percent: number) => void,
  onProcessing: () => void,
) {
  return new Promise<PublishResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/publish");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.upload.addEventListener("load", onProcessing);
    request.addEventListener("load", () => {
      const result = (request.response || {}) as PublishResult;
      if (request.status >= 200 && request.status < 300) {
        resolve(result);
        return;
      }
      reject(new Error(result.error || "Publiceren is mislukt."));
    });
    request.addEventListener("error", () => reject(new Error("De uploadverbinding is verbroken.")));
    request.send(form);
  });
}

export default function Home() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [inviteCollaborator, setInviteCollaborator] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState("");
  const [configuration, setConfiguration] = useState<Configuration>({
    instagram: false,
    temporaryMedia: false,
    googleDrive: false,
    ready: false,
  });
  const [notice, setNotice] = useState("");
  const [libraryNotice, setLibraryNotice] = useState("");
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedCaption = window.localStorage.getItem("armazada-caption");
    if (storedCaption) setCaption(storedCaption);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("armazada-caption", caption);
  }, [caption]);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then(async (response) => (await response.json()) as Configuration)
      .then((status) => {
        setConfiguration(status);
        if (status.googleDrive) void loadDriveMedia();
      })
      .catch(() =>
        setConfiguration({ instagram: false, temporaryMedia: false, googleDrive: false, ready: false }),
      );
  }, []);

  const selected = useMemo(() => items.filter((item) => item.selected), [items]);
  const allSelected = items.length > 0 && selected.length === items.length;

  async function markPublished(candidates: LibraryItem[]) {
    if (!candidates.length) return;
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprints: candidates.map((item) => item.fingerprint) }),
      });
      if (!response.ok) return;
      const result = (await response.json()) as { published?: string[] };
      const published = new Set(result.published || []);
      if (!published.size) return;
      setItems((current) =>
        current.map((item) =>
          published.has(item.fingerprint)
            ? { ...item, status: "published", selected: false }
            : item,
        ),
      );
    } catch {
      // De mediabibliotheek blijft bruikbaar wanneer de historie tijdelijk niet beschikbaar is.
    }
  }

  async function loadDriveMedia() {
    if (isLoadingDrive) return;
    setIsLoadingDrive(true);
    setLibraryNotice("");
    try {
      const response = await fetch("/api/drive", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        items?: DriveMediaItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Google Drive kon niet worden ingelezen.");

      const currentByFingerprint = new Map(items.map((item) => [item.fingerprint, item]));
      const driveItems: LibraryItem[] = (result.items || []).map((item) => {
        const current = currentByFingerprint.get(item.fingerprint);
        return {
          id: `drive:${item.id}`,
          source: "drive",
          driveFileId: item.id,
          name: item.name,
          fingerprint: item.fingerprint,
          url: item.thumbnailUrl,
          kind: item.kind,
          size: item.size,
          lastModified: item.lastModified,
          selected: current?.selected ?? current?.status !== "published",
          status: current?.status ?? "idle",
        };
      });
      setItems((current) => [
        ...driveItems,
        ...current.filter((item) => item.source === "local"),
      ]);
      await markPublished(driveItems);
      setLibraryNotice(
        `${driveItems.length} ${driveItems.length === 1 ? "bestand" : "bestanden"} uit Google Drive geladen.`,
      );
    } catch (error) {
      setLibraryNotice(error instanceof Error ? error.message : "Google Drive kon niet worden ingelezen.");
    } finally {
      setIsLoadingDrive(false);
    }
  }

  async function addFiles(files: File[]) {
    const accepted: LibraryItem[] = [];
    for (const file of files) {
      const item = await makeItem(file);
      if (item) accepted.push(item);
    }
    setItems((current) => {
      const known = new Set(current.map((item) => item.id));
      const additions = accepted.filter((item) => {
        if (known.has(item.id)) {
          URL.revokeObjectURL(item.url);
          return false;
        }
        known.add(item.id);
        return true;
      });
      return [...current, ...additions];
    });

    await markPublished(accepted);
  }

  function removeItem(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.source === "local") URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function publishSelected() {
    if (!selected.length || isPublishing || !configuration.ready) return;
    setIsPublishing(true);
    setProgress(0);
    setProgressDetail(`1 van ${selected.length} · upload voorbereiden…`);
    setNotice("");
    let publishedCount = 0;

    for (const [index, item] of selected.entries()) {
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, status: "publishing" } : currentItem,
        ),
      );
      const form = new FormData();
      form.set("caption", caption);
      form.set("fingerprint", item.fingerprint);
      if (inviteCollaborator) form.set("collaborator", DEFAULT_COLLABORATOR);

      try {
        if (item.source === "drive" && item.driveFileId) {
          form.set("driveFileId", item.driveFileId);
          setProgressDetail(
            `${index + 1} van ${selected.length} · ${item.name} · ophalen uit Google Drive…`,
          );
          setProgress(Math.round(((index + 0.1) / selected.length) * 100));
          await publishDriveItem(form);
        } else if (item.file) {
          form.set("media", item.file, item.name);
          await uploadForPublishing(
            form,
            (uploadPercent) => {
              const overallPercent = Math.round(
                ((index + uploadPercent / 100) / selected.length) * 100,
              );
              setProgress(overallPercent);
              setProgressDetail(
                `${index + 1} van ${selected.length} · ${item.name} · upload ${uploadPercent}%`,
              );
            },
            () => {
              setProgressDetail(
                `${index + 1} van ${selected.length} · ${item.name} · upload 100% · Instagram verwerkt…`,
              );
            },
          );
        } else {
          throw new Error("De bron van dit bestand is niet meer beschikbaar.");
        }
        publishedCount += 1;
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? { ...currentItem, status: "published", selected: false }
              : currentItem,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Publiceren is mislukt.";
        setNotice(`${item.name}: ${message}`);
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, status: "error" } : currentItem,
          ),
        );
      }
      setProgress(Math.round(((index + 1) / selected.length) * 100));
    }

    if (publishedCount === selected.length) {
      setNotice(`${publishedCount} ${publishedCount === 1 ? "post is" : "posts zijn"} gepubliceerd.`);
      setProgressDetail(`Klaar · ${publishedCount} van ${selected.length} gepubliceerd`);
    } else {
      setProgressDetail(`Gereed · ${publishedCount} van ${selected.length} gepubliceerd`);
    }
    setIsPublishing(false);
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    const registrations = [
      context.registerTool(
        {
          name: "set_default_caption",
          title: "Standaardcaption instellen",
          description: "Vervang de caption die op iedere geselecteerde Instagram-post wordt toegepast.",
          inputSchema: {
            type: "object",
            properties: { caption: { type: "string", minLength: 1, maxLength: 2200 } },
            required: ["caption"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const nextCaption = (input as { caption?: unknown })?.caption;
            if (typeof nextCaption !== "string" || !nextCaption.trim() || nextCaption.length > 2200) {
              throw new Error("Caption moet tussen 1 en 2.200 tekens bevatten.");
            }
            setCaption(nextCaption);
            return { updated: true, characters: nextCaption.length };
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "select_all_unpublished_media",
          title: "Alle ongepubliceerde media selecteren",
          description: "Vink alle geladen foto's en video's aan die nog niet gepubliceerd zijn.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute() {
            const count = items.filter((item) => item.status !== "published").length;
            setItems((current) =>
              current.map((item) => ({ ...item, selected: item.status !== "published" })),
            );
            return { selected: count };
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "publish_selected_media",
          title: "Geselecteerde media publiceren",
          description:
            "Publiceer ieder geselecteerd bestand als een losse Instagram-post met de ingestelde caption. Dit heeft een extern effect.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute() {
            if (!configuration.ready) throw new Error("De Instagram-koppelingen zijn nog niet ingesteld.");
            if (!selected.length) throw new Error("Er zijn geen media geselecteerd.");
            await publishSelected();
            return { attempted: selected.length };
          },
        },
        { signal: lifecycle.signal },
      ),
    ];

    registrations.forEach((registration) => Promise.resolve(registration).catch(() => undefined));
    return () => lifecycle.abort();
  }, [caption, configuration.ready, items, selected.length]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <input
        ref={folderInput}
        className="hidden"
        type="file"
        multiple
        accept="image/*,video/*"
        // @ts-expect-error Chromium directory picker attribute
        webkitdirectory=""
        onChange={(event) => void addFiles(Array.from(event.target.files || []))}
      />
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={(event) => void addFiles(Array.from(event.target.files || []))}
      />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#061c25]/92 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full border border-[#93d5d4]/40 bg-[#0b3340] text-[#a9e3df]">
              <span className="font-serif text-lg italic">A</span>
            </div>
            <div>
              <p className="font-serif text-[1.15rem] leading-none tracking-wide">Armazada</p>
              <p className="mt-1 text-[0.68rem] uppercase tracking-[0.26em] text-[#8cb4ba]">Publisher</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-amber-200/15 bg-amber-100/10 px-3 py-1.5 text-xs text-amber-100 sm:flex">
              <span className="size-1.5 rounded-full bg-amber-300" />
              {configuration.ready ? "Klaar om te publiceren" : "Instagram nog koppelen"}
            </span>
            <Button className="rounded-full bg-[#d6efeb] text-[#08232c] hover:bg-white" size="sm">
              <Camera className="size-4" />
              <span className="hidden sm:inline">@armazada.atlantic</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-7 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="min-w-0">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#39717d]">Mediabibliotheek</p>
              <h1 className="font-serif text-3xl tracking-tight text-[#092c36] sm:text-[2.5rem]">
                Selecteer wat je wilt delen
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#58717a]">
                Je Google Drive-map wordt automatisch ingelezen. Iedere foto wordt een eigen post; iedere video een eigen Reel.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-full border-[#b9d2d5] bg-white text-[#123b45]"
                onClick={() => fileInput.current?.click()}
              >
                <UploadCloud /> Losse bestanden
              </Button>
              <Button
                variant="outline"
                className="rounded-full border-[#b9d2d5] bg-white text-[#123b45]"
                onClick={() => folderInput.current?.click()}
              >
                <FolderOpen /> Laptopmap
              </Button>
              {configuration.googleDrive ? (
                <Button
                  className="rounded-full bg-[#0b5362] text-white hover:bg-[#073f4b]"
                  disabled={isLoadingDrive}
                  onClick={() => void loadDriveMedia()}
                >
                  {isLoadingDrive ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Vernieuw Drive
                </Button>
              ) : null}
            </div>
          </div>

          {libraryNotice ? (
            <p className="mb-4 rounded-2xl border border-[#cfe1e0] bg-[#edf6f4] px-4 py-3 text-sm text-[#365d64]" role="status">
              {libraryNotice}
            </p>
          ) : null}

          <div
            className={`relative min-h-[490px] overflow-hidden rounded-[28px] border bg-white shadow-[0_22px_70px_rgba(16,64,74,0.08)] transition ${
              isDragging ? "border-[#2c8b92] ring-4 ring-[#8fd3ce]/20" : "border-[#d7e3e3]"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              void addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            {items.length === 0 ? (
              <div className="grid min-h-[490px] place-items-center p-8 text-center">
                <div className="max-w-md">
                  <div className="relative mx-auto mb-7 h-32 w-40">
                    <div className="absolute left-2 top-5 h-24 w-28 -rotate-6 rounded-2xl border border-[#c4dadb] bg-[#e8f2f1]" />
                    <div className="absolute right-1 top-1 grid h-28 w-32 rotate-3 place-items-center rounded-2xl border border-[#b7d2d2] bg-[#d4e7e5] shadow-lg">
                      <ImageIcon className="size-10 text-[#4f8588]" strokeWidth={1.5} />
                    </div>
                    <div className="absolute bottom-0 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full bg-[#0b5362] text-white shadow-xl">
                      <Cloud className="size-5" />
                    </div>
                  </div>
                  <h2 className="font-serif text-2xl text-[#123943]">
                    {isLoadingDrive
                      ? "Google Drive wordt ingelezen"
                      : configuration.googleDrive
                        ? "Je Google Drive-map is leeg"
                        : "Google Drive nog koppelen"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#647d83]">
                    {configuration.googleDrive
                      ? "Plaats foto’s en video’s in de gekoppelde Drive-map en vernieuw daarna de bibliotheek."
                      : "Tot de koppeling klaar is, kun je hier bestanden slepen of optioneel een map op je laptop kiezen."}
                  </p>
                  {configuration.googleDrive ? (
                    <Button
                      className="mt-6 rounded-full bg-[#0b5362] px-6 text-white hover:bg-[#073f4b]"
                      disabled={isLoadingDrive}
                      onClick={() => void loadDriveMedia()}
                    >
                      {isLoadingDrive ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                      Vernieuw Google Drive
                    </Button>
                  ) : (
                    <Button
                      className="mt-6 rounded-full bg-[#0b5362] px-6 text-white hover:bg-[#073f4b]"
                      onClick={() => folderInput.current?.click()}
                    >
                      <FolderOpen /> Kies optioneel een laptopmap
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0eaea] px-5 py-4">
                  <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-[#163d46]">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setItems((current) => current.map((item) => ({ ...item, selected: checked === true })))
                      }
                    />
                    {selected.length} van {items.length} geselecteerd
                  </label>
                  <div className="flex items-center gap-1 text-xs text-[#648087]">
                    <SlidersHorizontal className="size-3.5" />
                    Eén bestand = één post
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {items.map((item, index) => (
                    <article
                      key={item.id}
                      className={`group relative aspect-[4/5] overflow-hidden rounded-2xl border-2 bg-[#d9e8e7] transition ${
                        item.selected ? "border-[#2d7e83]" : "border-transparent opacity-65"
                      }`}
                    >
                      {item.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="h-full w-full object-cover" src={item.url} alt={item.name} />
                      ) : item.source === "drive" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="h-full w-full object-cover" src={item.url} alt={item.name} />
                      ) : (
                        <video className="h-full w-full object-cover" src={item.url} muted preload="metadata" />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pb-3 pt-10 text-white">
                        <p className="truncate text-xs font-medium">{item.name}</p>
                        <p className="mt-1 text-[11px] text-white/70">
                          {String(index + 1).padStart(2, "0")} · {formatSize(item.size)} · {item.source === "drive" ? "Drive" : "Lokaal"}
                        </p>
                      </div>
                      <button
                        className="absolute left-3 top-3 grid size-8 place-items-center rounded-full border border-white/60 bg-white/90 shadow-sm"
                        aria-label={`${item.selected ? "Deselecteer" : "Selecteer"} ${item.name}`}
                        onClick={() =>
                          setItems((current) =>
                            current.map((currentItem) =>
                              currentItem.id === item.id
                                ? { ...currentItem, selected: !currentItem.selected }
                                : currentItem,
                            ),
                          )
                        }
                      >
                        {item.selected ? <Check className="size-4 text-[#0b5362]" strokeWidth={3} /> : null}
                      </button>
                      {item.kind === "video" ? (
                        <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur">
                          <Play className="ml-0.5 size-3.5 fill-current" />
                        </span>
                      ) : null}
                      {item.status === "idle" ? (
                        <span className={`absolute right-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-[#245760] shadow-sm ${item.kind === "video" ? "top-12" : "top-3"}`}>
                          Nog te plaatsen
                        </span>
                      ) : null}
                      {item.status === "error" ? (
                        <span className={`absolute right-3 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700 shadow-sm ${item.kind === "video" ? "top-12" : "top-3"}`}>
                          Mislukt
                        </span>
                      ) : null}
                      {item.status === "publishing" ? (
                        <span className="absolute inset-0 grid place-items-center bg-[#062b34]/55 text-white backdrop-blur-[2px]">
                          <LoaderCircle className="size-7 animate-spin" />
                        </span>
                      ) : null}
                      {item.status === "published" ? (
                        <span className="absolute inset-0 grid place-items-center bg-[#0a5b52]/55 text-white backdrop-blur-[2px]">
                          <span className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#0a5b52]">
                            <Check className="size-4" strokeWidth={3} />
                            Geplaatst
                          </span>
                        </span>
                      ) : null}
                      <button
                        className="absolute right-2 bottom-2 hidden size-8 place-items-center rounded-full bg-white/90 text-[#123943] shadow-sm group-hover:grid"
                        aria-label={`Verwijder ${item.name}`}
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-[100px] lg:h-fit">
          <div className="overflow-hidden rounded-[28px] border border-[#d7e3e3] bg-white shadow-[0_22px_70px_rgba(16,64,74,0.08)]">
            <div className="border-b border-[#e0eaea] px-5 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#39717d]">Publicatie</p>
                  <h2 className="mt-1 font-serif text-2xl text-[#123943]">Vaste instellingen</h2>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full text-[#527279]" aria-label="Meer instellingen">
                  <MoreHorizontal />
                </Button>
              </div>
            </div>

            <div className="space-y-6 p-5">
              <div>
                <label htmlFor="caption" className="mb-2 block text-sm font-semibold text-[#163d46]">
                  Standaardcaption
                </label>
                <Textarea
                  id="caption"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  className="min-h-52 resize-none rounded-2xl border-[#cfe0e0] bg-[#f8fbfa] p-4 text-sm leading-6 text-[#2f5057] focus-visible:ring-[#71aaa9]/40"
                />
                <div className="mt-2 flex justify-between text-xs text-[#6e858a]">
                  <span>Automatisch op iedere post</span>
                  <span>{caption.length} / 2.200</span>
                </div>
              </div>

              <div className="rounded-2xl border border-[#d6e5e4] bg-[#f5faf9] p-4">
                <button className="flex w-full items-center justify-between text-left" type="button">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-[#dceceb] text-[#26636b]">
                      <Send className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#153d46]">Direct publiceren</span>
                      <span className="mt-0.5 block text-xs text-[#6a8389]">Als losse posts, in deze volgorde</span>
                    </span>
                  </span>
                  <ChevronDown className="size-4 text-[#6d878c]" />
                </button>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#d6e5e4] bg-white p-4">
                <Checkbox
                  checked={inviteCollaborator}
                  disabled={isPublishing}
                  onCheckedChange={(checked) => setInviteCollaborator(checked === true)}
                  className="mt-0.5 border-[#75a2a2] data-[state=checked]:border-[#176a72] data-[state=checked]:bg-[#176a72]"
                  aria-label="Nodig m1ndcycle uit als collaborator"
                />
                <span>
                  <span className="block text-sm font-semibold text-[#153d46]">
                    @m1ndcycle als collaborator
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#6a8389]">
                    Na acceptatie verschijnt dezelfde post ook op je eigen profiel.
                  </span>
                </span>
              </label>

              {!configuration.ready || !configuration.googleDrive ? (
                <div className="space-y-2 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-amber-900">Eenmalig koppelen</p>
                  <div className="flex items-center justify-between text-sm text-amber-950/80">
                    <span>Instagram Professional</span>
                    <span>{configuration.instagram ? "Gereed" : "Nog nodig"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-amber-950/80">
                    <span>Tijdelijke media-opslag</span>
                    <span>{configuration.temporaryMedia ? "Gereed" : "Nog nodig"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-amber-950/80">
                    <span>Google Drive-map</span>
                    <span>{configuration.googleDrive ? "Gereed" : "Nog nodig"}</span>
                  </div>
                </div>
              ) : null}

              {isPublishing || progress > 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-[#57757b]">
                    <span>{isPublishing ? "Bezig met publiceren" : "Publicatie afgerond"}</span>
                    <span>{progress}% totaal</span>
                  </div>
                  <Progress value={progress} className="bg-[#dceceb] [&>div]:bg-[#1a7279]" />
                  <p className="break-words text-xs leading-5 text-[#6a8389]">{progressDetail}</p>
                </div>
              ) : null}

              {notice ? (
                <p
                  className={`rounded-xl px-3 py-2.5 text-xs leading-5 ${
                    notice.includes("gepubliceerd")
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-900"
                  }`}
                  role="status"
                >
                  {notice}
                </p>
              ) : null}

              <Button
                size="lg"
                className="h-12 w-full rounded-full bg-[#0a4d5a] text-white shadow-lg shadow-[#0a4d5a]/15 hover:bg-[#073e48]"
                disabled={!selected.length || isPublishing || !configuration.ready}
                onClick={publishSelected}
              >
                {isPublishing ? <LoaderCircle className="animate-spin" /> : <Camera />}
                {configuration.ready
                  ? `Publiceer ${selected.length || "geen"} ${selected.length === 1 ? "item" : "items"}`
                  : "Koppelingen nog instellen"}
              </Button>

              <p className="text-center text-xs leading-5 text-[#7b9094]">
                Je bestanden worden pas tijdelijk openbaar gemaakt wanneer Instagram ze ophaalt.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[#cfe1e0] bg-[#eaf4f2] p-4 text-sm text-[#365d64]">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-white text-[#2a777c]">
              {items.some((item) => item.kind === "video") ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
            </span>
            <p className="leading-5">
              Google Drive is de standaardbron. Een laptopmap blijft optioneel; de app wijzigt of verwijdert nooit bronbestanden.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
