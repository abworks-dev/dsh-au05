# Third-party notices

`vendor/ws` is the unmodified public `ws` 8.18.0 JavaScript WebSocket library, retained from the previously reviewed local official-SDK diagnostic dependency. Copyright Einar Otto Stangvik, Arnout Kazemier and contributors, Luigi Pinca and contributors. MIT license text is retained at `vendor/ws/LICENSE`. No dependency download or lifecycle scripts are used in this delivery.

The Ulanzi public SDK protocol was consulted at fixed commit `550ab80c69285ecf259bd494a7fff767c14f0c0f`; this package contains an independently implemented minimal action adapter, not the full SDK. It uses a new plugin/action namespace, never a vendor or another installed plugin's UUID. This package is not an Ulanzi endorsement or a claim of AU05 dedicated Task-key support.
