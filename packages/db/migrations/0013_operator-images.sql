CREATE TABLE "operator_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"address" text NOT NULL,
	"media_sha" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_images_source_check" CHECK (("operator_images"."media_sha" is null) <> ("operator_images"."url" is null))
);
--> statement-breakpoint
ALTER TABLE "operator_images" ADD CONSTRAINT "operator_images_media_sha_operator_media_sha_fk" FOREIGN KEY ("media_sha") REFERENCES "public"."operator_media"("sha") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_images_address_key" ON "operator_images" USING btree ("address");--> statement-breakpoint
CREATE INDEX "operator_images_media_idx" ON "operator_images" USING btree ("media_sha");