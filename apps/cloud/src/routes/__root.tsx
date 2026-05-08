import React from "react";
import * as Sentry from "@sentry/react";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { AutumnProvider } from "autumn-js/react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { FrontendErrorReporter } from "@executor-js/react/api/error-reporting";
import { ExecutorProvider } from "@executor-js/react/api/provider";
import { Button } from "@executor-js/react/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@executor-js/react/components/dialog";
import { Skeleton } from "@executor-js/react/components/skeleton";
import { Toaster } from "@executor-js/react/components/sonner";
import { ExecutorPluginsProvider } from "@executor-js/sdk/client";
import { plugins as clientPlugins } from "virtual:executor/plugins-client";
import { AuthProvider, useAuth } from "../web/auth";
import { LoginPage } from "../web/pages/login";
import { OnboardingPage } from "../web/pages/onboarding";
import { Shell } from "../web/shell";
import appCss from "@executor-js/react/globals.css?url";

if (typeof window !== "undefined" && import.meta.env.VITE_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
    tunnel: "/api/sentry-tunnel",
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

if (typeof window !== "undefined" && import.meta.env.VITE_PUBLIC_POSTHOG_KEY) {
  const analyticsPath = (import.meta.env.VITE_PUBLIC_ANALYTICS_PATH ?? "a").replace(
    /^\/+|\/+$/g,
    "",
  );

  posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
    api_host:
      import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? `${window.location.origin}/api/${analyticsPath}`,
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    person_profiles: "identified_only",
  });
}

const captureFrontendError: FrontendErrorReporter = (error, context) => {
  Sentry.captureException(error, (scope) => {
    scope.setTag("executor.ui.surface", context.surface);
    scope.setTag("executor.ui.action", context.action);
    scope.setTag("executor.ui.severity", context.severity ?? "error");
    scope.setContext("executor.ui", {
      surface: context.surface,
      action: context.action,
      message: context.message,
      metadata: context.metadata,
    });
    return scope;
  });
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Executor Cloud" },
    ],
    links: [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon-192.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: import.meta.env.DEV ? [{ src: "https://ui.sh/ui-picker.js" }] : [],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <PostHogProvider client={posthog}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </PostHogProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar skeleton */}
      <aside className="hidden w-52 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col lg:w-56">
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
          <Skeleton className="h-4 w-20" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <div className="mt-5 mb-2 px-2.5">
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-11/12 rounded-md" />
            <Skeleton className="h-7 w-10/12 rounded-md" />
            <Skeleton className="h-7 w-9/12 rounded-md" />
          </div>
        </nav>
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content skeleton */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-20" />
          <div className="w-7 shrink-0" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function ShellErrorFallback() {
  const [slackOpen, setSlackOpen] = React.useState(false);
  const supportLinks = [
    { label: "Discord", href: "https://discord.gg/eF29HBHwM6", icon: DiscordMark },
    {
      label: "GitHub Issues",
      href: "https://github.com/RhysSullivan/executor/issues",
      icon: GitHubMark,
    },
    { label: "Email", href: "mailto:rhys@executor.sh?subject=Executor%20support", icon: MailMark },
  ] as const;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <section className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full border border-border bg-muted">
          <span className="text-lg font-semibold text-muted-foreground">!</span>
        </div>
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We&apos;ve tracked it. Give refreshing a try, and get in touch if support is needed.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
          <Dialog open={slackOpen} onOpenChange={setSlackOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <SlackMark className="size-4" />
                Slack
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Slack Connect</DialogTitle>
                <DialogDescription>
                  Add <span className="font-medium text-foreground">rhys@executor.sh</span> to your
                  Slack Connect channel and mention that you need Executor support.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Done
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {supportLinks.map((link) => (
            // oxlint-disable-next-line react/jsx-no-new-function-as-prop -- static support link component choice
            <a
              key={link.label}
              href={link.href}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-foreground transition-colors hover:bg-muted"
            >
              <link.icon className="size-4" />
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.8 13.8 0 0 0-.64 1.32 18.4 18.4 0 0 0-5.44 0 13.8 13.8 0 0 0-.64-1.32 19.7 19.7 0 0 0-4.97 1.57C.53 9.09-.32 13.69.1 18.22a19.9 19.9 0 0 0 6.08 3.03 14.7 14.7 0 0 0 1.3-2.09 12.8 12.8 0 0 1-2.04-.97l.5-.38a14.2 14.2 0 0 0 12.12 0l.5.38c-.65.38-1.33.7-2.04.97.37.74.8 1.44 1.3 2.09a19.9 19.9 0 0 0 6.08-3.03c.5-5.25-.84-9.8-3.58-13.85ZM8.02 15.43c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Z" />
    </svg>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.15c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .98-.31 3.17 1.18a10.9 10.9 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.16c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function MailMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7l9 6 9-6M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"
      />
    </svg>
  );
}

function SlackMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.527 2.527 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.272 0a2.528 2.528 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.521 2.522v6.312z"
        fill="#2EB67D"
      />
      <path
        d="M15.163 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zm0-1.272a2.527 2.527 0 0 1-2.521-2.521 2.527 2.527 0 0 1 2.521-2.521h6.315A2.527 2.527 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.521h-6.315z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function AuthGate() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <ShellSkeleton />;
  }

  if (auth.status === "unauthenticated") {
    return <LoginPage />;
  }

  if (auth.organization == null) {
    return <OnboardingPage />;
  }

  return (
    <AutumnProvider pathPrefix="/api/autumn">
      <Sentry.ErrorBoundary fallback={<ShellErrorFallback />} showDialog={false}>
        <ExecutorProvider fallback={<ShellSkeleton />} onHandledError={captureFrontendError}>
          <ExecutorPluginsProvider plugins={clientPlugins}>
            <Shell />
            <Toaster />
          </ExecutorPluginsProvider>
        </ExecutorProvider>
      </Sentry.ErrorBoundary>
    </AutumnProvider>
  );
}
