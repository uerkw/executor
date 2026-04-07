// ---------------------------------------------------------------------------
// Shared Drizzle DB type
// ---------------------------------------------------------------------------

import type { PgDatabase } from "drizzle-orm/pg-core";

export type DrizzleDb = PgDatabase<any, any, any>;
