import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Personal per-account color theme (see src/lib/theme). Adds the three columns the Users collection
// now carries. Idempotent (IF [NOT] EXISTS). In local dev these are created automatically by Payload's
// dev `push`; this migration brings production in line. NOT auto-applied — deploy only with approval.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload"."users" ADD COLUMN IF NOT EXISTS "theme_type" varchar DEFAULT 'WCC_DEFAULT';
    ALTER TABLE "payload"."users" ADD COLUMN IF NOT EXISTS "theme_main_color" varchar;
    ALTER TABLE "payload"."users" ADD COLUMN IF NOT EXISTS "theme_accent_color" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload"."users" DROP COLUMN IF EXISTS "theme_type";
    ALTER TABLE "payload"."users" DROP COLUMN IF EXISTS "theme_main_color";
    ALTER TABLE "payload"."users" DROP COLUMN IF EXISTS "theme_accent_color";`)
}
