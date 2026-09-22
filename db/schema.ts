import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const publishedMedia = sqliteTable("published_media", {
  fingerprint: text("fingerprint").primaryKey(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  lastModified: integer("last_modified").notNull(),
  mediaType: text("media_type").notNull(),
  instagramMediaId: text("instagram_media_id").notNull(),
  publishedAt: integer("published_at").notNull(),
});
