// Loads the Design System bundle.js (artifact working copy in ds/) in a VM with a stub React,
// then checks the STT additions: the partial TranscriptLine, TranscriptBadge and the injected client.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dsDir = path.resolve(__dirname, '..', process.env.EMS_DS_DIR || '../ds');
const src = fs.readFileSync(path.join(dsDir, 'project/components/bundle.js'), 'utf8');

function load() {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Children: { toArray: c => [].concat(c || []), map: (c, fn) => [].concat(c || []).map(fn) },
    /* Just enough for a component rendered once: state is its initial value, refs are plain objects, effects never run. */
    useState: v => [typeof v === 'function' ? v() : v, () => {}],
    useRef: v => ({ current: v === undefined ? null : v }),
    useEffect: () => {}
  };
  const window = { React };
  window.window = window;
  vm.runInNewContext(src, Object.assign(window, { console, setTimeout, clearTimeout }));
  return window.EMS;
}

const EMS = load();

test('TranscriptLine partial: grey class, plain text, no copy button', () => {
  const el = EMS.TranscriptLine({ time: '14:20:02', speaker: 'Caller', text: 'Motorcycle hit', partial: true, keywords: ['CPR'] });
  assert.match(el.props.className, /\bems-tline-partial\b/);
  assert.equal(el.props['aria-busy'], true);
  assert.equal(el.children[2].type, 'span');
  const p = el.children[1].children[1];
  assert.deepEqual(p.children, ['Motorcycle hit']);
});

test('TranscriptLine final keeps highlight and copy button', () => {
  const el = EMS.TranscriptLine({ time: '14:20:15', speaker: 'Caller', text: 'starting CPR now', keywords: ['CPR'] });
  assert.doesNotMatch(el.props.className, /ems-tline-partial/);
  assert.notEqual(el.children[2].type, 'span');
});

test('TranscriptBadge reads Live or Replay', () => {
  const live = EMS.TranscriptBadge({ mode: 'live' });
  assert.equal(live.type, EMS.StatusPill);
  assert.equal(live.props.tone, 'live');
  assert.deepEqual(live.children, ['Live']);
  const replay = EMS.TranscriptBadge({ mode: 'replay' });
  assert.equal(replay.props.tone, 'neutral');
  assert.deepEqual(replay.children, ['Replay']);
});

test('TranscriptBadge shows Connecting… while the live path starts', () => {
  const b = EMS.TranscriptBadge({ mode: 'connecting' });
  assert.equal(b.type, EMS.StatusPill);
  assert.equal(b.props.tone, 'info');
  assert.equal(b.props.loading, true);
  assert.deepEqual(b.children, ['Connecting…']);
});

test('Intake passes the speakers from the URL (?mics=1 one-mic test mode)', () => {
  assert.match(src, /speakers: E\.sttSpeakers\(location\)/);
});

