CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"host" text NOT NULL,
	"host_account_id" text NOT NULL,
	"login" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_kind_check" CHECK ("accounts"."kind" in ('organization', 'user'))
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"sha" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"size" integer NOT NULL,
	"blob_sha" text NOT NULL,
	"skill_dir" text,
	"name" text,
	"title" text,
	"description" text,
	"front_matter" jsonb,
	"search" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_entries_kind_check" CHECK ("index_entries"."kind" in ('skill', 'markdown', 'json', 'other'))
);
--> statement-breakpoint
CREATE TABLE "repo_aliases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"host" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_refs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"commit_sha" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"host" text NOT NULL,
	"host_repo_id" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text NOT NULL,
	"visibility" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_visibility_check" CHECK ("repos"."visibility" in ('public', 'private'))
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"error_code" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"indexed_file_count" integer DEFAULT 0 NOT NULL,
	"indexed_bytes" bigint DEFAULT 0 NOT NULL,
	"diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_status_check" CHECK ("snapshots"."status" in ('pending', 'indexing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "index_entries" ADD CONSTRAINT "index_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_entries" ADD CONSTRAINT "index_entries_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_aliases" ADD CONSTRAINT "repo_aliases_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_refs" ADD CONSTRAINT "repo_refs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_refs" ADD CONSTRAINT "repo_refs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_host_account_key" ON "accounts" USING btree ("host","host_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_entries_snapshot_path_key" ON "index_entries" USING btree ("snapshot_id","path");--> statement-breakpoint
CREATE INDEX "index_entries_snapshot_kind_idx" ON "index_entries" USING btree ("snapshot_id","kind");--> statement-breakpoint
CREATE INDEX "index_entries_snapshot_skill_dir_idx" ON "index_entries" USING btree ("snapshot_id","skill_dir");--> statement-breakpoint
CREATE INDEX "index_entries_search_idx" ON "index_entries" USING gin ("search");--> statement-breakpoint
CREATE INDEX "index_entries_account_idx" ON "index_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_aliases_name_key" ON "repo_aliases" USING btree ("host","owner","name");--> statement-breakpoint
CREATE INDEX "repo_aliases_repo_idx" ON "repo_aliases" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_refs_repo_ref_key" ON "repo_refs" USING btree ("repo_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_host_repo_key" ON "repos" USING btree ("host","host_repo_id");--> statement-breakpoint
CREATE INDEX "repos_account_idx" ON "repos" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_repo_commit_key" ON "snapshots" USING btree ("repo_id","commit_sha");--> statement-breakpoint
CREATE INDEX "snapshots_account_idx" ON "snapshots" USING btree ("account_id");