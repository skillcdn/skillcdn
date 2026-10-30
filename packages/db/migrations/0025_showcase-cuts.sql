ALTER TABLE "showcase_media" DROP CONSTRAINT "showcase_media_entry_id_slot_pk";--> statement-breakpoint
ALTER TABLE "showcase_media" ADD COLUMN "language" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "showcase_media" ADD CONSTRAINT "showcase_media_entry_id_language_slot_pk" PRIMARY KEY("entry_id","language","slot");--> statement-breakpoint
ALTER TABLE "showcase_entries" ADD COLUMN "cuts" jsonb DEFAULT '{}'::jsonb NOT NULL;
