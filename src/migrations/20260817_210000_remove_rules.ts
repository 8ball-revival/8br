import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Remove the competition Rules feature from the Payload schema.
 *
 * The Rules collection is gone from the application, so the tables it owned go with it: `rules`,
 * its drafts/versions companion `_rules_v`, and the `rules_id` column on the shared
 * `payload_locked_documents_rels` table.
 *
 * `payload_locked_documents_rels` is SHARED with every other collection, so only the Rules column
 * and its foreign key are dropped — the table itself stays. Everything else here is owned outright
 * by Rules and is dropped whole.
 *
 * Both tables held zero rows when this was written, so no content is lost. The drops are guarded
 * with IF EXISTS so the migration is safe to run against a database that never had the collection.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload"."payload_locked_documents_rels"
      DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rules_fk";
    DROP INDEX IF EXISTS "payload"."payload_locked_documents_rels_rules_id_idx";
    ALTER TABLE "payload"."payload_locked_documents_rels" DROP COLUMN IF EXISTS "rules_id";

    DROP TABLE IF EXISTS "payload"."_rules_v" CASCADE;
    DROP TABLE IF EXISTS "payload"."rules" CASCADE;
  `)
}

/**
 * Recreate the shape of the Rules tables.
 *
 * Structure only: the feature and its editing UI no longer exist, so this exists to keep the
 * migration reversible rather than to bring the feature back.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payload"."rules" (
      "id" serial PRIMARY KEY NOT NULL,
      "title" varchar,
      "slug" varchar,
      "body" jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "payload"."_rules_v" (
      "id" serial PRIMARY KEY NOT NULL,
      "parent_id" integer,
      "version_title" varchar,
      "version_slug" varchar,
      "version_body" jsonb,
      "version_updated_at" timestamp(3) with time zone,
      "version_created_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "payload"."_rules_v"
      ADD CONSTRAINT "_rules_v_parent_id_rules_id_fk"
      FOREIGN KEY ("parent_id") REFERENCES "payload"."rules"("id") ON DELETE SET NULL;

    ALTER TABLE "payload"."payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "rules_id" integer;
    ALTER TABLE "payload"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_rules_fk"
      FOREIGN KEY ("rules_id") REFERENCES "payload"."rules"("id") ON DELETE CASCADE;
  `)
}
