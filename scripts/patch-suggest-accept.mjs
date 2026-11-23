import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENT_NAME = 'dsh:suggest-prompt:accept';
const marker = '// AU05 session-targeted suggestion acceptance bridge v1';
const start = '\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (text === void 0) return;';
const end = '\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tstyleUsers += 1;';
const replacement = `\t\t\t${marker}
			const acceptance = (0, react.useRef)({ sessionId, text, accepted: false });
			if (acceptance.current.sessionId !== sessionId || acceptance.current.text !== text) {
				acceptance.current = { sessionId, text, accepted: false };
			}
			const composing = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				composing.current = false;
				const onCompositionStart = () => { if (isComposerFocused()) composing.current = true; };
				const onCompositionEnd = () => { composing.current = false; };
				window.addEventListener("compositionstart", onCompositionStart);
				window.addEventListener("compositionend", onCompositionEnd);
				return () => {
					composing.current = false;
					window.removeEventListener("compositionstart", onCompositionStart);
					window.removeEventListener("compositionend", onCompositionEnd);
				};
			}, [sessionId]);
			(0, react.useEffect)(() => {
				if (text === void 0) return;
				const accept = () => {
					if (composing.current || acceptance.current.accepted) return;
					acceptance.current.accepted = true;
					inputActions.setDraft(text);
				};
				const onAccept = (event) => {
					if (!event.cancelable || event.detail?.sessionId !== sessionId) return;
					// Claim synchronously, even during IME/stale render or a failed setDraft.
					// The caller must never fall through to submit while a ghost is visible.
					event.preventDefault();
					accept();
				};
				const onKeyDown = (event) => {
					if (event.isComposing || composing.current) return;
					if (!acceptMatcher(event)) return;
					if (!isComposerFocused()) return;
					event.preventDefault();
					accept();
				};
				window.addEventListener("keydown", onKeyDown);
				window.addEventListener("${EVENT_NAME}", onAccept);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("${EVENT_NAME}", onAccept);
				};
			}, [text, acceptMatcher, inputActions, sessionId]);
`;

export function patchSource(source) {
  if (source.includes(marker)) return source;
  const component = source.indexOf('function GhostSuggestion(');
  const from = source.indexOf(start, component);
  const to = source.indexOf(end, from);
  if (component < 0 || from < 0 || to < 0) throw new Error('Unsupported suggestion bundle: GhostSuggestion acceptance anchors missing');
  return source.slice(0, from) + replacement + source.slice(to);
}

export function patchFile(target) {
  const source = fs.readFileSync(target, 'utf8');
  const patched = patchSource(source);
  if (patched === source) return { target, changed: false };
  const backup = `${target}.au05-accept-original.bak`;
  // Never overwrite a previous original backup.
  if (!fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(target, patched, 'utf8');
  return { target, backup, changed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'profiles', 'desktop', 'node_modules', '@studyzy', 'dsh-suggest-prompt', 'lib', 'client.js');
  console.log(JSON.stringify(patchFile(target)));
}
