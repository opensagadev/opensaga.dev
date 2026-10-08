import init, { WebSave } from './pkg/nusave_web.js';
await init();
let save = null;
self.onmessage = ({ data: { id, command, ...options } }) => {
  try {
    let result = {};
    if (command === 'open' || command === 'create') {
      let next;
      if (command === 'open') {
        if (options.file.size > 16 * 1024 * 1024) throw new Error('Save files must be 16 MiB or smaller.');
        next = new WebSave(new Uint8Array(new FileReaderSync().readAsArrayBuffer(options.file)));
      } else next = WebSave.create(options.options);
      result.snapshot = next.snapshot();
      save?.free();
      save = next;
    } else {
      if (!save) throw new Error('Open or create a save first.');
      if (command === 'apply') { save.edit(options.values, options.keepDerived); result.snapshot = save.snapshot(); }
      else if (command === 'reset') { save.reset(); result.snapshot = save.snapshot(); }
      else if (command === 'catalog') result.fields = save.catalog();
      else if (command === 'fields') result = save.fields(options.query || '', options.group || '', Boolean(options.advanced), options.offset || 0);
      else if (command === 'download') result.bytes = save.bytes(options.keepDerived);
      else throw new Error('Unknown save operation.');
    }
    self.postMessage({ id, ...result });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
self.postMessage({ type: 'ready' });
