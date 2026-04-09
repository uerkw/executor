// ---------------------------------------------------------------------------
// Cloud-specific identity & multi-tenancy tables
// ---------------------------------------------------------------------------
//
// AuthKit owns the canonical user/membership data. We mirror minimally:
//
//   - `accounts`  — login identity (foreign key anchor for created_by, etc.)
//   - `organizations` — billing entity, scoping root for all domain data
//
// We do NOT mirror memberships, invitations, or user profile data.
// Those live in WorkOS and are queried via API when needed.

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Login identity. The `id` is the WorkOS user ID. */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Organization (billing entity, scoping root). The `id` is the WorkOS organization ID. */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
