// Tree structure is presentation only; field values, labels and validation come from nusave.
const words = text => text.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function location(field) {
  const { name, editor } = field;
  const path = [{ id: editor.group, label: editor.group }];
  const entity = name.match(/^(level_save|area_save|character_save|episode_save)\[(\d+)\](?:\.(.*))?$/);
  if (entity) {
    const [, kind, index, tail = ''] = entity;
    const suffix = words(tail);
    let label = suffix && editor.label.endsWith(suffix) ? editor.label.slice(0, -suffix.length).trim() : tail ? '' : editor.label;
    if (!label || label.includes('[')) label = `${{level_save:'Level',area_save:'Area',character_save:'Character',episode_save:'Episode'}[kind]} ${Number(index) + 1}`;
    path.push({ id: `${editor.group}/${kind}[${index}]`, label });
    if (tail.startsWith('minikit_names[')) path.push({ id: `${path.at(-1).id}/minikits`, label: 'Minikits' });
  } else if (name.startsWith('mission_save.')) {
    const index = name.match(/\[(\d+)\]/)?.[1];
    if (index !== undefined) path.push({ id: `${editor.group}/mission[${index}]`, label: `Mission ${Number(index) + 1}` });
  } else if (name.startsWith('customizer.')) {
    const secondary = name.includes('secondary');
    const primary = name.includes('primary') || name.startsWith('customizer.pieces[');
    if (primary || secondary) path.push({ id: `${editor.group}/${secondary ? 'secondary' : 'primary'}`, label: secondary ? 'Character 2' : 'Character 1' });
  }
  return path;
}
export function buildTree(fields, { advanced = false, query = '' } = {}) {
  const roots = [], nodes = new Map();
  const search = query.trim().toLowerCase();
  for (const field of fields) {
    if (!advanced && field.editor.advanced) continue;
    const path = location(field);
    if (search && ![field.name, field.editor.label, field.description, ...path.map(p => p.label)].join(' ').toLowerCase().includes(search)) continue;
    let siblings = roots, parent = null;
    for (const part of path) {
      let node = nodes.get(part.id);
      if (!node) { node = { ...part, parent, children: [], fields: [], count: 0 }; nodes.set(node.id, node); siblings.push(node); }
      node.count++;
      siblings = node.children; parent = node;
    }
    parent.fields.push(field);
  }
  return { roots, nodes, total: roots.reduce((total, node) => total + node.count, 0) };
}
