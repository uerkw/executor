import { BoxIcon } from "lucide-react";
import { useState } from "react";
import { getDomain } from "tldts";

// ---------------------------------------------------------------------------
// SourceFavicon — renders the source site's own public favicon.
// Do not fetch third-party favicon services here; source URLs may be private.
// ---------------------------------------------------------------------------

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const isIpHostname = (hostname: string): boolean =>
  IPV4_PATTERN.test(hostname) || hostname.includes(":");

export function sourceFaviconUrl(url: string | undefined, size: number): string | null {
  if (!url) return null;
  if (!URL.canParse(url)) return null;

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isIpHostname(hostname)
  ) {
    return null;
  }

  const domain = getDomain(hostname);
  if (!domain) return null;

  const favicon = new URL(`https://${domain}/favicon.ico`);
  favicon.searchParams.set("sz", String(size * 2));
  return favicon.toString();
}

export function SourceFavicon({ url, size = 16 }: { url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : sourceFaviconUrl(url, size);

  if (!src) {
    return (
      <BoxIcon
        aria-hidden
        className="shrink-0 text-muted-foreground"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-sm"
      style={{ width: size, height: size }}
    />
  );
}
