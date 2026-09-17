/**
 * Bounded repairs for provider-generated documents, applied before schema
 * validation. Models trained on CSS often express `gap` and `padding` as a
 * four-value array or a "16px" string; the document schema takes one
 * non-negative number applied uniformly. These coercions are the only ones
 * performed: nothing is invented, and any value that cannot be read
 * unambiguously is left for validation to reject. Every change is reported so
 * the server can log what the provider got wrong.
 */
import { isSafeUrl } from './schema';

export interface GenerationRepair { path: string; from: unknown; to: number | string | undefined }

type NodeRecord = Record<string, unknown> & { id?: unknown; children?: unknown };
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Providers frequently nest section contents in a `children` array on the
 * parent node, as HTML and design-tool JSON do. The document format is one
 * flat `nodes` array linked by `parentId`, and the schema strips unknown
 * fields, so nested children would otherwise vanish silently. Flatten them in
 * place, right after their parent so paint order is preserved, and link them
 * with `parentId`.
 *
 * Child coordinates are ambiguous: a parent with an explicit layout
 * interprets them as local, a parent without one as page-space. When the
 * children only fit the parent's box when read as local coordinates, the
 * parent gets an absolute layout so they render where the provider meant.
 */
function flattenNestedChildren(nodes: unknown[], pagePath: string, repairs: GenerationRepair[]) {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const parent = node as NodeRecord;
    if (!Array.isArray(parent.children)) { if ('children' in parent) delete parent.children; continue; }
    const children = parent.children.filter((child): child is NodeRecord => !!child && typeof child === 'object' && !Array.isArray(child));
    delete parent.children;
    if (typeof parent.id === 'string' && children.length) {
      for (const child of children) if (child.parentId === undefined) child.parentId = parent.id;
      const px = num(parent.x) ?? 0, py = num(parent.y) ?? 0, pw = num(parent.width), ph = num(parent.height);
      if (parent.layout === undefined && pw !== undefined && ph !== undefined && (px !== 0 || py !== 0)) {
        const fits = (ox: number, oy: number) => children.every(child => {
          const x = num(child.x), y = num(child.y), w = num(child.width) ?? 0, h = num(child.height) ?? 0;
          return x !== undefined && y !== undefined && x >= ox - 1 && y >= oy - 1 && x + w <= ox + pw + 1 && y + h <= oy + ph + 1;
        });
        // Local coordinates fit the box at the origin; page-space ones fit it at the parent's position.
        if (fits(0, 0) && !fits(px, py)) {
          parent.layout = { mode: 'absolute' };
          repairs.push({ path: `${pagePath}.nodes.${index}.layout`, from: undefined, to: 'absolute (local child coordinates)' });
        }
      }
    }
    repairs.push({ path: `${pagePath}.nodes.${index}.children`, from: `${children.length} nested node(s)`, to: 'flattened with parentId' });
    nodes.splice(index + 1, 0, ...children);
  }
}

const LENGTH_KEYS = ['gap', 'padding'] as const;
/** Node types whose `src` names media; the renderer shows a placeholder when it is absent. */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'model3d']);

/**
 * Providers cannot produce real media and often invent relative paths, bare
 * file names or SVG data URLs. Those can never render, so the reference is
 * removed and the node falls back to the studio's media placeholder; the
 * person replaces it through the assets panel. Valid HTTPS URLs, owned asset
 * paths and raster data URLs are kept untouched.
 */
function repairMediaSource(node: Record<string, unknown>, path: string, repairs: GenerationRepair[]) {
  if (!MEDIA_TYPES.has(String(node.type)) || typeof node.src !== 'string' || isSafeUrl(node.src)) return;
  repairs.push({ path: `${path}.src`, from: node.src.slice(0, 60), to: undefined });
  delete node.src;
}

function asLength(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value === 'string') {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value);
    return match ? Number(match[1]) : undefined;
  }
  if (Array.isArray(value) && value.length >= 1 && value.length <= 4) {
    const parts = value.map(asLength);
    // Uniform spacing cannot represent four different sides; the largest side keeps content from touching edges.
    return parts.every((part): part is number => part !== undefined) ? Math.max(...parts) : undefined;
  }
  return undefined;
}

/**
 * Layout enums accept a small vocabulary; providers reach for CSS flexbox
 * words instead. Map the unambiguous ones onto the nearest accepted value.
 */
