import { buildTree } from './tree.js';
const $ = id => document.getElementById(id);
const worker = new Worker('./worker.js', { type: 'module' });
const pending = new Map(), edits = new Map();
let sequence = 0, ready = false, busy = false, snapshot = null, filename = '', view = 'fields', group = 'Progress', renderVersion = 0, savedCopy = true;
let catalog = null;
const expanded = new Set();
const actions = ['open-save', 'create-game', 'create-options', 'replace-save', 'start-over', 'download-save', 'apply-edits', 'reset-save'];
function status(text, error = false) {
  const target = snapshot ? $('edit-status') : $('startup-status');
  target.textContent = text; target.title = text; target.dataset.error = String(error);
}
function controls() {
  for (const id of actions) $(id).disabled = busy || !ready;
  $('save-file').disabled = busy || !ready;
  $('apply-edits').disabled ||= !edits.size;
  $('apply-edits').textContent = edits.size ? `Apply changes (${edits.size})` : 'Apply changes';
  $('reset-save').disabled ||= !snapshot?.modified && !edits.size;
  $('save-workspace').setAttribute('aria-busy', String(busy));
  $('keep-derived').disabled = busy;
  $('values-form').querySelectorAll('input, select, textarea').forEach(control => { control.disabled = busy || control.dataset.readonly === 'true'; });
}
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') { ready = true; controls(); status(''); return; }
  const task = pending.get(data.id); if (!task) return;
  pending.delete(data.id);
  data.error ? task.reject(new Error(data.error)) : task.resolve(data);
};
worker.onerror = event => {
  ready = false;
  for (const task of pending.values()) task.reject(new Error(event.message || 'nusave could not start. Reload to try again.'));
  pending.clear(); controls(); status('nusave stopped. Reload this page to try again.', true);
};
function request(command, options = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, command, ...options }); });
}
async function operation(action) {
  if (!ready || busy) return;
  busy = true; controls();
  try { await action(); } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
}
function download(data, name) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function updateSnapshot(next) {
  snapshot = next;
  $('save-title').textContent = filename;
  $('save-info').textContent = `${snapshot.kind} · ${snapshot.size.toLocaleString()} bytes · Checksum ${snapshot.checksum_valid ? 'valid' : 'invalid'}${snapshot.modified ? ' · Modified' : ''}`;
  $('save-info').title = $('save-info').textContent;
  $('save-info').dataset.error = String(!snapshot.checksum_valid);
  $('save-start').hidden = true; $('save-workspace').hidden = false;
}
function hasPendingChanges() { return !savedCopy || edits.size > 0; }
async function allowReplacement() {
  if (!hasPendingChanges()) return true;
  const dialog = $('discard-dialog'); dialog.returnValue = 'cancel'; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true }));
}
async function load(command, options, name) {
  if (!ready || busy || !await allowReplacement()) return;
  await operation(async () => {
    status(command === 'open' ? 'Reading save…' : 'Creating save…');
    const result = await request(command, options);
    filename = name; savedCopy = command === 'open'; edits.clear(); catalog = null; expanded.clear();
    $('save-filter').value = '';
    $('keep-derived').checked = false; $('show-advanced').checked = false;
    group = result.snapshot.kind.includes('SuperOptions') ? 'Settings' : 'Progress';
    updateSnapshot(result.snapshot); await changeView('fields');
    status(snapshot.checksum_valid ? 'Changes affect this copy only. Download to keep them.' : 'Invalid checksum. It will be repaired on download unless preservation is enabled.', !snapshot.checksum_valid);
  });
}
function open(file) { if (file) return load('open', { file }, file.name); }
function summaryRows() {
  const query = $('save-filter').value.trim().toLowerCase();
  const rows = snapshot.summary.filter(row => `${row.section} ${row.label} ${row.value}`.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  let section = null, list;
  for (const row of rows) {
    if (section !== row.section) {
      section = row.section;
      const block = document.createElement('section'); block.className = 'summary-group';
      const heading = document.createElement('h3'); heading.textContent = section;
      list = document.createElement('dl'); block.append(heading, list); fragment.append(block);
    }
    const term = document.createElement('dt'); term.textContent = row.label;
    const value = document.createElement('dd'); value.textContent = row.value; list.append(term, value);
  }
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No matching values.'; fragment.append(empty); }
  $('summary-view').replaceChildren(fragment);
  $('save-results').textContent = `${rows.length.toLocaleString()} values${edits.size ? ' · Changes not yet applied' : ''}`;
}
function storedValue(field, value) {
  return field.editor.input === 'text' ? `text:${value}` : field.editor.input === 'hex' ? `hex:${value.replace(/\s/g, '')}` : value;
}
function stage(field, value, control) {
  const original = storedValue(field, field.editor.value);
  const changed = storedValue(field, value);
  if (changed === original) edits.delete(field.name); else edits.set(field.name, { value: changed, display: value });
  control.closest('.property-field').classList.toggle('is-edited', edits.has(field.name));
  controls();
  status(edits.size ? `${edits.size} changed ${edits.size === 1 ? 'value' : 'values'}. Apply or download to keep them.` : 'No pending changes.');
}
function fieldControl(field, index) {
  const editor = field.editor, value = edits.get(field.name)?.display ?? editor.value;
  const readonly = editor.readonly || (!$('keep-derived').checked && ['checksum', 'slot_code'].includes(field.name));
  let control;
  if (editor.input === 'flags') {
    control = document.createElement('details'); control.className = 'flag-picker';
    const summary = document.createElement('summary');
    const selected = new Set(value === 'NONE' ? [] : value.split('|'));
    const updateSummary = () => { summary.textContent = selected.size ? `${selected.size} selected` : 'None'; };
    updateSummary();
    const options = document.createElement('div'); options.className = 'flag-options';
    for (const choice of editor.choices) {
      const label = document.createElement('label'); label.className = 'checkbox-field';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(choice.value);
      checkbox.dataset.readonly = String(readonly); checkbox.disabled = readonly;
      checkbox.onchange = () => { checkbox.checked ? selected.add(choice.value) : selected.delete(choice.value); updateSummary(); stage(field, selected.size ? editor.choices.filter(choice => selected.has(choice.value)).map(choice => choice.value).join('|') : 'NONE', checkbox); };
      label.append(checkbox, document.createTextNode(choice.label)); options.append(label);
    }
    control.append(summary, options); control.setAttribute('aria-label', editor.label);
  } else if (editor.input === 'toggle') {
    control = document.createElement('label'); control.className = 'checkbox-field';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = value === '1';
    checkbox.dataset.readonly = String(readonly); checkbox.disabled = readonly; checkbox.setAttribute('aria-label', editor.label);
    const text = document.createElement('span'); text.textContent = editor.choices[checkbox.checked ? 1 : 0].label;
    checkbox.onchange = () => { text.textContent = editor.choices[checkbox.checked ? 1 : 0].label; stage(field, checkbox.checked ? '1' : '0', checkbox); };
    control.append(checkbox, text);
  } else {
    if (editor.input === 'select') {
      control = document.createElement('select');
      for (const choice of editor.choices) { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; control.append(option); }
    } else if (editor.input === 'hex') {
      control = document.createElement('textarea'); control.className = 'hex-input'; control.rows = field.size > 24 ? 3 : 1; control.spellcheck = false;
    } else {
      control = document.createElement('input'); control.type = ['number', 'float'].includes(editor.input) ? 'number' : 'text';
      if (control.type === 'number') {
        control.step = editor.input === 'float' ? 'any' : '1';
        if (editor.min != null) control.min = editor.min;
        if (editor.max != null) control.max = editor.max;
        if (!Number.isFinite(Number(value))) control.placeholder = `Stored: ${value}`;
      }
      if (editor.input === 'text') control.maxLength = editor.max;
    }
    control.value = editor.input === 'float' && !Number.isFinite(Number(value)) ? '' : value;
    control.dataset.readonly = String(readonly); control.disabled = readonly;
    control.setAttribute('aria-label', editor.label); control.setAttribute('aria-describedby', `field-description-${index}`);
    control.oninput = () => stage(field, control.value, control);
  }
  return control;
}
async function renderFromStart() {
  await render();
  const content = $('fields-view');
  if (content.getBoundingClientRect().top < 0) content.scrollIntoView({ block: 'start' });
}
function renderTree(tree) {
  const scrollTop = $('save-groups').scrollTop;
  const fragment = document.createDocumentFragment();
  const focused = document.activeElement?.dataset.saveNode;
  const focusedToggle = document.activeElement?.dataset.saveToggle;
  function select(node) {
    expanded.add(node.id);
    while (!node.fields.length && node.children.length) { node = node.children[0]; expanded.add(node.id); }
    group = node.id; renderFromStart().catch(error => status(error.message, true));
  }
  function branch(node) {
    const item = document.createElement('li');
    const row = document.createElement('div'); row.className = 'save-tree-row';
    const toggle = document.createElement('button'); toggle.className = 'tree-toggle';
    const open = expanded.has(node.id);
    toggle.dataset.saveToggle = node.id;
    toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.label}`);
    toggle.setAttribute('aria-expanded', String(open));
    if (!node.children.length) { toggle.className = 'tree-spacer'; toggle.disabled = true; toggle.setAttribute('aria-hidden', 'true'); }
    toggle.onclick = () => { open ? expanded.delete(node.id) : expanded.add(node.id); renderTree(tree); };
    const button = document.createElement('button'); button.className = 'save-tree-label'; button.dataset.saveNode = node.id;
    const label = document.createElement('span'); label.textContent = node.label; label.title = node.label;
    const count = document.createElement('small'); count.textContent = node.parent ? node.count : node.children.length || node.fields.length;
    count.title = node.parent || !node.children.length ? `${node.count} values` : `${node.children.length} items`;
    button.append(label, count);
    if (node.id === group) button.setAttribute('aria-current', 'true');
    button.onclick = () => select(node);
    row.append(toggle, button); item.append(row);
    if (open && node.children.length) { const list = document.createElement('ul'); node.children.forEach(child => list.append(branch(child))); item.append(list); }
    return item;
  }
  const list = document.createElement('ul'); tree.roots.forEach(node => list.append(branch(node))); fragment.append(list);
  $('save-groups').replaceChildren(fragment);
  $('save-groups').scrollTop = scrollTop;
  if (focusedToggle) [...$('save-groups').querySelectorAll('[data-save-toggle]')].find(button => button.dataset.saveToggle === focusedToggle)?.focus({ preventScroll: true });
  if (focused) [...$('save-groups').querySelectorAll('[data-save-node]')].find(button => button.dataset.saveNode === focused)?.focus({ preventScroll: true });
}
async function render() {
  const version = ++renderVersion;
  if (!snapshot) return;
  if (view === 'summary') { summaryRows(); controls(); return; }
  if (!catalog) {
    const result = await request('catalog');
    if (version !== renderVersion) return;
    catalog = result.fields;
  }
  const query = $('save-filter').value.trim();
  const tree = buildTree(catalog, { advanced: $('show-advanced').checked, query });
  if (!tree.nodes.has(group)) group = [...tree.nodes.values()].find(node => node.fields.length)?.id || '';
  const node = tree.nodes.get(group);
  if (query && node) for (let parent = node.parent; parent; parent = parent.parent) expanded.add(parent.id);
  renderTree(tree);
  $('fields-heading').textContent = node?.label || 'No matching values';
  const ancestry = []; for (let parent = node?.parent; parent; parent = parent.parent) ancestry.unshift(parent.label);
  $('fields-context').textContent = ancestry.length ? ancestry.join(' / ') : 'Save contents';
  $('fields-instruction').textContent = node?.children.length ? 'Edit these values, or choose a child item in the tree.' : 'Edit values, then apply your changes or download the save.';
  const children = document.createDocumentFragment();
  for (const child of node?.children || []) {
    const button = document.createElement('button'); button.className = 'save-child-link';
    const label = document.createElement('span'); label.textContent = child.label;
    const count = document.createElement('small'); count.textContent = `${child.count} values`;
    button.append(label, count);
    button.onclick = () => { group = child.id; expanded.add(node.id); renderFromStart().catch(error => status(error.message, true)); };
    children.append(button);
  }
  $('save-children').replaceChildren(children); $('save-children').hidden = !node?.children.length;
  const fields = node?.fields || [];
  const rows = document.createDocumentFragment();
  for (const [index, field] of fields.entries()) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'property-field';
    fieldset.classList.toggle('is-edited', edits.has(field.name));
    fieldset.classList.toggle('property-field-wide', field.editor.input === 'hex');
    const label = document.createElement('legend'); label.textContent = field.editor.label;
    const help = document.createElement('details'); help.className = 'property-help';
    const summary = document.createElement('summary'); summary.textContent = 'Details'; summary.setAttribute('aria-label', `About ${field.editor.label}`);
    const description = document.createElement('p'); description.className = 'caption'; description.id = `field-description-${index}`;
    description.textContent = field.description + (field.editor.input === 'hex' ? ' Edit as hexadecimal bytes.' : '');
    const key = document.createElement('code'); key.className = 'property-key'; key.textContent = field.name;
    help.append(summary, description, key);
    fieldset.append(label, fieldControl(field, index), help); rows.append(fieldset);
  }
  $('save-fields').replaceChildren(rows); $('fields-empty').hidden = tree.total > 0;
  $('save-results').textContent = query ? `${tree.total.toLocaleString()} matching values in the tree` : `${node?.count.toLocaleString() || 0} values in ${node?.label || 'this section'}`;
  controls();
}
async function changeView(next) {
  view = next;
  for (const name of ['summary', 'fields']) {
    $(name + '-tab').setAttribute('aria-selected', String(view === name)); $(name + '-tab').tabIndex = view === name ? 0 : -1;
    $(name + '-view').hidden = view !== name;
  }
  $('save-groups').hidden = view !== 'fields';
  $('save-workspace').classList.toggle('summary-mode', view === 'summary');
  $('save-filter').placeholder = view === 'summary' ? 'Search summary…' : 'Search values…'; await render();
}
async function applyEdits() {
  if (!edits.size) return;
  const values = [...edits].map(([name, edit]) => ({ name, value: edit.value }));
  const result = await request('apply', { values, keepDerived: $('keep-derived').checked });
  edits.clear(); catalog = null; savedCopy = false; updateSnapshot(result.snapshot); await render();
}
for (const name of ['summary', 'fields']) {
  $(name + '-tab').onclick = () => changeView(name).catch(error => status(error.message, true));
  $(name + '-tab').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'fields' : event.key === 'End' ? 'summary' : name === 'summary' ? 'fields' : 'summary';
    $(next + '-tab').click(); $(next + '-tab').focus();
  };
}
for (const id of ['open-save', 'replace-save']) $(id).onclick = () => $('save-file').click();
$('save-file').onchange = () => { open($('save-file').files[0]); $('save-file').value = ''; };
$('create-game').onclick = () => load('create', { options: false }, 'SaveGame0.LEGO Star Wars - The Complete Saga_SavedGame');
$('create-options').onclick = () => load('create', { options: true }, 'SaveGame3.LEGO Star Wars - The Complete Saga_SavedGame');
$('start-over').onclick = async () => {
  if (!await allowReplacement()) return;
  snapshot = null; savedCopy = true; edits.clear(); ++renderVersion;
  $('save-workspace').hidden = true; $('save-start').hidden = false; status(''); controls();
};
for (const id of ['save-start', 'save-workspace']) {
  $(id).ondragover = event => { event.preventDefault(); if (!busy && ready) $(id).classList.add('is-dragging'); };
  $(id).ondragleave = event => { if (!$(id).contains(event.relatedTarget)) $(id).classList.remove('is-dragging'); };
  $(id).ondrop = event => { event.preventDefault(); $(id).classList.remove('is-dragging'); open(event.dataTransfer.files[0]); };
}
$('values-form').onsubmit = event => { event.preventDefault(); $('apply-edits').click(); };
$('apply-edits').onclick = () => operation(async () => { await applyEdits(); status('Changes applied. Download the save to keep them.'); });
$('reset-save').onclick = () => operation(async () => {
  const result = await request('reset'); edits.clear(); catalog = null; savedCopy = true;
  updateSnapshot(result.snapshot); await render(); status('Restored the original values.');
});
$('download-save').onclick = () => operation(async () => {
  await applyEdits();
  const result = await request('download', { keepDerived: $('keep-derived').checked });
  download(result.bytes, filename); savedCopy = true; status('Save prepared for download.');
});
$('save-filter').oninput = () => { render().catch(error => status(error.message, true)); };
$('show-advanced').onchange = () => { render().catch(error => status(error.message, true)); };
$('keep-derived').onchange = () => render().catch(error => status(error.message, true));
window.addEventListener('beforeunload', event => { if (hasPendingChanges()) { event.preventDefault(); event.returnValue = ''; } });
controls();
