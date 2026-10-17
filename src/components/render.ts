import { displayName, statsOf } from '../lib/buildingDb';
import type { DefLookup } from '../lib/grid';
import { footprint } from '../lib/grid';
import type { BuildingDef, CityState, Placement, Underlay } from '../lib/types';
import { ROAD_1, ROAD_2, TERRAIN_BLOCKED, TERRAIN_BUILDABLE } from '../lib/types';

export type ViewMode = 'iso' | 'top';

/** Pixels per tile before zoom. Iso tiles are 2:1 diamonds like the game's grid. */
export const TOP_T = 24;
export const ISO_W = 48;
export const ISO_H = 24;

export interface View {
  mode: ViewMode;
  panX: number;
  panY: number;
  zoom: number;
}

/** Grid coordinates -> unzoomed world pixels. */
export function gridToWorld(mode: ViewMode, x: number, y: number): [number, number] {
  return mode === 'top' ? [x * TOP_T, y * TOP_T] : [((x - y) * ISO_W) / 2, ((x + y) * ISO_H) / 2];
}

export function worldToGrid(mode: ViewMode, wx: number, wy: number): [number, number] {
  if (mode === 'top') return [wx / TOP_T, wy / TOP_T];
  const a = wx / (ISO_W / 2);
  const b = wy / (ISO_H / 2);
  return [(a + b) / 2, (b - a) / 2];
}

export function screenToGrid(v: View, sx: number, sy: number): [number, number] {
  return worldToGrid(v.mode, (sx - v.panX) / v.zoom, (sy - v.panY) / v.zoom);
}

