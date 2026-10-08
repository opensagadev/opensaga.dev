import init, { WebArchive } from './pkg/nudat_web.js';
import { Zip, ZipPassThrough } from '../assets/fflate.js';

await init();
let archive;
self.postMessage({ type: 'ready' });
self.onmessage = ({ data }) => {
  const { id, command } = data;
  try {
    if (command === 'open') {
      const file = data.file;
      const reader = new FileReaderSync();
      const next = new WebArchive(file.size, (offset, length) =>
        new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))));
      const entries = next.entries();
      archive?.free();
      archive = next;
      self.postMessage({ id, entries, version: archive.version() });
    } else if (command === 'read') {
      const bytes = archive.read(data.path);
      self.postMessage({ id, bytes }, [bytes.buffer]);
    } else if (command === 'verify') {
      archive.verify();
      self.postMessage({ id });
    } else if (command === 'zip') {
      const chunks = [];
      const zip = new Zip((error, chunk) => {
        if (error) throw error;
        chunks.push(chunk);
      });
      for (let index = 0; index < data.paths.length; index++) {
        const path = data.paths[index];
        const entry = new ZipPassThrough(path);
        zip.add(entry);
        entry.push(archive.read(path), true);
        self.postMessage({ type: 'progress', text: `Extracted ${index + 1} of ${data.paths.length} files` });
      }
      zip.end();
      self.postMessage({ id, blob: new Blob(chunks, { type: 'application/zip' }) });
    } else {
      throw new Error(`Unknown operation: ${command}`);
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
