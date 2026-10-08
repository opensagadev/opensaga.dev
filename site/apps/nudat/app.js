const element = id => document.getElementById(id);
const status = (text, error = false) => {
  element('status').textContent = text;
  element('status').dataset.error = String(error);
};
const pending = new Map();
let sequence = 0;
let entries = [];
let filtered = [];
let page = 0;
let archiveName = '';
let busy = false;
const pageSize = 100;
const worker = new Worker('./worker.js', { type: 'module' });

worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    element('archive-file').disabled = false;
    status('Ready. Choose a DAT or OBB archive.');
  } else if (data.type === 'progress') {
    status(data.text);
  } else {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve(data);
  }
};
worker.onerror = event => {
  const error = new Error(event.message || 'NuDat could not load. Build the WASM application and reload.');
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  element('archive-file').disabled = true;
  status(error.message, true);
};
function request(command, options = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, ...options });
  });
}
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const exponent = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][exponent]}`;
}
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function operation(text, action) {
  if (busy) return;
  busy = true;
  element('archive-file').disabled = true;
  element('filter').disabled = true;
  render();
  status(text);
  try { await action(); } catch (error) { status(error.message, true); }
  finally {
    busy = false;
    element('archive-file').disabled = false;
    element('filter').disabled = false;
    render();
  }
}
function render() {
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, pages - 1);
  element('results').textContent = `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()} files`;
  element('page-info').textContent = `Page ${page + 1} of ${pages}`;
  element('previous').disabled = busy || page === 0;
  element('next').disabled = busy || page + 1 >= pages;
  element('verify').disabled = busy;
  element('download-all').disabled = busy || !filtered.length;
  const rows = document.createDocumentFragment();
  for (const entry of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = document.createElement('tr');
    for (const text of [entry.path, size(entry.size), entry.compression]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    const actions = document.createElement('td');
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'Download';
    download.disabled = busy;
    download.onclick = () => operation(`Extracting ${entry.path}…`, async () => {
      const { bytes } = await request('read', { path: entry.path });
      save(new Blob([bytes]), entry.path.split('/').at(-1));
      status(`Extracted ${entry.path}.`);
    });
    actions.append(download);
    if (/\.(txt|scp|csv|xml|json|ini|cfg|lua|h|c|cpp|log)$/i.test(entry.path) && entry.size <= 1024 * 1024) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.textContent = 'Preview';
      preview.disabled = busy;
      preview.onclick = () => operation(`Reading ${entry.path}…`, async () => {
        const { bytes } = await request('read', { path: entry.path });
        element('preview-title').textContent = entry.path;
        element('preview-text').textContent = new TextDecoder().decode(bytes);
        element('preview-dialog').showModal();
        status(`Previewing ${entry.path}.`);
      });
      actions.append(preview);
    }
    row.append(actions);
    rows.append(row);
  }
  element('entries').replaceChildren(rows);
}
element('archive-file').onchange = () => {
  const file = element('archive-file').files[0];
  if (!file) return;
  operation(`Opening ${file.name}…`, async () => {
    element('archive-panel').hidden = true;
    const result = await request('open', { file });
    entries = result.entries.sort((a, b) => a.path.localeCompare(b.path));
    archiveName = file.name;
    filtered = entries;
    page = 0;
    element('filter').value = '';
    element('archive-info').textContent = `${file.name} · ${size(file.size)} · index version ${result.version} · ${entries.length.toLocaleString()} files`;
    element('archive-panel').hidden = false;
    status('Archive opened. Choose a file to preview or download.');
  });
};
element('filter').oninput = () => {
  const query = element('filter').value.toLowerCase();
  filtered = entries.filter(entry => entry.path.toLowerCase().includes(query));
  page = 0;
  render();
};
element('previous').onclick = () => { page--; render(); };
element('next').onclick = () => { page++; render(); };
element('verify').onclick = () => operation('Verifying every archive entry…', async () => {
  await request('verify');
  status(`Verified ${entries.length.toLocaleString()} files.`);
});
element('download-all').onclick = () => operation('Extracting files…', async () => {
  const paths = filtered.map(entry => entry.path);
  const { blob } = await request('zip', { paths });
  save(blob, `${archiveName.replace(/\.(dat|obb)$/i, '')}.zip`);
  status(`Extracted ${paths.length.toLocaleString()} files.`);
});