/** World-space bounding box of the whole grid. */
export function gridBounds(mode: ViewMode, w: number, h: number) {
  const pts = [gridToWorld(mode, 0, 0), gridToWorld(mode, w, 0), gridToWorld(mode, 0, h), gridToWorld(mode, w, h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function fitView(mode: ViewMode, w: number, h: number, cw: number, ch: number, pad = 16): View {
  const b = gridBounds(mode, w, h);
  const zoom = Math.min((cw - pad * 2) / (b.maxX - b.minX), (ch - pad * 2) / (b.maxY - b.minY));
  return {
    mode,
    zoom,
    panX: (cw - (b.maxX - b.minX) * zoom) / 2 - b.minX * zoom,
    panY: (ch - (b.maxY - b.minY) * zoom) / 2 - b.minY * zoom,
  };
}

export type ColorCat = 'townhall' | 'gb' | 'military' | 'fp' | 'goods' | 'other' | 'deco' | 'unknown';

export const CAT_COLORS: Record<ColorCat, string> = {
  townhall: '#d4a72c',
  gb: '#8a63d2',
  military: '#cf4a3c',
  fp: '#e3b341',
  goods: '#3f8fd2',
  other: '#3fa37a',
  deco: '#7cbf6b',
  unknown: '#8b949e',
};

export const CAT_LABELS: Record<ColorCat, string> = {
  townhall: 'Town Hall',
  gb: 'Great Building',
  military: 'Mostly military',
  fp: 'Mostly Forge Points',
  goods: 'Mostly goods',
  other: 'Other / resources',
  deco: 'Decoration',
  unknown: 'Stats unknown',
};

export function colorCat(def: BuildingDef | undefined): ColorCat {
  if (!def) return 'unknown';
  if (def.kind === 'townhall') return 'townhall';
  if (def.kind === 'greatbuilding') return 'gb';
  if (def.statsStatus === 'unknown') return 'unknown';
  const s = statsOf(def);
  const mil = s.attAtk + s.attDef + s.gbgAtk + s.gbgDef + s.geAtk + s.geDef + s.qiAtk + s.qiDef + s.defAtk + s.defDef;
  // Rough display-only comparison: 1 FP ≈ 1% military ≈ 10 goods ≈ 10 other points.
  const scores: [ColorCat, number][] = [
    ['military', mil],
    ['fp', s.fp],
    ['goods', (s.goods + s.guildGoods) / 10],
    ['other', s.other / 10],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] <= 0) return def.kind === 'decoration' ? 'deco' : 'other';
  return scores[0][0];
}

export interface Ghost {
  defId: string;
  x: number;
  y: number;
  rot: 0 | 1;
  ok: boolean;
}

export interface DrawOptions {
  selected?: string | null;
  bad?: Set<string>;
  disconnectedRoads?: Set<number>;
  underlays?: { img: CanvasImageSource; u: Underlay }[];
  ghost?: Ghost | null;
  /** Placement uids to draw offset while dragging. */
  drag?: { uid: string; x: number; y: number } | null;
  /** Show diff colouring against another city (moved/new buildings). */
  diffAgainst?: CityState | null;
  labels?: boolean;
  theme: { bg: string; grid: string; text: string; buildable: string; blocked: string; unknown: string; road: string; road2: string };
}

function poly(ctx: CanvasRenderingContext2D, mode: ViewMode, x: number, y: number, w: number, h: number) {
  const p = [gridToWorld(mode, x, y), gridToWorld(mode, x + w, y), gridToWorld(mode, x + w, y + h), gridToWorld(mode, x, y + h)];
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
}

export function drawCity(ctx: CanvasRenderingContext2D, c: CityState, getDef: DefLookup, v: View, o: DrawOptions, cw: number, ch: number) {
  const { mode } = v;
  ctx.save();
  ctx.fillStyle = o.theme.bg;
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([v.zoom, 0, 0, v.zoom, v.panX, v.panY])));

  for (const { img, u } of o.underlays ?? []) {
    if (!u.visible) continue;
    ctx.save();
    ctx.globalAlpha = u.opacity;
    ctx.translate(u.x, u.y);
    ctx.rotate((u.rotation * Math.PI) / 180);
    ctx.scale(u.scale, u.scale);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  const hasUnderlay = (o.underlays ?? []).some((x) => x.u.visible);
  const W = c.width;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = c.roads[i];
      const t = c.terrain[i];
      let fill: string | null = null;
      if (r === ROAD_1) fill = o.theme.road;
      else if (r === ROAD_2) fill = o.theme.road2;
      else if (t === TERRAIN_BUILDABLE) fill = o.theme.buildable;
      else if (t === TERRAIN_BLOCKED) fill = o.theme.blocked;
      else if (!hasUnderlay) fill = o.theme.unknown;
      if (r && o.disconnectedRoads?.has(i)) fill = '#e5534b';
      if (!fill) continue;
      ctx.globalAlpha = hasUnderlay ? 0.55 : 1;
      ctx.fillStyle = fill;
      poly(ctx, mode, x, y, 1, 1);
      ctx.fill();
    }
  ctx.globalAlpha = 1;

  if (v.zoom > 0.45) {
    ctx.strokeStyle = o.theme.grid;
    ctx.lineWidth = 1 / v.zoom;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const a = gridToWorld(mode, x, 0);
      const b = gridToWorld(mode, x, c.height);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let y = 0; y <= c.height; y++) {
      const a = gridToWorld(mode, 0, y);
      const b = gridToWorld(mode, W, y);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }

  const before = o.diffAgainst ? new Map(o.diffAgainst.placements.map((p) => [p.uid, p])) : null;
  const sorted = [...c.placements].sort((a, b) => a.x + a.y - (b.x + b.y));
  const labelQueue: { p: Placement; def: BuildingDef | undefined; f: { w: number; h: number }; x: number; y: number }[] = [];
  for (const p of sorted) {
    const def = getDef(p.defId);
    const f = footprint(p, def) ?? { w: 1, h: 1 };
    const pos = o.drag?.uid === p.uid ? o.drag : p;
    const cat = colorCat(def);
    poly(ctx, mode, pos.x, pos.y, f.w, f.h);
    ctx.fillStyle = CAT_COLORS[cat];
    ctx.globalAlpha = footprint(p, def) ? 0.9 : 0.4;
    ctx.fill();
    ctx.globalAlpha = 1;
    let stroke = 'rgba(0,0,0,0.55)';
    let lw = 1.5;
    if (before) {
      const b = before.get(p.uid);
      if (!b) {
        stroke = '#2ea043';
        lw = 3;
      } else if (b.x !== p.x || b.y !== p.y || b.rot !== p.rot || b.defId !== p.defId) {
        stroke = '#58a6ff';
        lw = 3;
      }
    }
    if (o.bad?.has(p.uid)) {
      stroke = '#ff4d4f';
      lw = 3;
      ctx.setLineDash([6 / v.zoom, 4 / v.zoom]);
    }
    if (o.selected === p.uid) {
      stroke = '#ffffff';
      lw = 3.5;
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw / v.zoom;
    ctx.stroke();
    ctx.setLineDash([]);
    labelQueue.push({ p, def, f, x: pos.x, y: pos.y });
  }

  if (o.ghost) {
    const def = getDef(o.ghost.defId);
    const f = footprint({ uid: '', defId: o.ghost.defId, x: 0, y: 0, rot: o.ghost.rot, locked: false, origin: 'manual' }, def) ?? { w: 1, h: 1 };
    poly(ctx, mode, o.ghost.x, o.ghost.y, f.w, f.h);
    ctx.fillStyle = o.ghost.ok ? 'rgba(46,160,67,0.55)' : 'rgba(229,83,75,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 / v.zoom;
    ctx.stroke();
  }

  if (o.labels !== false) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { p, def, f, x, y } of labelQueue) {
      const [cx, cy] = gridToWorld(mode, x + f.w / 2, y + f.h / 2);
      const px = Math.min(f.w, f.h) * (mode === 'top' ? TOP_T : ISO_H) * v.zoom;
      if (px < 26) continue;
      const size = Math.max(9, Math.min(14, px / 4)) / v.zoom;
      ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#0d1117';
      // Fit the label inside the footprint's narrowest on-screen width.
      const maxW = (Math.min(f.w, f.h) * (mode === 'top' ? TOP_T : ISO_W * 0.7)) * 0.92;
      let label = (p.locked ? '🔒 ' : '') + (def ? displayName(def) : p.defId);
      if (ctx.measureText(label).width > maxW) {
        while (label.length > 2 && ctx.measureText(label + '…').width > maxW) label = label.slice(0, -1);
        label = label.trimEnd() + '…';
      }
      ctx.fillText(label, cx, cy);
    }
  }
  ctx.restore();
}

