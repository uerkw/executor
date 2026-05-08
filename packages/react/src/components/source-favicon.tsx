import { BoxIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// SourceFavicon — renders a neutral local source icon.
// Do not fetch third-party favicon services here; source URLs may be private.
// ---------------------------------------------------------------------------

export function SourceFavicon({ size = 16 }: { url?: string; size?: number }) {
  return (
    <BoxIcon
      aria-hidden
      className="shrink-0 text-muted-foreground"
      style={{ width: size, height: size }}
    />
  );
}
