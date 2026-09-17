import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairGeneratedDocument } from '../src/shared/generation-repair';

test('CSS-style gap and padding from providers are coerced to single numbers and reported', () => {
  const draft = {
    pages: [{
      layout: { mode: 'flex', padding: '24px', gap: '8' },
      nodes: [
        { id: 'a', layout: { mode: 'flex', padding: [16, 12, 16, 12], gap: 8 } },
        { id: 'b', layout: { mode: 'grid', padding: ['12px', '8px'] } },
        { id: 'c', layout: { mode: 'absolute' } },
        { id: 'd' },
      ],
    }],
  };
  const repairs = repairGeneratedDocument(draft).filter(r => !r.path.endsWith('.name'));
  assert.deepEqual(repairs.map(r => [r.path, r.to]), [
    ['pages.0.layout.gap', 8],
    ['pages.0.layout.padding', 24],
    ['pages.0.nodes.0.layout.padding', 16],
    ['pages.0.nodes.1.layout.padding', 12],
  ]);
  assert.equal(draft.pages[0].layout.padding, 24);
  assert.equal(draft.pages[0].nodes[0].layout!.padding, 16);
  assert.equal(draft.pages[0].nodes[1].layout!.padding, 12);
  assert.equal(draft.pages[0].nodes[0].layout!.gap, 8);
});

test('ambiguous or negative values are left for validation to reject', () => {
  const draft = { pages: [{ nodes: [
    { id: 'a', name: 'a', layout: { mode: 'flex', padding: 'auto', gap: '1em' } },
    { id: 'b', name: 'b', layout: { mode: 'flex', padding: [16, 'x'], gap: -4 } },
    { id: 'c', name: 'c', layout: { mode: 'flex', padding: [1, 2, 3, 4, 5] } },
    { id: 'd', name: 'd', layout: { mode: 'flex', padding: { top: 4 } } },
  ] }] };
  const before = JSON.stringify(draft);
  assert.deepEqual(repairGeneratedDocument(draft), []);
  assert.equal(JSON.stringify(draft), before);
});

test('unusable media sources are removed so the placeholder renders; valid sources stay', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const draft = { pages: [{ nodes: [
    { id: 'a', type: 'image', src: '/images/product-1.jpg' },
    { id: 'b', type: 'image', src: 'product-2.png' },
    { id: 'c', type: 'image', src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>' },
    { id: 'd', type: 'image', src: 'http://insecure.example/photo.jpg' },
    { id: 'e', type: 'image', src: 'https://cdn.example/photo.jpg' },
    { id: 'f', type: 'image', src: '/api/assets/asset-123' },
    { id: 'g', type: 'image', src: png },
    { id: 'h', type: 'video', src: 'clip.mp4' },
    { id: 'i', type: 'text', src: 'not-media-but-left-alone' },
    { id: 'j', type: 'image' },
  ] }] };
  const repairs = repairGeneratedDocument(draft).filter(r => r.path.endsWith('.src'));
  assert.deepEqual(repairs.map(r => r.path), ['pages.0.nodes.0.src', 'pages.0.nodes.1.src', 'pages.0.nodes.2.src', 'pages.0.nodes.3.src', 'pages.0.nodes.7.src']);
  assert.ok(repairs.every(r => r.to === undefined && typeof r.from === 'string' && r.from.length <= 60));
  const nodes = draft.pages[0].nodes as Array<{ src?: string }>;
  for (const index of [0, 1, 2, 3, 7]) assert.equal('src' in nodes[index], false);
  assert.equal(nodes[4].src, 'https://cdn.example/photo.jpg');
  assert.equal(nodes[5].src, '/api/assets/asset-123');
  assert.equal(nodes[6].src, png);
  assert.equal(nodes[8].src, 'not-media-but-left-alone');
});

test('nested children arrays are flattened after their parent and linked by parentId', () => {
  const draft = { pages: [{ nodes: [
    { id: 'header', type: 'group', x: 0, y: 0, width: 390, height: 72, layout: { mode: 'flex', direction: 'row' }, children: [
      { id: 'logo', type: 'text', x: 0, y: 0, width: 100, height: 24, text: 'SparkeMart' },
      { id: 'search', type: 'component', x: 110, y: 0, width: 200, height: 40, children: [
        { id: 'search-icon', type: 'icon', x: 4, y: 4, width: 16, height: 16 },
      ] },
    ] },
    // No layout, positioned lower on the page, children written in local coordinates.
    { id: 'cats', type: 'group', x: 0, y: 80, width: 390, height: 116, children: [
      { id: 'cat-1', type: 'text', x: 12, y: 8, width: 80, height: 20, text: 'Thời trang' },
      { id: 'cat-2', type: 'text', x: 100, y: 8, width: 80, height: 20, text: 'Điện tử' },
    ] },
    // No layout, children already in page-space coordinates: left alone.
    { id: 'banner', type: 'group', x: 0, y: 200, width: 390, height: 129, children: [
      { id: 'banner-1', type: 'shape', x: 16, y: 210, width: 358, height: 110 },
    ] },
    { id: 'footer', type: 'group', x: 0, y: 1490, width: 390, height: 300, children: 'none' },
  ] }] };
  const repairs = repairGeneratedDocument(draft);
  const nodes = draft.pages[0].nodes as Array<Record<string, unknown>>;
  assert.deepEqual(nodes.map(n => n.id), ['header', 'logo', 'search', 'search-icon', 'cats', 'cat-1', 'cat-2', 'banner', 'banner-1', 'footer']);
  assert.ok(nodes.every(n => !('children' in n)));
  assert.equal(nodes[1].parentId, 'header');
  assert.equal(nodes[3].parentId, 'search');
  assert.equal(nodes[5].parentId, 'cats');
  assert.deepEqual(nodes[4].layout, { mode: 'absolute' });
  assert.equal(nodes[7].layout, undefined);
  assert.equal(nodes[8].parentId, 'banner');
  assert.deepEqual(nodes[0].layout, { mode: 'flex', direction: 'row' });
  assert.equal(repairs.filter(r => r.path.endsWith('.children')).length, 4);
  // Both `cats` and `search` had children that only fit as local coordinates.
  assert.deepEqual(nodes[2].layout, { mode: 'absolute' });
  assert.equal(repairs.filter(r => r.to === 'absolute (local child coordinates)').length, 2);
});

