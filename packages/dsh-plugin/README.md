# DSH AU05 read-only observer

Official-format external client package. Reads only the slot-bound session status. An explicit **Connect observer** button can display normalized input reports from a separate Windows read-only collector at `http://127.0.0.1:17376`. There is no session send/cancel/approval/command operation, microphone capture, keyboard injection, device configuration or lighting code.

Use the official DSH Plugins page → add third-party plugin → this package's absolute directory. Back up plugin configuration first; a deployment without live reconciliation may require a later DSH restart. Never edit app.asar or profile files manually. This package does not start the collector or establish any network connection on mount.

The temporary observer token goes only into a password input, is cleared after connection, and is never stored in localStorage, cookies, URLs or logs. Fetch uses an Authorization header, `credentials: 'omit'` and no referrer. Explicit Disconnect or plugin disable/unload aborts the stream. The authorized connection and last observation live only in that plugin instance's memory: a composer view unmount/remount unsubscribes/resubscribes without reconnecting or dropping the observation. No connection is restored after a page reload or plugin reload. The UI shows view mount/detachment counters for lifecycle diagnosis. The observer has only authenticated GET health/events routes and exact-origin CORS; it cannot accept session/device commands.

The browser entry registers through `window.__ModuleLoader__.load`, the Host entry exports a no-op `apply()`, and `dsh.bundle.patch` declares the Cordis insertion patch. No replacement DSH or Vite server is needed. npm publication has not been performed.

The [earlier runtime validation](../../docs/plugin-runtime-validation.md) used installed DSH code with synthetic session data, not a live GUI installation. See the [root README](../../README.md), [plugin architecture](../../docs/dsh-plugin.md) and [read-only hardware evidence](../../docs/readonly-validation.md) for the distinction between offline checks and actual results.
