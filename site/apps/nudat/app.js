const $ = id => document.getElementById(id);
const pageSize = 50;
let worker, ready = false, busy = false, generation = 0, sequence = 0;
let entries = [], visible = [], page = 0, folder = '', archiveName = '', currentFile = null, activeEntry = null;
let selected = new Set(), previewVersion = 0;
const pending = new Map();
const countLabel = (count, noun) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
const status = (text, error = false) => {
  $('status').textContent = text;
  $('status').dataset.error = String(error);
};
function startWorker(onReady) {
  ready = false;
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      ready = true;
      controls();
      if (onReady) onReady(); else status('Ready to explore. Choose an archive or try the example.');
    } else if (data.type === 'progress') status(data.text);
    else {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data);
    }
  };
  worker.onerror = event => {
    ready = false;
    for (const request of pending.values()) request.reject(new Error(event.message || 'NuDat could not start. Reload this page to try again.'));
    pending.clear();
    status('NuDat could not start. Reload this page to try again.', true);
    controls();
  };
}
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
function controls() {
  for (const id of ['archive-file', 'choose-archive', 'open-demo', 'change-archive', 'verify', 'download-all', 'download-selected', 'download-file']) $(id).disabled = busy || !ready;
  $('download-all').disabled ||= !scopeEntries().length;
  $('download-selected').disabled ||= !selected.size;
  $('download-file').disabled ||= !activeEntry;
  $('cancel-operation').hidden = !busy;
  $('archive-panel').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('[data-file-action]').forEach(button => { button.disabled = busy || !ready; });
  $('drop-zone').classList.toggle('is-busy', busy || !ready);
}
async function operation(text, action) {
  if (busy || !ready) return;
  const token = generation;
  busy = true;
  controls();
  status(text);
  try { await action(); } catch (error) { if (token === generation) status(error.message, true); }
  finally { if (token === generation) { busy = false; controls(); } }
}
function scopeEntries() {
  const query = $('filter').value.trim().toLowerCase();
  return entries.filter(entry => query ? entry.path.toLowerCase().includes(query) : entry.path.startsWith(folder));
}
function makeButton(text, className, action) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = text; button.className = className; button.onclick = action;
  return button;
}
function navigate(path) {
  folder = path; page = 0; $('filter').value = '';
  activeEntry = null; previewVersion++;
  $('detail-empty').hidden = false; $('detail-content').hidden = true;
  render();
  document.querySelector('.file-list-scroll').scrollTop = 0;
  $('breadcrumbs').lastElementChild.focus();
}
function render() {
  const focusedPath = document.activeElement?.dataset.fileAction;
  const query = $('filter').value.trim();
  const scoped = scopeEntries();
  const directories = new Map();
  const files = [];
  for (const entry of scoped) {
    const name = query ? entry.path : entry.path.slice(folder.length);
    const slash = name.indexOf('/');
    if (!query && slash >= 0) {
      const path = folder + name.slice(0, slash + 1);
      const directory = directories.get(path) || { path, name: name.slice(0, slash), directory: true, count: 0, size: 0 };
      directory.count++; directory.size += entry.size; directories.set(path, directory);
    } else files.push({ ...entry, name: name.split('/').at(-1) });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  files.sort($('sort').value === 'size' ? (a, b) => b.size - a.size || byName(a, b) : byName);
  const items = [...directories.values()].sort(byName).concat(files);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  page = Math.min(page, pages - 1);
  visible = items.slice(page * pageSize, (page + 1) * pageSize);
  const crumbs = [makeButton('All files', 'breadcrumb', () => navigate(''))];
  if (query) { const label = document.createElement('span'); label.textContent = 'Search results'; crumbs.push(label); }
  else {
    let path = '';
    for (const part of folder.split('/').filter(Boolean)) {
      path += part + '/'; const target = path;
      crumbs.push(makeButton(part, 'breadcrumb', () => navigate(target)));
    }
  }
  $('breadcrumbs').replaceChildren(...crumbs);
  const rows = document.createDocumentFragment();
  for (const entry of visible) {
    const row = document.createElement('tr');
    row.classList.toggle('is-active', entry.path === activeEntry?.path);
    const selectCell = document.createElement('td'); selectCell.className = 'select-cell';
    if (!entry.directory) {
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(entry.path);
      checkbox.setAttribute('aria-label', `Select ${entry.path}`);
      checkbox.onchange = () => { checkbox.checked ? selected.add(entry.path) : selected.delete(entry.path); updateSelection(); };
      selectCell.append(checkbox);
    }
    const nameCell = document.createElement('td');
    const button = makeButton('', 'file-name', () => entry.directory ? navigate(entry.path) : inspect(entry));
    if (!entry.directory) { button.dataset.fileAction = entry.path; button.setAttribute('aria-pressed', String(entry.path === activeEntry?.path)); }
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'entry-icon' + (entry.directory ? ' folder-icon' : ''));
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', entry.directory ? 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z' : 'M14 3H5v18h14V8L14 3Zm0 0v5h5M8 12h8M8 16h6');
    icon.append(shape);
    const label = document.createElement('span'); label.textContent = entry.name; label.title = entry.path;
    button.append(icon, label); nameCell.append(button);
    if (query && entry.path.includes('/')) { const path = document.createElement('small'); path.textContent = entry.path; path.className = 'file-parent'; nameCell.append(path); }
    const sizeCell = document.createElement('td'); sizeCell.textContent = entry.directory ? countLabel(entry.count, 'file') : size(entry.size);
    const typeCell = document.createElement('td'); typeCell.textContent = entry.directory ? 'Folder' : (entry.name.includes('.') ? entry.name.split('.').at(-1).toUpperCase() : 'File');
    row.append(selectCell, nameCell, sizeCell, typeCell); rows.append(row);
  }
  $('entries').replaceChildren(rows);
  if (focusedPath) [...$('entries').querySelectorAll('[data-file-action]')].find(button => button.dataset.fileAction === focusedPath)?.focus({ preventScroll: true });
  $('no-results').hidden = items.length > 0;
  $('results').textContent = query ? countLabel(scoped.length, 'result') : `${countLabel(directories.size, 'folder')} · ${countLabel(files.length, 'file')}`;
  $('page-info').textContent = `${page + 1} / ${pages}`;
  $('previous').disabled = page === 0; $('next').disabled = page + 1 >= pages;
  $('download-all').textContent = query ? 'Download results' : folder ? 'Download folder' : 'Download all';
  updateSelection(); controls();
}
function updateSelection() {
  const files = visible.filter(entry => !entry.directory);
  const count = files.filter(entry => selected.has(entry.path)).length;
  $('select-all').checked = files.length > 0 && count === files.length;
  $('select-all').indeterminate = count > 0 && count < files.length;
  $('select-all').disabled = !files.length;
  $('selection-bar').hidden = !selected.size;
  $('selection-count').textContent = `${countLabel(selected.size, 'file')} selected`;
  controls();
}
async function inspect(entry) {
  if (busy) return;
  activeEntry = entry;
  const version = ++previewVersion;
  $('detail-empty').hidden = true; $('detail-content').hidden = false;
  $('detail-name').textContent = entry.name;
  $('detail-path').textContent = entry.path;
  $('detail-size').textContent = size(entry.size);
  $('detail-stored').textContent = size(entry.stored_size);
  $('detail-compression').textContent = entry.compression;
  $('inline-preview').hidden = true; $('expand-preview').hidden = true;
  $('preview-note').textContent = 'Download this file to open it in its application.';
  render();
  if (matchMedia('(max-width: 799px)').matches) $('file-details').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  if (!/\.(txt|scp|csv|xml|json|ini|cfg|lua|h|c|cpp|log|md|yaml|yml)$/i.test(entry.path)) return;
  if (entry.size > 1024 * 1024) { $('preview-note').textContent = 'This file is larger than the 1 MiB preview limit. Download it to read the full contents.'; return; }
  $('preview-note').textContent = 'Reading preview…';
  try {
    const { bytes } = await request('read', { path: entry.path });
    if (version !== previewVersion) return;
    $('inline-preview').textContent = new TextDecoder().decode(bytes);
    $('inline-preview').hidden = false; $('expand-preview').hidden = false;
    $('preview-note').textContent = entry.size ? 'Text preview' : 'This file is empty.';
  } catch (error) { if (version === previewVersion) $('preview-note').textContent = error.message; }
}
async function openArchive(file) {
  if (!file) return;
  await operation(`Opening ${file.name}…`, async () => {
    const result = await request('open', { file });
    ++previewVersion;
    entries = result.entries; currentFile = file; archiveName = file.name;
    folder = ''; page = 0; selected.clear(); activeEntry = null;
    $('filter').value = '';
    $('archive-title').textContent = file.name;
    $('archive-info').textContent = `${countLabel(entries.length, 'file')} · ${size(file.size)} · ${result.version === -3 ? 'PC archive' : result.version === -2 ? 'Legacy PC archive' : result.version === -5 ? 'Android archive' : `Format ${result.version}`}`;
    $('archive-panel').hidden = false; $('drop-zone').hidden = true;
    $('detail-empty').hidden = false; $('detail-content').hidden = true;
    render(); status('Archive opened. Browse a folder or select a file to inspect it.');
  });
  $('archive-file').value = '';
}
function downloadPaths(paths) {
  operation(`Preparing ${paths.length.toLocaleString()} files…`, async () => {
    const { blob } = await request('zip', { paths });
    save(blob, `${archiveName.replace(/\.(dat|obb)$/i, '')}.zip`);
    status(`Prepared ${countLabel(paths.length, 'file')} for ZIP download.`);
  });
}
$('archive-file').onchange = () => openArchive($('archive-file').files[0]);
for (const id of ['choose-archive', 'change-archive']) $(id).onclick = () => $('archive-file').click();
$('open-demo').onclick = async () => {
  try {
    const response = await fetch('./example.dat');
    if (!response.ok) throw new Error('The example archive is unavailable. Choose a local archive to continue.');
    await openArchive(new File([await response.blob()], 'example.dat'));
  } catch (error) { status(error.message, true); }
};
for (const target of [$('drop-zone'), $('archive-panel')]) {
  target.ondragover = event => { event.preventDefault(); if (ready && !busy) target.classList.add('is-dragging'); };
  target.ondragleave = event => { if (!target.contains(event.relatedTarget)) target.classList.remove('is-dragging'); };
  target.ondrop = event => { event.preventDefault(); target.classList.remove('is-dragging'); if (ready && !busy) openArchive(event.dataTransfer.files[0]); };
}
$('filter').oninput = () => { page = 0; render(); };
$('sort').onchange = () => { page = 0; render(); };
$('clear-search').onclick = () => { $('filter').value = ''; render(); $('filter').focus(); };
$('previous').onclick = () => { page--; render(); $('entries').closest('.file-list-scroll').scrollTop = 0; };
$('next').onclick = () => { page++; render(); $('entries').closest('.file-list-scroll').scrollTop = 0; };
$('select-all').onchange = () => { for (const entry of visible.filter(entry => !entry.directory)) $('select-all').checked ? selected.add(entry.path) : selected.delete(entry.path); render(); };
$('clear-selection').onclick = () => { selected.clear(); render(); };
$('download-selected').onclick = () => downloadPaths([...selected]);
$('download-all').onclick = () => downloadPaths(scopeEntries().map(entry => entry.path));
$('download-file').onclick = () => {
  const entry = activeEntry;
  operation(`Extracting ${entry.path}…`, async () => {
    const { bytes } = await request('read', { path: entry.path });
    save(new Blob([bytes]), entry.name); status(`Downloaded ${entry.name}.`);
  });
};
$('verify').onclick = () => operation('Checking archive contents…', async () => { await request('verify'); status(`All ${entries.length.toLocaleString()} files verified successfully.`); });
$('expand-preview').onclick = () => { $('preview-title').textContent = activeEntry.path; $('preview-text').textContent = $('inline-preview').textContent; $('preview-dialog').showModal(); };
$('cancel-operation').onclick = () => {
  generation++; previewVersion++; worker.terminate();
  for (const request of pending.values()) request.reject(new Error('Operation cancelled.'));
  pending.clear(); busy = false;
  const file = currentFile;
  startWorker(async () => { if (file) await openArchive(file); status('Operation cancelled. Your archive is ready.'); });
  controls(); status('Cancelling operation…');
};
startWorker();