test('flat lists with parent-relative coordinates under layout-less groups get absolute layouts', () => {
  const draft = { pages: [{ nodes: [
    { id: 'header', name: 'Header', type: 'group', x: 0, y: 0, width: 390, height: 72 },
    { id: 'logo', name: 'Logo', type: 'text', parentId: 'header', x: 16, y: 16, width: 120, height: 36, text: 'SparkeMart' },
    { id: 'cats', name: 'Danh mục', type: 'group', x: 0, y: 80, width: 390, height: 116 },
    { id: 'cats-bg', name: 'BG', type: 'shape', parentId: 'cats', x: 0, y: 0, width: 390, height: 116 },
    { id: 'cat-1', name: 'Cat', type: 'group', parentId: 'cats', x: 8, y: 16, width: 44, height: 68 },
    { id: 'cat-1-icon', name: 'Icon', type: 'icon', parentId: 'cat-1', x: 4, y: 0, width: 36, height: 36 },
    { id: 'grid', name: 'Grid', type: 'group', x: 0, y: 220, width: 390, height: 420 },
    // Undersized list: the third row of cards ends at y 536, past the 360 px box.
    { id: 'list', name: 'List', type: 'group', parentId: 'grid', x: 0, y: 44, width: 390, height: 360 },
    { id: 'card-1', name: 'Card 1', type: 'group', parentId: 'list', x: 12, y: 0, width: 174, height: 170 },
    { id: 'card', name: 'Card', type: 'group', parentId: 'list', x: 204, y: 366, width: 174, height: 170 },
    { id: 'card-img', name: 'Img', type: 'image', parentId: 'card', x: 0, y: 0, width: 174, height: 100 },
    // Slight horizontal overflow, like a last category tile at x 358 in a 390 px row.
    { id: 'cat-8', name: 'Cat 8', type: 'group', parentId: 'cats', x: 358, y: 16, width: 44, height: 68 },
    // Page-space children under a layout-less group stay as they are.
    { id: 'footer', name: 'Footer', type: 'group', x: 0, y: 1490, width: 390, height: 300 },
    { id: 'footer-text', name: 'Text', type: 'text', parentId: 'footer', x: 16, y: 1510, width: 200, height: 20, text: 'Hỗ trợ' },
    // A flex parent is left alone even with local children.
    { id: 'row', name: 'Row', type: 'group', x: 0, y: 700, width: 390, height: 40, layout: { mode: 'flex', direction: 'row' } },
    { id: 'row-a', name: 'A', type: 'text', parentId: 'row', x: 0, y: 0, width: 100, height: 20, text: 'a' },
  ] }] };
  const repairs = repairGeneratedDocument(draft);
  const layoutOf = (id: string) => (draft.pages[0].nodes as Array<Record<string, unknown>>).find(n => n.id === id)!.layout;
  assert.equal(layoutOf('header'), undefined); // at 0,0 both readings coincide
  assert.deepEqual(layoutOf('cats'), { mode: 'absolute' });
  assert.deepEqual(layoutOf('cat-1'), { mode: 'absolute' });
  assert.deepEqual(layoutOf('grid'), { mode: 'absolute' });
  assert.deepEqual(layoutOf('list'), { mode: 'absolute' });
  assert.deepEqual(layoutOf('card'), { mode: 'absolute' });
  assert.equal(layoutOf('footer'), undefined);
  assert.deepEqual(layoutOf('row'), { mode: 'flex', direction: 'row' });
  assert.equal(repairs.filter(r => r.to === 'absolute (local child coordinates)').length, 5);
  const nodeOf = (id: string) => (draft.pages[0].nodes as Array<Record<string, unknown>>).find(n => n.id === id)!;
  assert.equal(nodeOf('list').height, 536); // grown to contain the third row
  assert.equal(nodeOf('list').width, 390); // never shrunk, unchanged when children fit
  assert.equal(nodeOf('cats').width, 402); // grown for the overflowing tile
  assert.equal(nodeOf('grid').height, 420); // list at y 44 with height 360 fit before growth was measured
  assert.equal(repairs.filter(r => r.path.endsWith('.width') || r.path.endsWith('.height')).length, 2);
});

