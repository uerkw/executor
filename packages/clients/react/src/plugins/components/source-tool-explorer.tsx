import { startTransition, useEffect, type ReactNode } from "react";

import {
  useSourceDiscovery,
  useSourceInspection,
  useSourceToolDetail,
} from "../../hooks/sources";
import { Badge } from "./badge";
import { LoadableBlock } from "./loadable";
import {
  SourceToolDiscoveryPanel,
  SourceToolModelWorkbench,
} from "./source-tool-workbench";
import type { SourceToolExplorerSearch } from "./source-tool-explorer-search";
import { cn } from "../lib/cn";

export const SourceToolExplorer = (props: {
  sourceId: string;
  title: string;
  kind: string;
  search: SourceToolExplorerSearch;
  navigate?: (search: {
    tab: "model" | "discover";
    tool?: string;
    query?: string;
  }) => void | Promise<void>;
  actions?: ReactNode;
  summary?: ReactNode;
}) => {
  const inspection = useSourceInspection(props.sourceId);
  const tab = props.search.tab === "discover" ? "discover" : "model";
  const toolPath = props.search.tool ?? null;
  const detail = useSourceToolDetail(props.sourceId, tab === "model" ? toolPath : null);
  const discovery = useSourceDiscovery({
    sourceId: props.sourceId,
    query: props.search.query ?? "",
    limit: 20,
  });
  const navigate = props.navigate;

  useEffect(() => {
    if (
      tab !== "model"
      || inspection.status !== "ready"
      || props.search.tool
      || !navigate
    ) {
      return;
    }

    const firstTool = inspection.data.tools[0]?.path;
    if (!firstTool) {
      return;
    }

    startTransition(() => {
      void navigate({
        tab: "model",
        tool: firstTool,
        query: props.search.query,
      });
    });
  }, [inspection, navigate, props.search.query, props.search.tool, tab]);

  return (
    <LoadableBlock loadable={inspection} loading="Loading source...">
      {(loadedInspection) => {
        const selectedTool =
          loadedInspection.tools.find((candidate) => candidate.path === toolPath)
          ?? loadedInspection.tools[0]
          ?? null;

        return (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {props.title}
                </h2>
                <Badge variant="outline">{props.kind}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
                  {(["model", "discover"] as const).map((tabId) => (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => {
                        if (!navigate) {
                          return;
                        }

                        startTransition(() => {
                          void navigate({
                            tab: tabId,
                            tool:
                              tabId === "model"
                                ? (selectedTool?.path ?? undefined)
                                : props.search.tool,
                            query: props.search.query,
                          });
                        });
                      }}
                      className={cn(
                        "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                        tabId === tab
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tabId === "model" ? "Tools" : "Search"}
                    </button>
                  ))}
                </div>
                {props.actions}
              </div>
            </div>

            {props.summary && (
              <div className="shrink-0 border-b border-border bg-card/30 px-4 py-2">
                {props.summary}
              </div>
            )}

            <div className="flex min-h-0 flex-1 overflow-hidden">
              {tab === "model" ? (
                <SourceToolModelWorkbench
                  bundle={loadedInspection}
                  detail={detail}
                  selectedToolPath={selectedTool?.path ?? null}
                  onSelectTool={(nextToolPath) => {
                    if (!navigate) {
                      return;
                    }

                    startTransition(() => {
                      void navigate({
                        tab: "model",
                        tool: nextToolPath,
                        query: props.search.query,
                      });
                    });
                  }}
                  sourceId={props.sourceId}
                />
              ) : (
                <SourceToolDiscoveryPanel
                  discovery={discovery}
                  initialQuery={props.search.query ?? ""}
                  onSubmitQuery={(query) => {
                    if (!navigate) {
                      return;
                    }

                    startTransition(() => {
                      void navigate({
                        tab: "discover",
                        tool: props.search.tool,
                        query,
                      });
                    });
                  }}
                  onOpenTool={(nextToolPath) => {
                    if (!navigate) {
                      return;
                    }

                    startTransition(() => {
                      void navigate({
                        tab: "model",
                        tool: nextToolPath,
                        query: props.search.query,
                      });
                    });
                  }}
                />
              )}
            </div>
          </div>
        );
      }}
    </LoadableBlock>
  );
};
