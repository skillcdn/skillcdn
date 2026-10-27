CREATE TABLE "showcase_organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"logo_sha" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "showcase_entries" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "showcase_entries" ADD COLUMN "origin" text DEFAULT 'pack' NOT NULL;--> statement-breakpoint
ALTER TABLE "showcase_organizations" ADD CONSTRAINT "showcase_organizations_logo_sha_operator_media_sha_fk" FOREIGN KEY ("logo_sha") REFERENCES "public"."operator_media"("sha") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "showcase_organizations_slug_key" ON "showcase_organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "showcase_organizations_position_idx" ON "showcase_organizations" USING btree ("position","slug");--> statement-breakpoint
CREATE INDEX "showcase_organizations_logo_idx" ON "showcase_organizations" USING btree ("logo_sha");--> statement-breakpoint
ALTER TABLE "showcase_entries" ADD CONSTRAINT "showcase_entries_origin_check" CHECK ("showcase_entries"."origin" in ('pack', 'builder'));