test('missing layer names are derived and percent opacity becomes a fraction', () => {
  const draft = { pages: [{ nodes: [
    { id: 'a', type: 'text', text: '  Gợi ý   hôm nay  ' },
    { id: 'b', type: 'component', component: { name: 'Button', props: { label: 'Mua ngay' } } },
    { id: 'c', type: 'shape', opacity: 80 },
    { id: 'd', type: 'image', name: '' },
    { id: 'e', type: 'group', name: 'Header', opacity: 0.5 },
    { id: 'f', type: 'text', text: 'x'.repeat(100) },
  ] }] };
  const repairs = repairGeneratedDocument(draft);
  const nodes = draft.pages[0].nodes as Array<Record<string, unknown>>;
  assert.equal(nodes[0].name, 'Gợi ý hôm nay');
  assert.equal(nodes[1].name, 'Button');
  assert.equal(nodes[2].name, 'Shape');
  assert.equal(nodes[2].opacity, 0.8);
  assert.equal(nodes[3].name, 'Image');
  assert.equal(nodes[4].name, 'Header');
  assert.equal(nodes[4].opacity, 0.5);
  assert.equal((nodes[5].name as string).length, 60);
  assert.equal(repairs.filter(r => r.path.endsWith('.name')).length, 5);
  assert.equal(repairs.filter(r => r.path.endsWith('.opacity')).length, 1);
});

test('CSS-style colour keys are mapped onto the renderer keys without overriding explicit ones', () => {
  const draft = { pages: [{ nodes: [
    { id: 'a', name: 'BG', type: 'shape', style: { background: '#FFFFFF', borderColor: '#E0E0E0', borderWidth: 1, borderRadius: 4 } },
    { id: 'b', name: 'Brand', type: 'text', text: 'SparkeMart', style: { color: '#EE4D2D', fontSize: 24 } },
    { id: 'c', name: 'Keep', type: 'shape', style: { background: '#000000', fill: '#EE4D2D' } },
    { id: 'd', name: 'Card', type: 'frame', style: { backgroundColor: '$surface', color: '#123456' } },
    { id: 'e', name: 'Plain', type: 'text', text: 'x' },
  ] }] };
  const repairs = repairGeneratedDocument(draft);
  const styleOf = (id: string) => (draft.pages[0].nodes as Array<Record<string, unknown>>).find(n => n.id === id)!.style as Record<string, unknown> | undefined;
  assert.deepEqual(styleOf('a'), { fill: '#FFFFFF', stroke: '#E0E0E0', strokeWidth: 1, borderRadius: 4 });
  assert.deepEqual(styleOf('b'), { fill: '#EE4D2D', fontSize: 24 });
  assert.deepEqual(styleOf('c'), { fill: '#EE4D2D' }); // explicit fill wins; the alias is dropped
  assert.deepEqual(styleOf('d'), { fill: '$surface', color: '#123456' }); // color only means fill on text and icon nodes
  assert.equal(styleOf('e'), undefined);
  assert.equal(repairs.filter(r => r.path.includes('.style.')).length, 5);
});

test('CSS flexbox vocabulary in layouts is mapped onto the accepted enum values', () => {
  const draft = { pages: [{
    layout: { mode: 'flex', direction: 'vertical', justify: 'space-around', align: 'flex-start', wrap: 'wrap' },
    nodes: [
      { id: 'a', name: 'Row', type: 'group', layout: { mode: 'flexbox', direction: 'horizontal', justify: 'flex-end', align: 'baseline', wrap: 'nowrap' } },
      { id: 'b', name: 'Ok', type: 'group', layout: { mode: 'grid', columns: 2, justify: 'center', align: 'stretch' } },
      { id: 'c', name: 'Unknown', type: 'group', layout: { mode: 'flex', justify: 'diagonal' } },
    ],
  }] };
  const repairs = repairGeneratedDocument(draft);
  assert.deepEqual(draft.pages[0].layout, { mode: 'flex', direction: 'column', justify: 'space-between', align: 'start', wrap: true });
  const nodes = draft.pages[0].nodes as Array<Record<string, unknown>>;
  assert.deepEqual(nodes[0].layout, { mode: 'flex', direction: 'row', justify: 'end', align: 'start', wrap: false });
  assert.deepEqual(nodes[1].layout, { mode: 'grid', columns: 2, justify: 'center', align: 'stretch' });
  assert.deepEqual(nodes[2].layout, { mode: 'flex', justify: 'diagonal' }); // unknown words are left for validation to report
  assert.equal(repairs.filter(r => /\.(mode|direction|justify|align|wrap)$/.test(r.path)).length, 9);
});

test('non-document shapes are ignored without throwing', () => {
  for (const input of [null, 42, 'text', [], {}, { pages: 'none' }, { pages: [null, 'x', { nodes: 'none' }] }]) {
    assert.deepEqual(repairGeneratedDocument(input), []);
  }
});
