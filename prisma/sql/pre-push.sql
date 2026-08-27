-- Run BEFORE `prisma db push`, because the push itself creates indexes that need this.
--
-- schema.prisma declares two trigram indexes with `ops: raw("gin_trgm_ops")`. That operator class
-- only exists once pg_trgm is installed, so on a database that has never had it, the push fails
-- while creating them rather than afterwards. Prisma can declare the index but not the extension it
-- depends on (that needs the postgresqlExtensions preview feature), so it is asserted here.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