test('Intake follows new transcript lines', () => {
  assert.match(src, /E\.isNearBottom\(/);
});

test('the STT client is injected into the bundle', () => {
  for (const name of ['createTranscriptSource', 'suggestChips', 'chipsFor', 'upsertLine', 'sttMode', 'relayUrlFor', 'listMics', 'openMic', 'toPcm16k']) {
    assert.equal(typeof EMS[name], 'function', name);
  }
  assert.match(EMS.STT_WORKLET_SRC, /registerProcessor\('retina-pcm'/);
});

test('Intake no longer carries a static suggestion list', () => {
  assert.doesNotMatch(src, /TYPE_SUGGEST/);
  assert.match(src, /E\.chipsFor\(/);
});

test('Intake reads the mic names from the URL (?op= / ?caller=) as well as window.RETINA_STT', () => {
  assert.match(src, /micLabels: E\.sttMicLabels\(location, window\.RETINA_STT\)/);
  assert.equal(typeof EMS.sttMicLabels, 'function');
});

/* Walk a stub element tree (children may be strings, nulls or nested arrays). */
function walk(el, fn) {
  if (Array.isArray(el)) { el.forEach(c => walk(c, fn)); return; }
  if (!el || typeof el !== 'object') return;
  fn(el);
  walk(el.children, fn);
}
function find(el, pred) { let hit = null; walk(el, n => { if (!hit && pred(n)) hit = n; }); return hit; }
function text(el) { const out = []; (function t(x) { if (Array.isArray(x)) x.forEach(t); else if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') t(x.children); })(el); return out.join(' '); }
const cls = c => n => typeof n.props.className === 'string' && n.props.className.split(' ').includes(c);
const input = el => find(el, n => n.type === 'input' || n.type === 'textarea');
function suggestion(extra = {}) {
  const calls = { use: 0, dismiss: 0 };
  return { calls, s: Object.assign({ value: 'Somchai Jaidee', heardAt: '14:20:37', updated: false, onUse: () => calls.use++, onDismiss: () => calls.dismiss++ }, extra) };
}

test('Field shows a dashed suggestion with heard time, Use and dismiss', () => {
  const { calls, s } = suggestion();
  const el = EMS.Field({ label: 'Caller Name', value: '', suggestion: s });
  const box = find(el, cls('ems-field-suggest'));
  assert.ok(box, 'suggestion box');
  assert.equal(box.props.role, 'status');
  assert.match(text(box), /Somchai Jaidee/);
  assert.match(text(box), /heard 14:20:37/);
  const use = find(box, n => n.type === 'button' && /\bUse\b/.test(text(n)));
  const x = find(box, n => n.type === 'button' && n.props['aria-label'] === 'Dismiss suggestion');
  assert.ok(use && x);
  use.props.onClick(); x.props.onClick();
  assert.deepEqual(calls, { use: 1, dismiss: 1 });
});

test('Updated suggestions say so', () => {
  const el = EMS.Field({ label: 'Contact Number', value: '081-234-5678', suggestion: suggestion({ value: '081-234-9999', updated: true }).s });
  assert.match(text(find(el, cls('ems-field-suggest'))), /Updated · heard 14:20:37/);
});

test('no suggestion, or a locked field, shows no box', () => {
  assert.equal(find(EMS.Field({ label: 'Caller Name', value: '' }), cls('ems-field-suggest')), null);
  assert.equal(find(EMS.Field({ label: 'Address', value: '', locked: true, suggestion: suggestion().s }), cls('ems-field-suggest')), null);
});

test('a suggestion never changes the input value (Review Focus 3)', () => {
  const el = EMS.Field({ label: 'Caller Name', value: 'Som', suggestion: suggestion().s });
  assert.equal(input(el).props.value, 'Som');
});

test('Tab in an empty field takes the suggestion', () => {
  const { calls, s } = suggestion();
  let prevented = 0;
  input(EMS.Field({ label: 'Caller Name', value: '', suggestion: s })).props.onKeyDown({ key: 'Tab', preventDefault: () => prevented++ });
  assert.deepEqual([calls.use, prevented], [1, 1]);
  input(EMS.Field({ label: 'Caller Name', value: 'x', suggestion: s })).props.onKeyDown({ key: 'Tab', preventDefault: () => prevented++ });
  input(EMS.Field({ label: 'Caller Name', value: '', suggestion: s })).props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault: () => prevented++ });
  assert.deepEqual([calls.use, prevented], [1, 1], 'a filled field, or Shift+Tab, keeps normal Tab');
});

test('replay script ends with the four new lines', () => {
  assert.ok(src.includes("['14:20:33', 'Operator', 'Can I have your name and a number to call you back?']"));
  assert.ok(src.includes("['14:20:37', 'Caller', 'Somchai Jaidee. My number is 081 234 5678.']"));
  assert.ok(src.includes("['14:20:42', 'Operator', 'Does he have any medical conditions you know of?']"));
  assert.ok(src.includes(`['14:20:45', 'Caller', "I don't know him, I have no idea."]`));
});

test('Intake wires suggestions', () => {
  assert.match(src, /E\.createSuggestSource\(/);
  assert.match(src, /E\.suggestUrlFor\(location\)/);
  assert.match(src, /Suggestions off/);
  assert.equal(typeof EMS.createSuggestSource, 'function');
  assert.equal(typeof EMS.suggestionStep, 'function');
});

test('no masked number is left', () => {
  assert.equal(src.includes('081-xxx-xxxx'), false);
  assert.equal(EMS.CASE.contact, '081-234-5678');
  assert.equal(EMS.CASE.caller, 'Somchai Jaidee');
});
