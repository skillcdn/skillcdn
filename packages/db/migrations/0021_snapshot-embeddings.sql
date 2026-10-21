CREATE TABLE "snapshot_embeddings" (
	"snapshot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"sectioning_version" integer NOT NULL,
	"bodies" integer DEFAULT 0 NOT NULL,
	"sections" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_embeddings_pkey" PRIMARY KEY("snapshot_id","model","dimensions","sectioning_version")
);
--> statement-breakpoint
ALTER TABLE "snapshot_embeddings" ADD CONSTRAINT "snapshot_embeddings_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_embeddings" ADD CONSTRAINT "snapshot_embeddings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshot_embeddings_account_idx" ON "snapshot_embeddings" USING btree ("account_id");