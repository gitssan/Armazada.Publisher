"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Unlink,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type CollaboratorDetail = { username: string; inviteStatus?: string };

type Publication = {
  publicationId: number;
  fingerprint: string;
  fileName: string;
  mediaType: "image" | "video";
  instagramMediaId: string;
  publishedAt: number;
  instagramStatus: "active" | "removed";
  instagramCheckedAt: number | null;
  instagramRemovedAt: number | null;
  collaboratorsRequested: string[];
  collaboratorStatus: string;
  collaboratorDetails: CollaboratorDetail[];
  collaboratorCheckedAt: number | null;
};

type InstagramMedia = {
  id: string;
  mediaType?: string;
  mediaProductType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
};

type SyncResult = {
  checkedAt?: number;
  active?: string[];
  removed?: string[];
  publications?: Publication[];
  instagramMedia?: InstagramMedia[];
  otherInstagramMedia?: InstagramMedia[];
  otherInstagramPosts?: number;
  error?: string;
};

type DriveMedia = {
  fingerprint: string;
  thumbnailUrl: string;
  name: string;
  kind: "image" | "video";
};

type ReportFilter = "attention" | "active" | "removed" | "all";

function formatDate(timestamp: number) {
  if (!timestamp) return "Datum onbekend";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function inviteLabel(status?: string) {
  switch (status?.toLowerCase()) {
    case "accepted":
      return "Geaccepteerd";
    case "pending":
      return "Nog open";
    case "declined":
      return "Geweigerd";
    default:
      return "Nog niet bevestigd";
  }
}

function inviteClasses(status?: string) {
  switch (status?.toLowerCase()) {
    case "accepted":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "pending":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "declined":
      return "bg-red-50 text-red-700 ring-red-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function needsAttention(publication: Publication) {
  if (publication.instagramStatus === "removed") return true;
  return publication.collaboratorDetails.some((detail) => {
    const status = detail.inviteStatus?.toLowerCase();
    return status !== "accepted";
  });
}

export default function InstagramOverviewPage() {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [driveMedia, setDriveMedia] = useState<DriveMedia[]>([]);
  const [filter, setFilter] = useState<ReportFilter>("attention");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadReport() {
    if (loading && result) return;
    setLoading(true);
    setError("");
    try {
      const [syncResponse, driveResponse] = await Promise.all([
        fetch("/api/instagram-sync", { method: "POST", cache: "no-store" }),
        fetch("/api/drive", { cache: "no-store" }),
      ]);
      const sync = (await syncResponse.json().catch(() => ({}))) as SyncResult;
      if (!syncResponse.ok) throw new Error(sync.error || "Instagram-overzicht laden is mislukt.");
      const drive = (await driveResponse.json().catch(() => ({}))) as {
        items?: DriveMedia[];
      };
      setResult(sync);
      setDriveMedia(driveResponse.ok ? drive.items || [] : []);
    } catch (reportError) {
      setError(
        reportError instanceof Error
          ? reportError.message
          : "Instagram-overzicht laden is mislukt.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
    // Alleen bij het openen automatisch synchroniseren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publications = useMemo(
    () => [...(result?.publications || [])].sort((a, b) => b.publishedAt - a.publishedAt),
    [result],
  );
  const driveByFingerprint = useMemo(
    () => new Map(driveMedia.map((item) => [item.fingerprint, item])),
    [driveMedia],
  );
  const instagramById = useMemo(
    () => new Map((result?.instagramMedia || []).map((item) => [item.id, item])),
    [result],
  );
  const activeFingerprints = useMemo(
    () =>
      new Set(
        publications
          .filter((publication) => publication.instagramStatus === "active")
          .map((publication) => publication.fingerprint),
      ),
    [publications],
  );
  const fullyRemovedFingerprints = useMemo(
    () => new Set(result?.removed || []),
    [result],
  );
  const activePublications = publications.filter(
    (publication) => publication.instagramStatus === "active",
  );
  const removedPublications = publications.filter(
    (publication) => publication.instagramStatus === "removed",
  );
  const olderRemovedPublications = removedPublications.filter((publication) =>
    activeFingerprints.has(publication.fingerprint),
  );
  const unresolvedDetails = activePublications.flatMap((publication) =>
    publication.collaboratorDetails.filter((detail) => {
      const status = detail.inviteStatus?.toLowerCase();
      return status !== "accepted" && status !== "declined";
    }),
  );
  const unresolvedByUsername = useMemo(() => {
    const counts = new Map<string, { username: string; count: number }>();
    for (const detail of unresolvedDetails) {
      const key = detail.username.toLowerCase();
      const current = counts.get(key);
      counts.set(key, { username: detail.username, count: (current?.count || 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => a.username.localeCompare(b.username));
  }, [unresolvedDetails]);

  const visiblePublications = publications.filter((publication) => {
    if (filter === "attention") return needsAttention(publication);
    if (filter === "active") return publication.instagramStatus === "active";
    if (filter === "removed") return publication.instagramStatus === "removed";
    return true;
  });

  const summaryCards = [
    {
      label: "Aanwezige publicaties",
      value: activePublications.length,
      detail: "Door de app gevolgd",
      icon: CheckCircle2,
      tone: "emerald",
      filter: "active" as ReportFilter,
    },
    {
      label: "Volledig verwijderde bestanden",
      value: fullyRemovedFingerprints.size,
      detail: "Kunnen opnieuw worden geplaatst",
      icon: Unlink,
      tone: "amber",
      filter: "removed" as ReportFilter,
    },
    {
      label: "Oudere verwijderde plaatsingen",
      value: olderRemovedPublications.length,
      detail: "Naast een nieuwere actieve plaatsing",
      icon: AlertTriangle,
      tone: "slate",
      filter: "removed" as ReportFilter,
    },
    {
      label: "Collabs nog niet geaccepteerd",
      value: unresolvedDetails.length,
      detail: unresolvedByUsername.length
        ? unresolvedByUsername.map((item) => `@${item.username} ${item.count}`).join(" · ")
        : "Geen openstaande uitnodigingen",
      icon: Users,
      tone: "blue",
      filter: "attention" as ReportFilter,
    },
    {
      label: "Overige Instagram-posts",
      value: result?.otherInstagramPosts || 0,
      detail: "Niet door deze app geplaatst",
      icon: BarChart3,
      tone: "violet",
      filter: "all" as ReportFilter,
    },
  ];

  return (
    <main className="min-h-screen bg-[#f4f8f7] text-[#123943]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#061c25]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full border border-[#93d5d4]/40 bg-[#0b3340] text-[#a9e3df]">
              <span className="font-serif text-lg italic">A</span>
            </div>
            <div>
              <p className="font-serif text-[1.15rem] leading-none tracking-wide">Armazada</p>
              <p className="mt-1 text-[0.68rem] uppercase tracking-[0.26em] text-[#8cb4ba]">Instagram-overzicht</p>
            </div>
          </div>
          <a
            href="/"
            className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
          >
            <ArrowLeft className="size-4" /> Terug naar Publisher
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#39717d]">Instagram-controle</p>
            <h1 className="mt-2 font-serif text-4xl tracking-tight text-[#092c36]">Publicaties in beeld</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#58717a]">
              Bekijk precies welke media aanwezig of verwijderd zijn en bij welke publicaties collaborators nog actie moeten ondernemen.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {result?.checkedAt ? (
              <span className="text-xs text-[#71878c]">Gecontroleerd {formatDate(result.checkedAt)}</span>
            ) : null}
            <Button
              className="rounded-full bg-[#0b5362] text-white hover:bg-[#073f4b]"
              disabled={loading}
              onClick={() => void loadReport()}
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Vernieuw overzicht
            </Button>
          </div>
        </div>

        {error ? (
          <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loading && !result ? (
          <div className="mt-8 grid min-h-[55vh] place-items-center rounded-[28px] border border-[#d7e3e3] bg-white">
            <span className="flex items-center gap-3 text-sm font-medium text-[#52747b]">
              <LoaderCircle className="size-5 animate-spin" /> Instagram en Google Drive worden vergeleken…
            </span>
          </div>
        ) : result ? (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {summaryCards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => setFilter(card.filter)}
                    className="rounded-[24px] border border-[#d7e3e3] bg-white p-5 text-left shadow-[0_16px_45px_rgba(16,64,74,0.06)] transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <span className="grid size-10 place-items-center rounded-full bg-[#e8f3f1] text-[#26636b]">
                      <Icon className="size-5" />
                    </span>
                    <p className="mt-5 text-3xl font-semibold text-[#123943]">{card.value}</p>
                    <p className="mt-1 text-sm font-semibold text-[#365d64]">{card.label}</p>
                    <p className="mt-2 text-xs leading-5 text-[#71878c]">{card.detail}</p>
                  </button>
                );
              })}
            </section>

            <section className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-serif text-2xl text-[#123943]">Gevolgde publicaties</h2>
                  <p className="mt-1 text-sm text-[#71878c]">Iedere plaatsing staat afzonderlijk in het overzicht.</p>
                </div>
                <div className="flex flex-wrap rounded-2xl border border-[#c9dddd] bg-[#edf5f4] p-1">
                  {([
                    ["attention", "Aandacht nodig"],
                    ["active", "Aanwezig"],
                    ["removed", "Verwijderd"],
                    ["all", "Alles"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                        filter === value ? "bg-white text-[#0b5362] shadow-sm" : "text-[#638087]"
                      }`}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {visiblePublications.length ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visiblePublications.map((publication) => {
                    const driveItem = driveByFingerprint.get(publication.fingerprint);
                    const instagramItem = instagramById.get(publication.instagramMediaId);
                    const imageUrl =
                      driveItem?.thumbnailUrl || instagramItem?.thumbnailUrl || instagramItem?.mediaUrl;
                    const fullyRemoved = fullyRemovedFingerprints.has(publication.fingerprint);
                    const unresolved = publication.collaboratorDetails.filter((detail) => {
                      const status = detail.inviteStatus?.toLowerCase();
                      return status !== "accepted" && status !== "declined";
                    }).length;
                    return (
                      <article
                        key={publication.publicationId}
                        className="overflow-hidden rounded-[24px] border border-[#d7e3e3] bg-white shadow-[0_16px_45px_rgba(16,64,74,0.06)]"
                      >
                        <div className="relative aspect-[4/3] bg-[#d9e8e7]">
                          {imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="h-full w-full object-cover" src={imageUrl} alt={publication.fileName} />
                          ) : (
                            <span className="grid h-full place-items-center text-[#52747b]">
                              {publication.mediaType === "video" ? <Film className="size-8" /> : <ImageIcon className="size-8" />}
                            </span>
                          )}
                          <span
                            className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[10px] font-bold shadow-sm ${
                              publication.instagramStatus === "active"
                                ? "bg-emerald-50 text-emerald-800"
                                : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {publication.instagramStatus === "active" ? "Aanwezig" : "Verwijderd"}
                          </span>
                          {publication.mediaType === "video" ? (
                            <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/50 text-white">
                              <Film className="size-4" />
                            </span>
                          ) : null}
                        </div>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#163d46]">{publication.fileName}</p>
                              <p className="mt-1 text-xs text-[#71878c]">{formatDate(publication.publishedAt)}</p>
                            </div>
                            {instagramItem?.permalink ? (
                              <a
                                href={instagramItem.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="grid size-8 shrink-0 place-items-center rounded-full bg-[#edf5f4] text-[#176a72]"
                                aria-label="Bekijk op Instagram"
                              >
                                <ExternalLink className="size-4" />
                              </a>
                            ) : null}
                          </div>

                          {publication.instagramStatus === "removed" ? (
                            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                              {fullyRemoved
                                ? "Alle plaatsingen van dit bestand zijn verwijderd; opnieuw plaatsen is mogelijk."
                                : "Dit is een oudere verwijderde plaatsing; er bestaat ook een actieve plaatsing."}
                            </p>
                          ) : unresolved ? (
                            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                              {unresolved} {unresolved === 1 ? "collaborator heeft" : "collaborators hebben"} nog niet geaccepteerd.
                            </p>
                          ) : null}

                          {publication.collaboratorDetails.length ? (
                            <div className="mt-3 space-y-1.5">
                              {publication.collaboratorDetails.map((detail) => (
                                <div key={detail.username} className="flex items-center justify-between gap-2">
                                  <span className="truncate text-xs font-medium text-[#365d64]">@{detail.username}</span>
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${inviteClasses(detail.inviteStatus)}`}
                                  >
                                    {inviteLabel(detail.inviteStatus)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-[#8a9ca0]">Geen collaborators aangevraagd.</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5 grid min-h-52 place-items-center rounded-[24px] border border-dashed border-[#c9dddd] bg-white text-center">
                  <div>
                    <CheckCircle2 className="mx-auto size-8 text-[#39717d]" />
                    <p className="mt-3 font-serif text-xl">Geen publicaties in deze selectie</p>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-10 border-t border-[#d7e3e3] pt-8">
              <h2 className="font-serif text-2xl text-[#123943]">Overige Instagram-posts</h2>
              <p className="mt-1 text-sm text-[#71878c]">Deze posts staan op @armazada.atlantic, maar zijn niet door de app geregistreerd.</p>
              {(result.otherInstagramMedia || []).length ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {(result.otherInstagramMedia || []).map((item) => (
                    <article key={item.id} className="overflow-hidden rounded-2xl border border-[#d7e3e3] bg-white">
                      <div className="aspect-square bg-[#d9e8e7]">
                        {item.thumbnailUrl || item.mediaUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="h-full w-full object-cover" src={item.thumbnailUrl || item.mediaUrl} alt="Overige Instagram-post" />
                        ) : (
                          <span className="grid h-full place-items-center text-[#52747b]"><ImageIcon /></span>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-xs leading-5 text-[#365d64]">{item.caption || "Instagram-post zonder caption"}</p>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-[#71878c]">
                          <span>{item.timestamp ? formatDate(Date.parse(item.timestamp)) : "Datum onbekend"}</span>
                          {item.permalink ? (
                            <a href={item.permalink} target="_blank" rel="noreferrer" className="font-semibold text-[#176a72]">Open</a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-[#58717a]">Geen overige Instagram-posts gevonden.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
