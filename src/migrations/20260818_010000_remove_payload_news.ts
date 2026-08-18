import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Remove the Payload-owned News collection.
 *
 * The Break replaces it. Articles now live in the Prisma domain, because authorship, permissions,
 * comments, account merges and account-deletion safeguards are all tied to the main application's
 * accounts — keeping the content in a second store would have meant duplicating authentication and
 * leaving ownership unresolvable across the two.
 *
 * Both tables held ZERO rows when this was written (`payload.news` and `payload._news_v` were
 * checked directly), so nothing is lost. The collection was scaffolding that was never used.
 *
 * `payload_locked_documents_rels` is SHARED with every other collection, so only the News column and
 * its foreign key go — the table itself stays. Everything else here was owned outright by News.
 * Guarded with IF EXISTS so it is safe against a database that never had the collection.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload"."payload_locked_documents_rels"
      DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_news_fk";
    DROP INDEX IF EXISTS "payload"."payload_locked_documents_rels_news_id_idx";
    ALTER TABLE "payload"."payload_locked_documents_rels" DROP COLUMN IF EXISTS "news_id";

    DROP TABLE IF EXISTS "payload"."_news_v" CASCADE;
    DROP TABLE IF EXISTS "payload"."news" CASCADE;
  `)
}

/**
 * Recreate the shape of the News tables.
 *
 * Structure only. The collection and its editing UI are gone, and the site's articles live in the
 * Prisma `article` tables now — this exists to keep the migration reversible, not to bring the old
 * collection back into service.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payload"."news" (
      "id" serial PRIMARY KEY NOT NULL,
      "title" varchar NOT NULL,
      "slug" varchar NOT NULL,
      "excerpt" varchar,
      "content" jsonb,
      "cover_image_id" integer,
      "featured" boolean DEFAULT false,
      "published_at" timestamp(3) with time zone,
      "related_competition_slug" varchar,
      "related_player_legacy_id" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "_status" varchar DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS "payload"."_news_v" (
      "id" serial PRIMARY KEY NOT NULL,
      "parent_id" integer,
      "version_title" varchar,
      "version_slug" varchar,
      "version_excerpt" varchar,
      "version_content" jsonb,
      "version_cover_image_id" integer,
      "version_featured" boolean DEFAULT false,
      "version_published_at" timestamp(3) with time zone,
      "version_related_competition_slug" varchar,
      "version_related_player_legacy_id" varchar,
      "version_updated_at" timestamp(3) with time zone,
      "version_created_at" timestamp(3) with time zone,
      "version__status" varchar DEFAULT 'draft',
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "latest" boolean
    );

    ALTER TABLE "payload"."_news_v"
      ADD CONSTRAINT "_news_v_parent_id_news_id_fk"
      FOREIGN KEY ("parent_id") REFERENCES "payload"."news"("id") ON DELETE SET NULL;

    ALTER TABLE "payload"."payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "news_id" integer;
    ALTER TABLE "payload"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_news_fk"
      FOREIGN KEY ("news_id") REFERENCES "payload"."news"("id") ON DELETE CASCADE;
  `)
}
