import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "payload"."enum_site_branding_status" AS ENUM('draft', 'published');
  CREATE TYPE "payload"."enum__site_branding_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "payload"."enum_homepage_hero_status" AS ENUM('draft', 'published');
  CREATE TYPE "payload"."enum__homepage_hero_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "payload"."site_branding" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_name" varchar DEFAULT '8 Ball Registry',
  	"logo_id" integer,
  	"logo_alt" varchar,
  	"_status" "payload"."enum_site_branding_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "payload"."_site_branding_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_site_name" varchar DEFAULT '8 Ball Registry',
  	"version_logo_id" integer,
  	"version_logo_alt" varchar,
  	"version__status" "payload"."enum__site_branding_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "payload"."homepage_hero" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"banner_image_id" integer,
  	"banner_alt" varchar,
  	"welcome_line" varchar,
  	"headline_line1" varchar,
  	"headline_line2" varchar,
  	"description" varchar,
  	"supporting_sentence" varchar,
  	"primary_button_label" varchar,
  	"primary_button_href" varchar,
  	"secondary_button_label" varchar,
  	"secondary_button_href" varchar,
  	"_status" "payload"."enum_homepage_hero_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "payload"."_homepage_hero_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_banner_image_id" integer,
  	"version_banner_alt" varchar,
  	"version_welcome_line" varchar,
  	"version_headline_line1" varchar,
  	"version_headline_line2" varchar,
  	"version_description" varchar,
  	"version_supporting_sentence" varchar,
  	"version_primary_button_label" varchar,
  	"version_primary_button_href" varchar,
  	"version_secondary_button_label" varchar,
  	"version_secondary_button_href" varchar,
  	"version__status" "payload"."enum__homepage_hero_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  ALTER TABLE "payload"."site_branding" ADD CONSTRAINT "site_branding_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload"."_site_branding_v" ADD CONSTRAINT "_site_branding_v_version_logo_id_media_id_fk" FOREIGN KEY ("version_logo_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload"."homepage_hero" ADD CONSTRAINT "homepage_hero_banner_image_id_media_id_fk" FOREIGN KEY ("banner_image_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload"."_homepage_hero_v" ADD CONSTRAINT "_homepage_hero_v_version_banner_image_id_media_id_fk" FOREIGN KEY ("version_banner_image_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "site_branding_logo_idx" ON "payload"."site_branding" USING btree ("logo_id");
  CREATE INDEX "site_branding__status_idx" ON "payload"."site_branding" USING btree ("_status");
  CREATE INDEX "_site_branding_v_version_version_logo_idx" ON "payload"."_site_branding_v" USING btree ("version_logo_id");
  CREATE INDEX "_site_branding_v_version_version__status_idx" ON "payload"."_site_branding_v" USING btree ("version__status");
  CREATE INDEX "_site_branding_v_created_at_idx" ON "payload"."_site_branding_v" USING btree ("created_at");
  CREATE INDEX "_site_branding_v_updated_at_idx" ON "payload"."_site_branding_v" USING btree ("updated_at");
  CREATE INDEX "_site_branding_v_latest_idx" ON "payload"."_site_branding_v" USING btree ("latest");
  CREATE INDEX "homepage_hero_banner_image_idx" ON "payload"."homepage_hero" USING btree ("banner_image_id");
  CREATE INDEX "homepage_hero__status_idx" ON "payload"."homepage_hero" USING btree ("_status");
  CREATE INDEX "_homepage_hero_v_version_version_banner_image_idx" ON "payload"."_homepage_hero_v" USING btree ("version_banner_image_id");
  CREATE INDEX "_homepage_hero_v_version_version__status_idx" ON "payload"."_homepage_hero_v" USING btree ("version__status");
  CREATE INDEX "_homepage_hero_v_created_at_idx" ON "payload"."_homepage_hero_v" USING btree ("created_at");
  CREATE INDEX "_homepage_hero_v_updated_at_idx" ON "payload"."_homepage_hero_v" USING btree ("updated_at");
  CREATE INDEX "_homepage_hero_v_latest_idx" ON "payload"."_homepage_hero_v" USING btree ("latest");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "payload"."site_branding" CASCADE;
  DROP TABLE "payload"."_site_branding_v" CASCADE;
  DROP TABLE "payload"."homepage_hero" CASCADE;
  DROP TABLE "payload"."_homepage_hero_v" CASCADE;
  DROP TYPE "payload"."enum_site_branding_status";
  DROP TYPE "payload"."enum__site_branding_v_version_status";
  DROP TYPE "payload"."enum_homepage_hero_status";
  DROP TYPE "payload"."enum__homepage_hero_v_version_status";`)
}
