// ---------------------------------------------------------------------------
// JSON Schema $ref hoisting and re-attachment
//
// Core logic for deduplicating shared definitions across tools.
// Used by any ToolRegistry implementation (in-memory, database-backed, etc.)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** Canonical $ref prefix used internally. */
const CANONICAL_PREFIX = "#/$defs/";

/** Patterns we accept as equivalent $ref pointers into shared definitions. */
const REF_PATTERN = /^#\/(?:\$defs|definitions|components\/schemas)\/(.+)$/;

/** Extract the definition name from a $ref pointer */
const parseRefName = (ref: string): string | undefined =>
  ref.match(REF_PATTERN)?.[1];

/**
 * Normalize a single `$ref` string to canonical `#/$defs/<name>` form.
 * Returns the string unchanged if it doesn't match a known pattern.
 */
const normalizeRef = (ref: string): string => {
  const name = parseRefName(ref);
  return name ? `${CANONICAL_PREFIX}${name}` : ref;
};

/**
 * Recursively rewrite all `$ref` pointers in a schema to canonical form.
 * Returns the input unchanged if no rewrites are needed.
 */
export const normalizeRefs = (node: unknown): unknown => {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((item) => {
      const n = normalizeRefs(item);
      if (n !== item) changed = true;
      return n;
    });
    return changed ? out : node;
  }

  const obj = node as Obj;

  // Fast path: $ref node — only rewrite the pointer, shallow copy rest
  if (typeof obj.$ref === "string") {
    const normalized = normalizeRef(obj.$ref);
    return normalized !== obj.$ref ? { ...obj, $ref: normalized } : obj;
  }

  let changed = false;
  const result: Obj = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = normalizeRefs(v);
    if (n !== v) changed = true;
    result[k] = n;
  }
  return changed ? result : obj;
};

/**
 * Extract `$defs`, `definitions`, and `components.schemas` from a JSON Schema,
 * returning { stripped, defs } where `stripped` is the schema without local
 * definitions and `defs` is a flat map of definition name → schema.
 */
export const hoistDefinitions = (
  schema: unknown,
): { stripped: unknown; defs: Record<string, unknown> } => {
  if (schema == null || typeof schema !== "object") {
    return { stripped: schema, defs: {} };
  }
  const obj = schema as Obj;
  const defs: Record<string, unknown> = {};

  // $defs (JSON Schema draft 2019+, Effect)
  if (obj.$defs && typeof obj.$defs === "object") {
    for (const [k, v] of Object.entries(obj.$defs as Obj)) {
      defs[k] = v;
    }
  }

  // definitions (JSON Schema draft-07)
  if (obj.definitions && typeof obj.definitions === "object") {
    for (const [k, v] of Object.entries(obj.definitions as Obj)) {
      defs[k] = v;
    }
  }

  // components.schemas (OpenAPI)
  const components = obj.components as Obj | undefined;
  if (components?.schemas && typeof components.schemas === "object") {
    for (const [k, v] of Object.entries(components.schemas as Obj)) {
      defs[k] = v;
    }
  }

  // Build stripped schema without the definition containers
  const { $defs: _a, definitions: _b, components: _c, ...rest } = obj;
  // If components had other keys besides schemas, preserve them
  if (components && typeof components === "object") {
    const { schemas: _s, ...otherComponents } = components;
    if (Object.keys(otherComponents).length > 0) {
      (rest as Obj).components = otherComponents;
    }
  }

  return { stripped: rest, defs };
};

/**
 * Walk a schema and collect all $ref target names transitively.
 * e.g. "#/$defs/Address" → "Address", and if Address references City, both.
 */
export const collectRefs = (
  node: unknown,
  defs: ReadonlyMap<string, unknown>,
  found: Set<string> = new Set(),
): Set<string> => {
  if (node == null || typeof node !== "object") return found;
  const obj = node as Obj;

  if (typeof obj.$ref === "string") {
    const name = parseRefName(obj.$ref);
    if (name && !found.has(name)) {
      found.add(name);
      const def = defs.get(name);
      if (def) collectRefs(def, defs, found);
    }
    return found;
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        for (const item of v) collectRefs(item, defs, found);
      } else {
        collectRefs(v, defs, found);
      }
    }
  }
  return found;
};

/**
 * Re-attach only the referenced shared definitions into a schema,
 * so the caller gets a self-contained, usable JSON Schema.
 *
 * Assumes all `$ref` pointers and definitions have already been normalized
 * to `#/$defs/<name>` form at registration time.
 */
export const reattachDefs = (
  schema: unknown,
  defs: ReadonlyMap<string, unknown>,
): unknown => {
  if (schema == null || typeof schema !== "object") return schema;
  const refs = collectRefs(schema, defs);
  if (refs.size === 0) return schema;

  const attached: Record<string, unknown> = {};
  for (const name of refs) {
    const def = defs.get(name);
    if (def) attached[name] = def;
  }

  return { ...(schema as Record<string, unknown>), $defs: attached };
};
