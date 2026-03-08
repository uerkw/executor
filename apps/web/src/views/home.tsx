import { Link } from "@tanstack/react-router";
import { useSources, type Source } from "@executor-v3/react";
import { LoadableBlock } from "../components/loadable";
import { Badge } from "../components/ui/badge";
import { IconSources, IconDiscover } from "../components/icons";
import { CodeBlock } from "../components/code-block";

export function HomePage() {
  const sources = useSources();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10 lg:py-12">
        {/* Hero */}
        <div className="mb-10">
          <h1 className="font-display text-3xl tracking-tight text-foreground lg:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Manage sources, inspect tool surfaces, and monitor executions.
          </p>
        </div>

        {/* Quick stats row */}
        <LoadableBlock loadable={sources} loading="Loading...">
          {(items) => (
            <div className="grid gap-3 sm:grid-cols-3 mb-8">
              <QuickStat label="Connected sources" value={String(items.length)} />
              <QuickStat
                label="Total tools"
                value={items.length > 0 ? `${items.length} sources` : "0"}
                sub="Inspect a source to see tools"
              />
              <QuickStat label="Executions" value="--" sub="Coming soon" />
            </div>
          )}
        </LoadableBlock>

        {/* Two-column dashboard grid */}
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Sources card */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <IconSources className="size-3.5" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Sources</h2>
              </div>
              <span className="text-[11px] text-muted-foreground/50">
                Connected tool providers
              </span>
            </div>
            <div className="p-3">
              <LoadableBlock loadable={sources} loading="Loading sources...">
                {(items) =>
                  items.length === 0 ? (
                    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border">
                      <div className="text-center px-4">
                        <p className="text-[13px] font-medium text-foreground/70">No sources connected</p>
                        <p className="mt-1 text-[12px] text-muted-foreground/50">
                          Run{" "}
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary">
                            executor dev seed-github
                          </code>{" "}
                          to get started
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {items.map((source) => (
                        <SourceRow key={source.id} source={source} />
                      ))}
                    </div>
                  )
                }
              </LoadableBlock>
            </div>
          </section>

          {/* Getting started / MCP setup card */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <IconDiscover className="size-3.5" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Quick start</h2>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-[13px] font-medium text-foreground">Connect to an agent</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Point your MCP-compatible client at this executor instance to give agents access to all connected tool sources.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <CodeBlock
                  lang="json"
                  code={JSON.stringify({
                    mcpServers: {
                      executor: {
                        url: `${typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8788"}/v1/mcp`,
                      },
                    },
                  }, null, 2)}
                />
              </div>
              <div className="space-y-2">
                <StepItem number={1} text="Add a source via CLI or API" />
                <StepItem number={2} text="Point your agent at the MCP endpoint above" />
                <StepItem number={3} text="The agent discovers and calls tools through executor" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  return (
    <Link
      to="/sources/$sourceId"
      params={{ sourceId: source.id }}
      search={{ tab: "model" }}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <IconSources className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground group-hover:text-primary transition-colors">
            {source.name}
          </span>
          <Badge variant="outline" className="text-[9px]">{source.kind}</Badge>
        </div>
        <p className="truncate text-[11px] text-muted-foreground/50 font-mono mt-0.5">
          {source.endpoint}
        </p>
      </div>
      <Badge variant={source.status === "connected" ? "default" : "muted"} className="shrink-0">
        {source.status}
      </Badge>
      <span className="text-[11px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity">
        &rarr;
      </span>
    </Link>
  );
}

function QuickStat(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
        {props.label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        {props.value}
      </div>
      {props.sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground/40">{props.sub}</div>
      )}
    </div>
  );
}

function StepItem(props: { number: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {props.number}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground">{props.text}</span>
    </div>
  );
}
