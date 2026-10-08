const $ = id => document.getElementById(id);
const pageSize = 50;
let worker, ready = false, busy = false, generation = 0, sequence = 0;
let entries = [], visible = [], page = 0, folder = '', archiveName = '', currentFile = null, activeEntry = null;
let archiveSummary = '';
let selected = new Set(), previewVersion = 0;
let folderHistory = [''], historyIndex = 0, folderRoot = null;
const expandedFolders = new Set(['']);
let previewURL = null, previewText = '', previewKind = null;
const imageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
const audioTypes = { mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' };
const pending = new Map();
const countLabel = (count, noun) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
const status = (text, error = false) => {
  const target = $('archive-panel').hidden ? $('status') : $('archive-info');
  target.textContent = text || (target.id === 'archive-info' ? archiveSummary : '');
  target.title = target.textContent;
  target.dataset.error = String(error);
};
function startWorker(onReady) {
  ready = false;
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      ready = true;
      controls();
      if (onReady) onReady(); else status('');
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
    for (const request of pending.values()) request.reject(new Error(event.message || 'nudat could not start. Reload this page to try again.'));
    pending.clear();
    status('nudat could not start. Reload this page to try again.', true);
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
  for (const id of ['archive-file', 'choose-archive', 'open-demo', 'change-archive', 'verify', 'download-all', 'download-file']) $(id).disabled = busy || !ready;
  $('download-all').disabled ||= !selected.size && !scopeEntries().length;
  $('clear-selection').disabled = busy || !selected.size;
  $('download-file').disabled ||= !activeEntry;
  $('cancel-operation').hidden = !busy;
  $('cancel-archive-operation').hidden = !busy;
  $('verify').hidden = busy;
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
function buildFolders() {
  folderRoot = { name: archiveName, path: '', children: new Map() };
  for (const entry of entries) {
    let parent = folderRoot;
    for (const part of entry.path.split('/').slice(0, -1)) {
      const path = parent.path + part + '/';
      if (!parent.children.has(part)) parent.children.set(part, { name: part, path, children: new Map() });
      parent = parent.children.get(part);
    }
  }
}
function renderFolders() {
  if (!folderRoot) return;
  const focusedFolder = document.activeElement?.dataset.folderPath;
  function branch(node) {
    const item = document.createElement('li');
    const row = document.createElement('div'); row.className = 'folder-tree-row';
    const expanded = expandedFolders.has(node.path);
    const toggle = makeButton(expanded ? '⌄' : '›', 'folder-disclosure', () => {
      expanded ? expandedFolders.delete(node.path) : expandedFolders.add(node.path);
      renderFolders();
      [...$('folder-tree').querySelectorAll('[data-disclosure]')].find(button => button.dataset.disclosure === node.path)?.focus();
    });
    toggle.dataset.disclosure = node.path;
    toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${node.name}`);
    toggle.setAttribute('aria-expanded', String(expanded));
    if (!node.children.size) { toggle.disabled = true; toggle.classList.add('is-leaf'); }
    const button = makeButton('', 'folder-link', () => navigate(node.path));
    button.dataset.folderPath = node.path; button.title = node.path || archiveName;
    if (node.path === folder && !$('filter').value.trim()) button.setAttribute('aria-current', 'location');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'entry-icon folder-icon'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z'); icon.append(shape);
    const label = document.createElement('span'); label.textContent = node.name;
    button.append(icon, label); row.append(toggle, button); item.append(row);
    if (expanded && node.children.size) {
      const list = document.createElement('ul');
      [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(child => list.append(branch(child)));
      item.append(list);
    }
    return item;
  }
  const list = document.createElement('ul'); list.append(branch(folderRoot));
  $('folder-tree').replaceChildren(list);
  if (focusedFolder !== undefined) [...$('folder-tree').querySelectorAll('[data-folder-path]')].find(button => button.dataset.folderPath === focusedFolder)?.focus({ preventScroll: true });
}
function navigate(path, record = true) {
  if (record && path !== folder) {
    folderHistory.splice(historyIndex + 1);
    folderHistory.push(path); historyIndex++;
  }
  let ancestor = '';
  expandedFolders.add(ancestor);
  for (const part of path.split('/').filter(Boolean)) { ancestor += part + '/'; expandedFolders.add(ancestor); }
  folder = path; page = 0; $('filter').value = '';
  activeEntry = null; previewVersion++; clearPreview();
  $('detail-empty').hidden = false; $('detail-content').hidden = true;
  render();
  document.querySelector('.file-list-scroll').scrollTop = 0;
  $('breadcrumbs').lastElementChild.focus({ preventScroll: true });
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
  const crumbs = [makeButton(archiveName || 'Archive', 'breadcrumb', () => navigate(''))];
  if (query) { const label = document.createElement('span'); label.textContent = 'Search results'; crumbs.push(label); }
  else {
    let path = '';
    for (const part of folder.split('/').filter(Boolean)) {
      path += part + '/'; const target = path;
      crumbs.push(makeButton(part, 'breadcrumb', () => navigate(target)));
    }
  }
  $('breadcrumbs').replaceChildren(...crumbs);
  if (!query) crumbs.at(-1).setAttribute('aria-current', 'location');
  $('folder-back').disabled = historyIndex === 0 && !query;
  $('folder-forward').disabled = historyIndex + 1 >= folderHistory.length;
  $('folder-up').disabled = !folder && !query;
  renderFolders();
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
    if (!entry.directory) sizeCell.title = `Stored size: ${size(entry.stored_size)}`;
    const compressionCell = document.createElement('td'); compressionCell.textContent = entry.directory ? '—' : entry.compression;
    row.append(selectCell, nameCell, sizeCell, compressionCell); rows.append(row);
  }
  $('entries').replaceChildren(rows);
  if (focusedPath) [...$('entries').querySelectorAll('[data-file-action]')].find(button => button.dataset.fileAction === focusedPath)?.focus({ preventScroll: true });
  $('no-results').hidden = items.length > 0;
  $('results').textContent = query ? countLabel(scoped.length, 'result') : `${countLabel(directories.size, 'folder')} · ${countLabel(files.length, 'file')}`;
  $('page-info').textContent = `${page + 1} / ${pages}`;
  $('previous').disabled = page === 0; $('next').disabled = page + 1 >= pages;
  updateSelection(); controls();
}
function updateSelection() {
  const files = visible.filter(entry => !entry.directory);
  const count = files.filter(entry => selected.has(entry.path)).length;
  $('select-all').checked = files.length > 0 && count === files.length;
  $('select-all').indeterminate = count > 0 && count < files.length;
  $('select-all').disabled = !files.length;
  $('selection-count').textContent = selected.size ? `${countLabel(selected.size, 'file')} selected` : '';
  $('results').hidden = selected.size > 0;
  $('download-all').textContent = selected.size ? 'Download selected' : $('filter').value.trim() ? 'Download results' : folder ? 'Download folder' : 'Download all';
  controls();
}
function clearPreview() {
  const audio = $('audio-preview');
  audio.onerror = null; audio.onloadedmetadata = null;
  audio.pause();
  if (audio.hasAttribute('src')) { audio.removeAttribute('src'); audio.load(); }
  const image = $('image-preview');
  image.onload = null; image.onerror = null; image.removeAttribute('src');
  $('expanded-image').removeAttribute('src');
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null; previewText = ''; previewKind = null;
  for (const id of ['inline-preview', 'media-preview', 'image-preview', 'audio-preview', 'expand-preview']) $(id).hidden = true;
  $('inline-preview').replaceChildren(); $('preview-text').replaceChildren();
  if ($('preview-dialog').open) $('preview-dialog').close();
}
function renderTextPreview(target, text) {
  const lines = text.split(/\r\n|\n|\r/);
  const fragment = document.createDocumentFragment();
  // Bound the number of DOM nodes even for pathological newline-only files.
  for (const [index, line] of lines.slice(0, 10000).entries()) {
    const row = document.createElement('span'); row.className = 'code-line';
    const number = document.createElement('span'); number.className = 'line-number';
    number.textContent = index + 1; number.setAttribute('aria-hidden', 'true');
    const content = document.createElement('span'); content.className = 'line-text'; content.textContent = line;
    row.append(number, content); fragment.append(row);
  }
  target.replaceChildren(fragment); target.scrollTop = 0;
  return lines.length > 10000;
}
async function inspect(entry) {
  if (busy) return;
  activeEntry = entry;
  const version = ++previewVersion;
  clearPreview();
  $('detail-empty').hidden = true; $('detail-content').hidden = false;
  $('detail-name').textContent = entry.name;
  $('detail-path').textContent = entry.path;
  $('preview-note').textContent = 'No preview is available for this file type. Use Download file to open it in its application.';
  render();
  if (matchMedia('(max-width: 799px)').matches) $('file-preview').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  const extension = entry.path.split('.').at(-1).toLowerCase();
  const imageType = Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : null;
  const audioType = Object.hasOwn(audioTypes, extension) ? audioTypes[extension] : null;
  const isText = /\.(txt|scp|csv|xml|json|ini|cfg|lua|h|c|cpp|log|md|yaml|yml)$/i.test(entry.path);
  const isTexture = /\.(dds|etc1|android_etc1_tex|pkm|ktx|tex)$/i.test(entry.path);
  if (!isText && !imageType && !audioType && !isTexture) return;
  const limit = isText ? 1 : 64;
  if (entry.size > limit * 1024 * 1024) { $('preview-note').textContent = `This file exceeds the ${limit} MiB ${isText ? 'text' : 'media'} preview limit. Download it to open the full file.`; return; }
  $('preview-note').textContent = 'Reading preview…';
  try {
    const result = await request(isTexture ? 'texture' : 'read', { path: entry.path });
    if (version !== previewVersion) return;
    let { bytes } = result;
    let textureNote = '';
    if (isTexture) {
      const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
      canvas.getContext('2d').putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (version !== previewVersion) return;
      if (!blob) throw new Error('Could not render texture preview.');
      bytes = blob;
      textureNote = ` · ${result.format}${result.mipmaps > 1 ? ' · base mip' : ''}${result.faces > 1 ? ' · first face / layer' : ''}`;
    }
    if (isText) {
      previewKind = 'text'; previewText = new TextDecoder().decode(bytes);
      const truncated = renderTextPreview($('inline-preview'), previewText);
      $('inline-preview').hidden = false; $('expand-preview').hidden = false;
      $('preview-note').textContent = truncated ? 'Showing the first 10,000 lines. Download the file to read all lines.' : entry.size ? 'Text preview' : 'This file is empty.';
      return;
    }
    previewKind = imageType || isTexture ? 'image' : 'audio';
    previewURL = URL.createObjectURL(new Blob([bytes], { type: isTexture ? 'image/png' : imageType || audioType }));
    const media = $(previewKind === 'image' ? 'image-preview' : 'audio-preview');
    media.onerror = () => {
      if (version !== previewVersion) return;
      $('media-preview').hidden = true; $('expand-preview').hidden = true;
      $('preview-note').textContent = `This browser cannot preview this ${previewKind} file. It may be damaged or use an unsupported format. Download it to open it in another application.`;
    };
    if (previewKind === 'image') {
      media.alt = entry.name;
      media.onload = () => {
        if (version !== previewVersion) return;
        $('preview-note').textContent = `${media.naturalWidth.toLocaleString()} × ${media.naturalHeight.toLocaleString()} pixels${textureNote}`;
        $('expand-preview').hidden = false;
      };
    } else {
      media.onloadedmetadata = () => {
        if (version === previewVersion) $('preview-note').textContent = 'Audio preview · Press play to listen';
      };
    }
    media.src = previewURL; media.hidden = false; $('media-preview').hidden = false;
    $('preview-note').textContent = `Loading ${previewKind} preview…`;
  } catch (error) { if (version === previewVersion) $('preview-note').textContent = error.message; }
}
async function openArchive(file) {
  if (!file) return;
  await operation(`Opening ${file.name}…`, async () => {
    const result = await request('open', { file });
    ++previewVersion; clearPreview();
    entries = result.entries; currentFile = file; archiveName = file.name;
    folder = ''; page = 0; selected.clear(); activeEntry = null;
    folderHistory = ['']; historyIndex = 0; expandedFolders.clear(); expandedFolders.add(''); buildFolders();
    $('filter').value = '';
    $('archive-title').textContent = file.name;
    archiveSummary = `${countLabel(entries.length, 'file')} · ${size(file.size)} · ${result.version === -3 ? 'PC archive' : result.version === -2 ? 'Legacy PC archive' : result.version === -5 ? 'Android archive' : `Format ${result.version}`}`;
    $('archive-panel').hidden = false; $('drop-zone').hidden = true;
    $('detail-empty').hidden = false; $('detail-content').hidden = true;
    render(); status('');
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
$('folder-back').onclick = () => {
  if ($('filter').value.trim()) navigate(folder, false);
  else if (historyIndex > 0) navigate(folderHistory[--historyIndex], false);
};
$('folder-forward').onclick = () => { if (historyIndex + 1 < folderHistory.length) navigate(folderHistory[++historyIndex], false); };
$('folder-up').onclick = () => navigate($('filter').value.trim() ? folder : folder.replace(/[^/]+\/$/, ''));
$('toggle-folders').onclick = () => {
  const expanded = $('toggle-folders').getAttribute('aria-expanded') !== 'true';
  $('toggle-folders').setAttribute('aria-expanded', String(expanded));
  $('folder-sidebar').classList.toggle('is-open', expanded);
};
$('filter').oninput = () => { page = 0; render(); };
$('sort').onchange = () => { page = 0; render(); };
$('clear-search').onclick = () => { $('filter').value = ''; render(); $('filter').focus(); };
$('previous').onclick = () => { page--; render(); $('entries').closest('.file-list-scroll').scrollTop = 0; };
$('next').onclick = () => { page++; render(); $('entries').closest('.file-list-scroll').scrollTop = 0; };
$('select-all').onchange = () => { for (const entry of visible.filter(entry => !entry.directory)) $('select-all').checked ? selected.add(entry.path) : selected.delete(entry.path); render(); };
$('clear-selection').onclick = () => { selected.clear(); render(); };
$('download-all').onclick = () => downloadPaths(selected.size ? [...selected] : scopeEntries().map(entry => entry.path));
$('download-file').onclick = () => {
  const entry = activeEntry;
  operation(`Extracting ${entry.path}…`, async () => {
    const { bytes } = await request('read', { path: entry.path });
    save(new Blob([bytes]), entry.name); status(`Downloaded ${entry.name}.`);
  });
};
$('verify').onclick = () => operation('Checking archive contents…', async () => { await request('verify'); status(`All ${entries.length.toLocaleString()} files verified successfully.`); });
$('expand-preview').onclick = () => {
  $('preview-title').textContent = activeEntry.path;
  $('preview-text').hidden = previewKind !== 'text'; $('expanded-image').hidden = previewKind !== 'image';
  if (previewKind === 'text') renderTextPreview($('preview-text'), previewText);
  else if (previewKind === 'image') { $('expanded-image').src = previewURL; $('expanded-image').alt = activeEntry.name; }
  $('preview-dialog').showModal();
};
for (const id of ['cancel-operation', 'cancel-archive-operation']) $(id).onclick = () => {
  generation++; previewVersion++; clearPreview(); worker.terminate();
  for (const request of pending.values()) request.reject(new Error('Operation cancelled.'));
  pending.clear(); busy = false;
  const file = currentFile;
  startWorker(async () => { if (file) await openArchive(file); status('Operation cancelled. Your archive is ready.'); });
  controls(); status('Cancelling operation…');
};
startWorker();
