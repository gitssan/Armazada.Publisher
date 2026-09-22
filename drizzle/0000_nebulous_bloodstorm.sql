CREATE TABLE `published_media` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`last_modified` integer NOT NULL,
	`media_type` text NOT NULL,
	`instagram_media_id` text NOT NULL,
	`published_at` integer NOT NULL
);
