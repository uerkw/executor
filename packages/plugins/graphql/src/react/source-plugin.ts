import { lazy } from "react";
import type { SourcePlugin } from "@executor/react";

// ---------------------------------------------------------------------------
// GraphQL source plugin — lazy-loaded components
// ---------------------------------------------------------------------------

export const graphqlSourcePlugin: SourcePlugin = {
  key: "graphql",
  label: "GraphQL",
  add: lazy(() => import("./AddGraphqlSource")),
  edit: lazy(() => import("./EditGraphqlSource")),
  summary: lazy(() => import("./GraphqlSourceSummary")),
};