const LAYOUT_ENUM_ALIASES: Record<string, Record<string, string>> = {
  mode: { flexbox: 'flex', row: 'flex', column: 'flex', stack: 'flex', free: 'absolute', freeform: 'absolute', none: 'absolute' },
  direction: { horizontal: 'row', vertical: 'column', 'row-reverse': 'row', 'column-reverse': 'column' },
  align: { 'flex-start': 'start', 'flex-end': 'end', left: 'start', right: 'end', top: 'start', bottom: 'end', middle: 'center', baseline: 'start', normal: 'stretch', fill: 'stretch' },
  justify: { 'flex-start': 'start', 'flex-end': 'end', left: 'start', right: 'end', top: 'start', bottom: 'end', middle: 'center', 'space-around': 'space-between', 'space-evenly': 'space-between', between: 'space-between', stretch: 'start', normal: 'start' },
};
function repairLayoutEnums(record: Record<string, unknown>, path: string, repairs: GenerationRepair[]) {
  for (const [key, aliases] of Object.entries(LAYOUT_ENUM_ALIASES)) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const mapped = aliases[value.trim().toLowerCase()];
    if (mapped === undefined || mapped === value) continue;
    repairs.push({ path: `${path}.${key}`, from: value, to: mapped });
    record[key] = mapped;
  }
  if (typeof record.wrap === 'string') {
    const wrap = record.wrap.trim().toLowerCase();
    if (wrap === 'wrap' || wrap === 'true' || wrap === 'nowrap' || wrap === 'false') {
      const mapped = wrap === 'wrap' || wrap === 'true';
      repairs.push({ path: `${path}.wrap`, from: record.wrap, to: String(mapped) });
      record.wrap = mapped;
    }
  }
}

function repairLayout(layout: unknown, path: string, repairs: GenerationRepair[]) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return;
  const record = layout as Record<string, unknown>;
  repairLayoutEnums(record, path, repairs);
  for (const key of LENGTH_KEYS) {
    const value = record[key];
    if (value === undefined || typeof value === 'number') continue;
    const fixed = asLength(value);
    if (fixed === undefined) continue;
    repairs.push({ path: `${path}.${key}`, from: value, to: fixed });
    record[key] = fixed;
  }
}

/**
 * Decide how a layout-less parent's children were positioned. Providers write
 * child coordinates relative to the parent almost without exception, but the
 * document format reads children of a parent without a layout as page-space.
 * When the children fit the parent's box only when read from the parent's
 * origin, give the parent an absolute layout so they render inside it. A
 * parent at 0,0 needs nothing: both readings coincide.
 */
function repairParentCoordinateSpace(nodes: unknown[], pagePath: string, repairs: GenerationRepair[]) {
  const records = nodes.filter((node): node is NodeRecord => !!node && typeof node === 'object' && !Array.isArray(node));
  const childrenOf = new Map<string, NodeRecord[]>();
  for (const node of records) if (typeof node.parentId === 'string') (childrenOf.get(node.parentId) ?? childrenOf.set(node.parentId, []).get(node.parentId)!).push(node);
  for (const parent of records) {
    if (parent.layout !== undefined || typeof parent.id !== 'string') continue;
    const children = (childrenOf.get(parent.id) ?? []).filter(child => num(child.x) !== undefined && num(child.y) !== undefined);
    if (!children.length) continue;
    const px = num(parent.x) ?? 0, py = num(parent.y) ?? 0, pw = num(parent.width), ph = num(parent.height);
    if (pw === undefined || ph === undefined || (px === 0 && py === 0)) continue;
    const box = (child: NodeRecord) => ({ x: num(child.x)!, y: num(child.y)!, w: num(child.width) ?? 0, h: num(child.height) ?? 0 });
    const within = (c: { x: number; y: number; w: number; h: number }, ox: number, oy: number) => c.x >= ox - 1 && c.y >= oy - 1 && c.x + c.w <= ox + pw + 1 && c.y + c.h <= oy + ph + 1;
    const nonNegative = children.every(child => { const c = box(child); return c.x >= -1 && c.y >= -1; });
    // Read as page-space, a child that starts before the parent's origin would lie outside it entirely;
    // that only makes sense if the provider meant parent-relative coordinates. Otherwise fall back to
    // the exact-fit comparison for the ambiguous middle ground.
    const beforeOrigin = children.some(child => { const c = box(child); return c.x < px - 1 || c.y < py - 1; });
    const local = nonNegative && (beforeOrigin || (children.every(child => within(box(child), 0, 0)) && !children.every(child => within(box(child), px, py))));
    if (!local) continue;
    const index = nodes.indexOf(parent);
    parent.layout = { mode: 'absolute' };
    repairs.push({ path: `${pagePath}.nodes.${index}.layout`, from: undefined, to: 'absolute (local child coordinates)' });
    // Undersized containers are the companion habit: grow, never shrink, so children stay inside their parent.
    const needW = Math.max(...children.map(child => { const c = box(child); return c.x + c.w; }));
    const needH = Math.max(...children.map(child => { const c = box(child); return c.y + c.h; }));
    if (needW > pw + 1) { repairs.push({ path: `${pagePath}.nodes.${index}.width`, from: pw, to: needW }); parent.width = needW; }
    if (needH > ph + 1) { repairs.push({ path: `${pagePath}.nodes.${index}.height`, from: ph, to: needH }); parent.height = needH; }
  }
}

