'use strict';
// Studio's documented JavaScript entrypoint suffix; keep the tested CommonJS service unchanged.
const { run, writeStartupFailure } = require('./service.cjs');
module.exports = { run };
if (require.main === module) {
  // Do not log pairing, SDK frames, paths or exception payloads.
  try { run(); } catch { writeStartupFailure(); process.exitCode = 1; }
}
