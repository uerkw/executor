---
"@executor-js/desktop": patch
"executor": patch
---

Fix: macOS DMGs no longer ship a mismatched-architecture sidecar binary.
electron-builder's `--arm64` / `--x64` CLI flags are overridden when the
config-level target objects pin `arch: ["arm64", "x64"]`, so every matrix
leg was building both archs from the same single-arch sidecar. Combined
with `--clobber` release uploads, the final DMGs carried the x86_64
sidecar everywhere, breaking spawn on Apple Silicon (errno -86 EBADARCH).
Drop the in-config arch list and let the per-leg CLI flag restrict.
