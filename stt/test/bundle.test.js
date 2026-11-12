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
  const noHooks = () => { throw new Error('hooks are not available in this test'); };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Children: { toArray: c => [].concat(c || []), map: (c, fn) => [].concat(c || []).map(fn) },
    useState: noHooks, useEffect: noHooks, useRef: noHooks
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
