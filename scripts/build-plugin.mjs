// Embed the dependency-free voice adapter into the official single-file browser entry.
import { readFile, writeFile } from 'node:fs/promises';
const entry = new URL('../packages/dsh-plugin/client.js', import.meta.url);
const voice = (await readFile(new URL('../packages/dsh-plugin/src/voice.js', import.meta.url), 'utf8')).replace(/^export function /m, 'function ');
if (/^\s*(?:import|export)\b/m.test(voice)) throw new Error('voice_source_must_be_self_contained');
const application = (await readFile(new URL('../packages/dsh-plugin/src/dsh-application.js', import.meta.url), 'utf8')).replace(/^export function /m, 'function ');
if (/^\s*(?:import|export)\b/m.test(application)) throw new Error('application_source_must_be_self_contained');
const before = await readFile(entry, 'utf8');
const region = /\/\* AU05_VOICE_ADAPTER_BEGIN \*\/[\s\S]*?\/\* AU05_VOICE_ADAPTER_END \*\//;
const placeholder = '/* AU05_VOICE_ADAPTER */';
if (!region.test(before) && !before.includes(placeholder)) throw new Error('voice_adapter_marker_missing');
const replacement = `/* AU05_VOICE_ADAPTER_BEGIN */\n${voice.trimEnd()}\n/* AU05_VOICE_ADAPTER_END */`;
const withVoice = region.test(before) ? before.replace(region, () => replacement) : before.replace(placeholder, () => replacement);
const applicationRegion = /\/\* AU05_APPLICATION_ADAPTER_BEGIN \*\/[\s\S]*?\/\* AU05_APPLICATION_ADAPTER_END \*\//;
const applicationPlaceholder = '/* AU05_APPLICATION_ADAPTER */';
if (!applicationRegion.test(withVoice) && !withVoice.includes(applicationPlaceholder)) throw new Error('application_adapter_marker_missing');
const applicationReplacement = `/* AU05_APPLICATION_ADAPTER_BEGIN */\n${application.trimEnd()}\n/* AU05_APPLICATION_ADAPTER_END */`;
const withApplication = applicationRegion.test(withVoice) ? withVoice.replace(applicationRegion, () => applicationReplacement)
  : withVoice.replace(applicationPlaceholder, () => applicationReplacement);
const regions = (await readFile(new URL('../packages/dsh-plugin/src/regions.js', import.meta.url), 'utf8')).replace(/^export function /m, 'function ');
if (/^\s*(?:import|export)\b/m.test(regions)) throw new Error('regions_source_must_be_self_contained');
const regionsMarker = /\/\* AU05_REGIONS_BEGIN \*\/[\s\S]*?\/\* AU05_REGIONS_END \*\//;
const regionsPlaceholder = '/* AU05_REGIONS */';
if (!regionsMarker.test(withApplication) && !withApplication.includes(regionsPlaceholder)) throw new Error('regions_adapter_marker_missing');
const regionsReplacement = `/* AU05_REGIONS_BEGIN */\n${regions.trimEnd()}\n/* AU05_REGIONS_END */`;
const withRegions = regionsMarker.test(withApplication) ? withApplication.replace(regionsMarker, () => regionsReplacement)
  : withApplication.replace(regionsPlaceholder, () => regionsReplacement);
const capsule = (await readFile(new URL('../packages/dsh-plugin/src/capsule.js', import.meta.url), 'utf8')).replace(/^export function /m, 'function ');
if (/^\s*(?:import|export)\b/m.test(capsule)) throw new Error('capsule_source_must_be_self_contained');
const capsuleMarker = /\/\* AU05_CAPSULE_BEGIN \*\/[\s\S]*?\/\* AU05_CAPSULE_END \*\//;
const capsulePlaceholder = '/* AU05_CAPSULE */';
if (!capsuleMarker.test(withRegions) && !withRegions.includes(capsulePlaceholder)) throw new Error('capsule_adapter_marker_missing');
const capsuleReplacement = `/* AU05_CAPSULE_BEGIN */\n${capsule.trimEnd()}\n/* AU05_CAPSULE_END */`;
const withCapsule = capsuleMarker.test(withRegions) ? withRegions.replace(capsuleMarker, () => capsuleReplacement)
  : withRegions.replace(capsulePlaceholder, () => capsuleReplacement);
const uiSources = await Promise.all(['panel-styles.js', 'panel-primitives.js'].map(async file =>
  (await readFile(new URL(`../packages/dsh-plugin/src/ui/${file}`, import.meta.url), 'utf8')).replace(/^export /gm, '')));
if (uiSources.some(source => /^\s*(?:import|export)\b/m.test(source))) throw new Error('panel_ui_source_must_be_self_contained');
const uiMarker = /\/\* AU05_PANEL_UI_BEGIN \*\/[\s\S]*?\/\* AU05_PANEL_UI_END \*\//;
const uiPlaceholder = '/* AU05_PANEL_UI */';
if (!uiMarker.test(withCapsule) && !withCapsule.includes(uiPlaceholder)) throw new Error('panel_ui_marker_missing');
const uiReplacement = `/* AU05_PANEL_UI_BEGIN */\n${uiSources.join('\n')}\n/* AU05_PANEL_UI_END */`;
const after = uiMarker.test(withCapsule) ? withCapsule.replace(uiMarker, () => uiReplacement)
  : withCapsule.replace(uiPlaceholder, () => uiReplacement);
if (process.argv.includes('--check')) {
  if (after !== before) throw new Error('voice_adapter_out_of_date_run_npm_run_build_plugin');
  console.log('Plugin browser adapter is current.');
} else {
  if (after !== before) await writeFile(entry, after, 'utf8');
  console.log('Plugin browser adapter built.');
}
