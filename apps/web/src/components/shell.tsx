import { useState, useMemo } from "react";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useSources, type Source } from "@executor-v3/react";
import { cn } from "../lib/utils";
import { IconSources, IconChevron } from "./icons";
import { LoadableBlock } from "./loadable";

// ── Kind labels + ordering ───────────────────────────────────────────────

const kindMeta: Record<string, { label: string; order: number }> = {
  mcp: { label: "MCP", order: 0 },
  openapi: { label: "OpenAPI", order: 1 },
  graphql: { label: "GraphQL", order: 2 },
  internal: { label: "Internal", order: 3 },
};

function groupByKind(sources: ReadonlyArray<Source>) {
  const groups = new Map<string, Source[]>();
  for (const s of sources) {
    const list = groups.get(s.kind) ?? [];
    list.push(s);
    groups.set(s.kind, list);
  }
  return [...groups.entries()].sort(
    (a, b) => (kindMeta[a[0]]?.order ?? 99) - (kindMeta[b[0]]?.order ?? 99),
  );
}

// ── Status dot color ─────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  connected: "bg-primary",
  probing: "bg-amber-400",
  draft: "bg-muted-foreground/30",
  auth_required: "bg-amber-500",
  error: "bg-destructive",
};

// ── AppShell ─────────────────────────────────────────────────────────────

export function AppShell() {
  const sources = useSources();
  const matchRoute = useMatchRoute();
  const isHome = matchRoute({ to: "/" });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:w-56">
        {/* Brand */}
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
          <Link to="/" className="flex items-center gap-1.5">
            <span className="font-display text-base tracking-tight text-foreground">
              executor
            </span>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              v3
            </span>
          </Link>
        </div>

        {/* Main nav */}
        <nav className="flex flex-1 flex-col p-2 overflow-y-auto">
          <NavItem to="/" label="Dashboard" active={!!isHome} />

          {/* Sources tree */}
          <div className="mt-5 mb-1 px-2.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Sources
          </div>
          <LoadableBlock loadable={sources} loading="Loading...">
            {(items) =>
              items.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground/40">
                  No sources yet
                </div>
              ) : (
                <SourceTree sources={items} matchRoute={matchRoute} />
              )
            }
          </LoadableBlock>
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground/30">
            Local instance
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

// ── SourceTree ───────────────────────────────────────────────────────────

function SourceTree(props: {
  sources: ReadonlyArray<Source>;
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  const groups = useMemo(() => groupByKind(props.sources), [props.sources]);

  // If there's only one kind, skip the group headers
  if (groups.length === 1) {
    return (
      <div className="flex flex-col gap-px">
        {groups[0]![1].map((source) => (
          <SourceItem key={source.id} source={source} matchRoute={props.matchRoute} depth={0} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map(([kind, sources]) => (
        <KindGroup key={kind} kind={kind} sources={sources} matchRoute={props.matchRoute} />
      ))}
    </div>
  );
}

// ── KindGroup (collapsible) ──────────────────────────────────────────────

function KindGroup(props: {
  kind: string;
  sources: Source[];
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  // Auto-expand if any source in this group is active
  const hasActive = props.sources.some((s) =>
    props.matchRoute({ to: "/sources/$sourceId", params: { sourceId: s.id }, fuzzy: true }),
  );
  const [open, setOpen] = useState(true);

  return (
    <div>
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <IconChevron
          className={cn(
            "size-2.5 shrink-0 text-muted-foreground/30 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="uppercase tracking-wider">{kindMeta[props.kind]?.label ?? props.kind}</span>
        <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/30">
          {props.sources.length}
        </span>
      </button>

      {/* Children */}
      {open && (
        <div className="flex flex-col gap-px mt-px">
          {props.sources.map((source) => (
            <SourceItem key={source.id} source={source} matchRoute={props.matchRoute} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── SourceItem ───────────────────────────────────────────────────────────

function SourceItem(props: {
  source: Source;
  matchRoute: ReturnType<typeof useMatchRoute>;
  depth: number;
}) {
  const { source, matchRoute, depth } = props;
  const active = matchRoute({
    to: "/sources/$sourceId",
    params: { sourceId: source.id },
    fuzzy: true,
  });

  return (
    <Link
      to="/sources/$sourceId"
      params={{ sourceId: source.id }}
      search={{ tab: "model" }}
      className={cn(
        "group flex items-center gap-2 rounded-md py-1.5 text-[12px] transition-colors",
        depth === 0 ? "px-2.5" : "pl-6 pr-2.5",
        active
          ? "bg-sidebar-active text-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      )}
    >
      {/* Tree connector line for nested items */}
      {depth > 0 && (
        <span className="absolute left-[18px] h-full w-px bg-sidebar-border" aria-hidden />
      )}

      <IconSources className="size-3 shrink-0 text-muted-foreground/40" />
      <span className="flex-1 truncate">{source.name}</span>

      {/* Status dot + tooltip */}
      <span
        className={cn("size-1.5 shrink-0 rounded-full", statusColor[source.status] ?? "bg-muted-foreground/30")}
        title={source.status}
      />
    </Link>
  );
}

// ── NavItem ──────────────────────────────────────────────────────────────

function NavItem(props: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={props.to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
        props.active
          ? "bg-sidebar-active text-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      )}
    >
      {props.label}
    </Link>
  );
}
