ALTER TABLE `published_media` ADD `instagram_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `published_media` ADD `instagram_checked_at` integer;--> statement-breakpoint
ALTER TABLE `published_media` ADD `instagram_removed_at` integer;