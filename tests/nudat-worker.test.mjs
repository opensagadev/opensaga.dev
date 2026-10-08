import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { Zip, ZipPassThrough, unzipSync } from 'fflate';
import { initSync, WebArchive } from '../dist/nudat/pkg/nudat_web.js';

initSync({ module: readFileSync(new URL('../dist/nudat/pkg/nudat_web_bg.wasm', import.meta.url)) });
const example = readFileSync(new URL('../site/apps/nudat/example.dat', import.meta.url));
const source = readFileSync(new URL('../site/apps/nudat/worker.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('await init();', '');
function harness() {
  let messages = [];
  const self = { postMessage: message => messages.push(message) };
  const file = bytes => ({ size: bytes.length, slice: (start, end) => Uint8Array.from(bytes.subarray(start, end)).buffer });
  vm.runInNewContext(source, {
    self, WebArchive, Zip, ZipPassThrough, Blob, Uint8Array,
    FileReaderSync: class { readAsArrayBuffer(buffer) { return buffer; } },
  });
  return (command, options = {}) => {
    messages = [];
    self.onmessage({ data: { id: 1, command, ...options, ...(options.bytes ? { file: file(options.bytes) } : {}) } });
    return messages.find(message => message.id === 1);
  };
}
test('opens and previews an archive, preserving it after an invalid replacement', () => {
  const send = harness();
  const opened = send('open', { bytes: example });
  assert.equal(opened.entries.length, 73);
  assert.equal(opened.version, -3);
  assert.match(send('open', { bytes: Buffer.from('invalid') }).error, /DAT|archive|fill|short/i);
  const preview = send('read', { path: 'levels/demo/scene.json' });
  assert.equal(JSON.parse(new TextDecoder().decode(preview.bytes)).name, 'Demo scene');
  assert.equal(send('verify').error, undefined);
});
test('ZIP export preserves selected paths and decoded contents, including empty files', async () => {
  const send = harness();
  send('open', { bytes: example });
  const paths = ['data/empty.txt', 'data/sample.bin', 'levels/demo/scene.json'];
  const result = send('zip', { paths });
  assert.equal(result.error, undefined);
  const unzipped = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(unzipped), paths);
  assert.equal(unzipped['data/empty.txt'].length, 0);
  assert.deepEqual(unzipped['data/sample.bin'], Uint8Array.from({ length: 256 }, (_, index) => index));
  assert.equal(JSON.parse(new TextDecoder().decode(unzipped['levels/demo/scene.json'])).objects.length, 2);
});

test('reads image and audio previews as intact binary files', () => {
  const send = harness();
  send('open', { bytes: example });
  const png = Buffer.from(send('read', { path: 'media/palette.png' }).bytes);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 180);
  const wav = Buffer.from(send('read', { path: 'media/tone.wav' }).bytes);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt32LE(40), 66150 * 2);
});
