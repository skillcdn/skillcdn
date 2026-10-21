CREATE TABLE "embedding_usage_daily" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"sections" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_usage_daily_pkey" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
ALTER TABLE "snapshot_embeddings" ADD COLUMN "bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "embedding_usage_daily" ADD CONSTRAINT "embedding_usage_daily_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;