/**
 * Renderers read `fill`, `stroke` and `strokeWidth`; providers write the CSS
 * names `background`, `color`, `borderColor` and `borderWidth`, which are
 * accepted by the free-form style record and then silently ignored, so an
 * orange wordmark renders in the theme text colour and a red badge in white.
 * Map each alias onto the renderer's key when that key is not already set.
 */
const STYLE_ALIASES: Array<[alias: string, key: string, types?: Set<string>]> = [
  ['background', 'fill'],
  ['backgroundColor', 'fill'],
  ['color', 'fill', new Set(['text', 'icon'])],
  ['borderColor', 'stroke'],
  ['borderWidth', 'strokeWidth'],
];
function repairStyleAliases(node: Record<string, unknown>, path: string, repairs: GenerationRepair[]) {
  const style = node.style;
  if (!style || typeof style !== 'object' || Array.isArray(style)) return;
  const record = style as Record<string, unknown>;
  for (const [alias, key, types] of STYLE_ALIASES) {
    if (!(alias in record) || (types && !types.has(String(node.type)))) continue;
    const value = record[alias];
    if (record[key] === undefined && (typeof value === 'string' || typeof value === 'number')) {
      record[key] = value;
      repairs.push({ path: `${path}.style.${alias}`, from: value, to: `moved to ${key}` });
    }
    delete record[alias];
  }
}

/**
 * Every node needs a layer `name`; providers routinely omit it on leaf nodes.
 * Derive one from the node's own text, component or type so the layer tree
 * stays readable, and read percent-style opacity (0–100) as a fraction.
 */
function repairNodeBasics(node: Record<string, unknown>, path: string, repairs: GenerationRepair[]) {
  if (typeof node.name !== 'string' || !node.name.trim()) {
    const text = typeof node.text === 'string' ? node.text.trim().replace(/\s+/g, ' ') : '';
    const component = node.component && typeof node.component === 'object' ? (node.component as { name?: unknown }).name : undefined;
    const type = typeof node.type === 'string' ? node.type : 'node';
    const derived = text ? text.slice(0, 60) : typeof component === 'string' ? component : type.charAt(0).toUpperCase() + type.slice(1);
    repairs.push({ path: `${path}.name`, from: node.name, to: derived });
    node.name = derived;
  }
  if (typeof node.opacity === 'number' && node.opacity > 1 && node.opacity <= 100) {
    repairs.push({ path: `${path}.opacity`, from: node.opacity, to: node.opacity / 100 });
    node.opacity = node.opacity / 100;
  }
}

/** Repairs `draft` in place and returns the list of changes made. */
export function repairGeneratedDocument(draft: unknown): GenerationRepair[] {
  const repairs: GenerationRepair[] = [];
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return repairs;
  const pages = (draft as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return repairs;
  pages.forEach((page, pageIndex) => {
    if (!page || typeof page !== 'object') return;
    repairLayout((page as { layout?: unknown }).layout, `pages.${pageIndex}.layout`, repairs);
    const nodes = (page as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return;
    flattenNestedChildren(nodes, `pages.${pageIndex}`, repairs);
    repairParentCoordinateSpace(nodes, `pages.${pageIndex}`, repairs);
    nodes.forEach((node, nodeIndex) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const path = `pages.${pageIndex}.nodes.${nodeIndex}`;
      repairNodeBasics(node as Record<string, unknown>, path, repairs);
      repairStyleAliases(node as Record<string, unknown>, path, repairs);
      repairLayout((node as { layout?: unknown }).layout, `${path}.layout`, repairs);
      repairMediaSource(node as Record<string, unknown>, path, repairs);
    });
  });
  return repairs;
}
