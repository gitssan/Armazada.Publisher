PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_published_media` (
	`publication_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`last_modified` integer NOT NULL,
	`media_type` text NOT NULL,
	`instagram_media_id` text NOT NULL,
	`published_at` integer NOT NULL,
	`instagram_status` text DEFAULT 'active' NOT NULL,
	`instagram_checked_at` integer,
	`instagram_removed_at` integer,
	`collaborators_requested` text DEFAULT '[]' NOT NULL,
	`collaborator_status` text DEFAULT 'unknown' NOT NULL,
	`collaborator_details` text,
	`collaborator_checked_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_published_media`("fingerprint", "file_name", "file_size", "last_modified", "media_type", "instagram_media_id", "published_at", "instagram_status", "instagram_checked_at", "instagram_removed_at", "collaborators_requested", "collaborator_status", "collaborator_details", "collaborator_checked_at") SELECT "fingerprint", "file_name", "file_size", "last_modified", "media_type", "instagram_media_id", "published_at", "instagram_status", "instagram_checked_at", "instagram_removed_at", "collaborators_requested", "collaborator_status", "collaborator_details", "collaborator_checked_at" FROM `published_media`;--> statement-breakpoint
DROP TABLE `published_media`;--> statement-breakpoint
ALTER TABLE `__new_published_media` RENAME TO `published_media`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `published_media_fingerprint_idx` ON `published_media` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `published_media_instagram_media_id_unique` ON `published_media` (`instagram_media_id`);