/** Renders a full-size PNG of a layout (for export). */
export function renderLayoutPng(c: CityState, getDef: DefLookup, mode: ViewMode, theme: DrawOptions['theme'], diffAgainst?: CityState | null): Promise<Blob> {
  const b = gridBounds(mode, c.width, c.height);
  const zoom = mode === 'top' ? 1.4 : 1.2;
  const pad = 24;
  const cw = Math.ceil((b.maxX - b.minX) * zoom + pad * 2);
  const ch = Math.ceil((b.maxY - b.minY) * zoom + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  drawCity(ctx, c, getDef, { mode, zoom, panX: pad - b.minX * zoom, panY: pad - b.minY * zoom }, { theme, diffAgainst, labels: true }, cw, ch);
  return new Promise((resolve, reject) => canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('PNG export failed'))), 'image/png'));
}

export function themeFromCss(): DrawOptions['theme'] {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    bg: g('--canvas-bg', '#0f1620'),
    grid: g('--canvas-grid', 'rgba(255,255,255,0.08)'),
    text: g('--text', '#e6edf3'),
    buildable: g('--cell-buildable', '#2f4a33'),
    blocked: g('--cell-blocked', '#30363d'),
    unknown: g('--cell-unknown', '#18212c'),
    road: g('--cell-road', '#9c8a6c'),
    road2: g('--cell-road2', '#6f6253'),
  };
}
