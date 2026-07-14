CREATE TABLE `generation_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('processing','ready','failed') NOT NULL DEFAULT 'processing',
	`tourStyle` enum('Walkthrough','Drone','Cinematic') NOT NULL,
	`resolution` varchar(16) NOT NULL,
	`aspectRatio` varchar(8) NOT NULL,
	`clipDuration` int NOT NULL,
	`imageSequence` text,
	`optimizedPrompt` text,
	`openrouterJobId` varchar(128),
	`videoKey` varchar(512),
	`videoUrl` varchar(768),
	`thumbnailUrl` varchar(768),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `generation_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`sequenceIndex` int NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`url` varchar(768) NOT NULL,
	`fileName` varchar(255),
	`mimeType` varchar(64),
	`roomTag` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'My Property Tour',
	`tourStyle` enum('Walkthrough','Drone','Cinematic') NOT NULL DEFAULT 'Walkthrough',
	`creativeText` text,
	`resolution` varchar(16) NOT NULL DEFAULT '720p',
	`aspectRatio` varchar(8) NOT NULL DEFAULT '16:9',
	`clipDuration` int NOT NULL DEFAULT 5,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeCustomerId` varchar(128),
	`stripeSubscriptionId` varchar(128),
	`plan` enum('starter','pro','annual','business'),
	`status` varchar(32) NOT NULL DEFAULT 'inactive',
	`currentPeriodEnd` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_userId_unique` UNIQUE(`userId`)
);
