CREATE TABLE `media_preferences` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`forgotten` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
