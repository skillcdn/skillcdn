CREATE TABLE "operator_media" (
	"sha" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"address" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"published" date,
	"texts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_media" (
	"entry_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_media_entry_id_slot_pk" PRIMARY KEY("entry_id","slot"),
	CONSTRAINT "showcase_media_slot_check" CHECK ("showcase_media"."slot" in ('clip', 'animation', 'poster', 'reference', 'picture', 'social'))
);
--> statement-breakpoint
ALTER TABLE "showcase_media" ADD CONSTRAINT "showcase_media_entry_id_showcase_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."showcase_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_media" ADD CONSTRAINT "showcase_media_sha_operator_media_sha_fk" FOREIGN KEY ("sha") REFERENCES "public"."operator_media"("sha") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "showcase_entries_slug_key" ON "showcase_entries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "showcase_entries_position_idx" ON "showcase_entries" USING btree ("position","slug");--> statement-breakpoint
CREATE INDEX "showcase_media_sha_idx" ON "showcase_media" USING btree ("sha");