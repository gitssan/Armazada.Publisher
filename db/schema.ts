import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const publishedMedia = sqliteTable(
  "published_media",
  {
    publicationId: integer("publication_id").primaryKey({ autoIncrement: true }),
    fingerprint: text("fingerprint").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    lastModified: integer("last_modified").notNull(),
    mediaType: text("media_type").notNull(),
    instagramMediaId: text("instagram_media_id").notNull(),
    publishedAt: integer("published_at").notNull(),
    instagramStatus: text("instagram_status").notNull().default("active"),
    instagramCheckedAt: integer("instagram_checked_at"),
    instagramRemovedAt: integer("instagram_removed_at"),
    collaboratorsRequested: text("collaborators_requested").notNull().default("[]"),
    collaboratorStatus: text("collaborator_status").notNull().default("unknown"),
    collaboratorDetails: text("collaborator_details"),
    collaboratorCheckedAt: integer("collaborator_checked_at"),
  },
  (table) => [
    index("published_media_fingerprint_idx").on(table.fingerprint),
    uniqueIndex("published_media_instagram_media_id_unique").on(table.instagramMediaId),
  ],
);

export const mediaPreferences = sqliteTable("media_preferences", {
  fingerprint: text("fingerprint").primaryKey(),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  forgotten: integer("forgotten", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});
