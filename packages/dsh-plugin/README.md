# DSH AU05 preview plugin

Read-only status decoration in the official external-client package format. No hardware driver, pairing, microphone capture, input injection or permission answering is enabled.

Install only into a disposable/test DSH profile, using DSH's official plugin manager `install_bundle` with this package's absolute directory. The exact manager UI/tool availability depends on the installed DSH version. Do not edit a live profile manually. No installation was performed as part of creating this repository.

The browser entry registers through `window.__ModuleLoader__.load`, the Host entry exports `apply()`, and `dsh.bundle.patch` declares the Cordis insertion patch. No standalone Vite server or app.asar modification is needed. Official API baseline: deepseek-ai/deepseek-harness commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`.

Besides API-shape unit tests, the actual installed DSH 0.2.1-rc.3 loader, React 18.3.1, Cordis and UI renderer passed 13 assertions in an isolated offline browser fixture, including slot-bound status rendering and plugin-fiber disposal. Session data/scopes are synthetic: this does **not** mean the bundle was installed into the live GUI or that its CSP, routing or profile lifecycle was verified. See the [runtime validation report](../../docs/plugin-runtime-validation.md) for evidence and reproduction.

See the [root README](../../README.md) and [plugin architecture](../../docs/dsh-plugin.md) for the architecture and staged installation plan. This package is not published on npm.
