---
"executor": patch
---

### Features

- Add headers list and identity field configuration when adding GraphQL, MCP, and OpenAPI sources (#224, #216)
- Expose upstream URL and render source favicons in the sidebar (#167)
- Add a global command palette (⌘K) (#168)
- Show agent provider logos on the MCP install card (#164)
- Adopt CardStack primitive across UI surfaces (#165)

### Bug Fixes

- Windows compatibility fixes across postinstall, desktop, plugins, and scripts (#211)
- Persist pending OAuth sessions via the binding store so MCP and Google Discovery sign-in survives reloads (#221)
- Standardize design system tokens and typography (#198)

### Internal

- Store MCP source config once per namespace instead of per binding (#223)
- Store OpenAPI and GraphQL invocation config on the source rather than per-tool (#222)
