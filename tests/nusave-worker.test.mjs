import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { initSync, WebSave } from '../dist/nusave/pkg/nusave_web.js';
initSync({ module: readFileSync(new URL('../dist/nusave/pkg/nusave_web_bg.wasm', import.meta.url)) });
const source = readFileSync(new URL('../site/apps/nusave/worker.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('await init();', '');
function harness() {
  let messages = [];
  const self = { postMessage: message => messages.push(message) };
  vm.runInNewContext(source, { self, WebSave, Uint8Array, FileReaderSync: class { readAsArrayBuffer(file) { return file.bytes; } } });
  return (command, options = {}) => {
    messages = [];
    self.onmessage({ data: { id: 1, command, ...options, ...(options.bytes ? { file: { size: options.bytes.length, bytes: options.bytes } } : {}) } });
    const result = messages.find(message => message.id === 1);
    assert.ok(result, 'worker replied');
    return result;
  };
}
function field(save, name) { return save.fields(name, '', true, 0).fields.find(field => field.name === name); }

test('creates, edits, downloads, and reopens Android progress and options', () => {
  for (const options of [false, true]) {
    const send = harness();
    const created = send('create', { options });
    assert.equal(created.snapshot.checksum_valid, true);
    const values = options ? [{ name: 'options.music_enabled', value: '1' }] : [{ name: 'coins', value: '125000' }, { name: 'gold_bricks', value: '160' }];
    const edited = send('apply', { values, keepDerived: false });
    assert.equal(edited.error, undefined);
    assert.equal(edited.snapshot.checksum_valid, true);
    assert.equal(edited.snapshot.modified, true);
    const downloaded = send('download', { keepDerived: false });
    const reopened = new WebSave(downloaded.bytes);
    assert.equal(field(reopened, options ? 'options.music_enabled' : 'coins').editor.value, options ? '1' : '125000');
    assert.equal(reopened.snapshot().checksum_valid, true);
    reopened.free();
  }
});

test('invalid batches, replacements, and oversized inputs preserve the open save', () => {
  const send = harness();
  send('create', { options: false });
  send('apply', { values: [{ name: 'coins', value: '25' }], keepDerived: false });
  const original = send('download', { keepDerived: true }).bytes;
  assert.match(send('apply', { values: [{ name: 'coins', value: '42' }, { name: 'gold_bricks', value: '999999' }], keepDerived: false }).error, /gold_bricks/);
  assert.deepEqual(send('download', { keepDerived: true }).bytes, original);
  assert.ok(send('open', { bytes: new Uint8Array([1, 2]) }).error);
  assert.ok(send('open', { file: { size: 16 * 1024 * 1024 + 1 } }).error);
  assert.deepEqual(send('download', { keepDerived: true }).bytes, original);
});

test('preserves PC layout, metadata, and slot code when editing shared fields', () => {
  const android = WebSave.create(false);
  const input = android.bytes(true); android.free();
  const insertion = 0x2028 + 0x7c20;
  const bytes = new Uint8Array(input.length - 12);
  bytes.set(input.slice(0, insertion)); bytes.set(input.slice(insertion + 12), insertion);
  bytes[0x1028] = 0xa7;
  new DataView(bytes.buffer).setUint32(bytes.length - 4, 0x12345678, true);
  const pc = new WebSave(bytes);
  assert.match(pc.snapshot().kind, /Windows PC/);
  assert.equal(field(pc, 'coins'), undefined);
  pc.edit([{name:'difficulty',value:'5'}], false);
  const output = pc.bytes(false);
  assert.equal(output.length, bytes.length);
  assert.equal(output[0x1028], 0xa7);
  assert.equal(new DataView(output.buffer).getUint32(output.length - 4, true), 0x12345678);
  assert.equal(pc.snapshot().checksum_valid, true);
  pc.free();
});

test('unmodified export preserves unknown bytes and noncanonical floats exactly', () => {
  const original = WebSave.create(false);
  const offset = field(original, 'gameplay_seconds').offset;
  const bytes = original.bytes(true); original.free();
  bytes[4136] = 123;
  new DataView(bytes.buffer).setUint32(offset, 0x7f800001, true);
  const opened = new WebSave(bytes);
  assert.deepEqual(opened.bytes(true), bytes);
  assert.equal(field(opened, 'gameplay_seconds').editor.input, 'float');
  opened.free();
});

test('fields are paginated and reset restores the original bytes', () => {
  const save = WebSave.create(false);
  const original = save.bytes(true);
  assert.equal(save.fields('', '', true, 0).fields.length, 50);
  assert.notEqual(save.fields('', '', true, 0).fields[0].name, save.fields('', '', true, 50).fields[0].name);
  assert.equal(save.fields('no-such-property', '', true, 0).total, 0);
  save.edit([{name:'coins',value:'42'}], false);
  assert.equal(field(save, 'coins').editor.value, '42');
  save.reset(); assert.deepEqual(save.bytes(true), original);
  save.free();
});

test('typed controls provide enum choices, limits, flags, text, and raw-field visibility', () => {
  const save = WebSave.create(true);
  assert.equal(field(save, 'options.music_enabled').editor.input, 'toggle');
  assert.equal(field(save, 'options.touch_controls').editor.input, 'select');
  const packs = field(save, 'options.store_pack_flags');
  assert.equal(packs.editor.input, 'flags');
  assert.ok(packs.editor.choices.some(choice => choice.value === 'EPISODE_II'));
  assert.equal(save.fields('header', '', false, 0).total, 0);
  assert.ok(save.fields('header', '', true, 0).total > 0);
  save.edit([{name:'options.store_pack_flags',value:'EPISODE_II|32768'}], false);
  assert.match(field(save, 'options.store_pack_flags').editor.value, /32768/);
  save.free();
  const game = WebSave.create(false);
  assert.equal(field(game, 'coins').editor.max, 4294967295);
  assert.equal(field(game, 'customizer.primary_name').editor.input, 'text');
  game.free();
});
