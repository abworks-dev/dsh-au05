# Third-party references and notices

The project-authored implementation and documentation are MIT licensed. No proprietary driver, executable, firmware or copied application artwork is bundled. The optional Studio input producer includes the reviewed CommonJS runtime subset of **ws 8.18.0 (MIT)**, with its original LICENSE under `packages/ulanzi-dsh-input/vendor/ws/LICENSE` and in the self-contained Studio plugin bundle. The DSH plugins use separately installed DSH APIs and the companion AU05 package; the Harness implementation is not redistributed.

DeepSeek Harness official package/slot conventions were consulted at commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`. The project uses its external package shape and API contracts; it does not distribute the Harness implementation. DeepSeek Harness and product names belong to their respective owners. The small no-op entry/registration conventions are not a claim to ownership of upstream code.

Hardware design references (not bundled implementations):

- loonghao/vibdock, MIT, Copyright (c) 2026 loonghao, commit `eb32139a11df028edafedd7cbaf70eeb32474aa9`.
- patrick-fu/vibekey-elements, MIT, Copyright (c) 2026 Patrick Fu, commit `c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73`.
- eddix/webhid-config-collection, commit `2710ac66371c93f2fc2618b394be34959be0d41a`: no explicit reusable license was found during review. Only protocol facts and source links are cited; source code, long documentation passages and artwork are not redistributed.

No VibeWand code/assets are included. No Ulanzi/Kehwin proprietary SDK or firmware is included. Reviewing reference implementations means this project must not describe its process as legally isolated clean-room engineering. If future changes copy MIT code or add native dependencies, retain the actual copyright/license text and extend this ledger before distribution.

AU05 activity-lamp presets, workTime 255, and public authentication / linked-state protocol layouts were adapted from ihavespoons/vibed at commit `f7c89385416e626a9c6c0c9d674153a9f4af6112` (MIT, Copyright (c) 2026 Ben Gittins). Its Swift daemon, binaries, firmware and assets are not bundled; the project retains its independent Windows transport and snapshot restoration. The attribution and full MIT permission/warranty text are included in the distributed [plugin license](<packages/dsh-plugin/LICENSE>).

Full fixed source links and limitations: [docs/sources.md](<docs/sources.md>).
