ALTER TABLE `published_media` ADD `collaborators_requested` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `published_media` ADD `collaborator_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `published_media` ADD `collaborator_details` text;--> statement-breakpoint
ALTER TABLE `published_media` ADD `collaborator_checked_at` integer;