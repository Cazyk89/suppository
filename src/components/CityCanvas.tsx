import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import type { DefLookup } from '../lib/grid';
import { footprint, placementAt } from '../lib/grid';
import type { CityState, Underlay } from '../lib/types';
import type { Ghost, View, ViewMode } from './render';
import { drawCity, fitView, screenToGrid, themeFromCss } from './render';

export type Tool = 'select' | 'pan' | 'buildable' | 'blocked' | 'unknown' | 'road' | 'road2' | 'eraseRoad' | 'expansion' | 'wand' | 'place';

export interface CityCanvasHandle {
  fit: () => void;
  view: () => View;
}

interface Props {
  city: CityState;
  getDef: DefLookup;
  mode: ViewMode;
  tool?: Tool;
  selected?: string | null;
  bad?: Set<string>;
  disconnectedRoads?: Set<number>;
  underlays?: { img: CanvasImageSource; u: Underlay }[];
  ghostDef?: { defId: string; rot: 0 | 1 } | null;
  canPlace?: (defId: string, x: number, y: number, rot: 0 | 1) => boolean;
  diffAgainst?: CityState | null;
  onSelect?: (uid: string | null) => void;
  onPaint?: (cells: { x: number; y: number }[], phase: 'start' | 'move' | 'end') => void;
  onMove?: (uid: string, x: number, y: number) => void;
  onPlace?: (x: number, y: number) => void;
  onTapCell?: (x: number, y: number) => void;
  onViewChange?: (v: View) => void;
  height?: number | string;
}

/** Zoomable, pannable city grid. One finger: active tool. Two fingers: pan + pinch zoom. */
export const CityCanvas = forwardRef<CityCanvasHandle, Props>(function CityCanvas(props, ref) {
  const { city, getDef, mode, tool = 'select' } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [view, setView] = useState<View>({ mode, panX: 0, panY: 0, zoom: 1 });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [drag, setDrag] = useState<{ uid: string; x: number; y: number } | null>(null);
  const fitted = useRef<string>('');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'pan'; sx: number; sy: number; px: number; py: number; moved: boolean; hitUid: string | null }
    | { kind: 'pinch'; d: number; cx: number; cy: number; zoom: number; px: number; py: number }
    | { kind: 'paint'; last: string }
    | { kind: 'drag'; uid: string; ox: number; oy: number; moved: boolean; sx: number; sy: number }
    | { kind: 'place' }
    | null
  >(null);
  const viewRef = useRef(view);
  // Until the player pans or zooms, keep the whole city fitted as the canvas resizes.
  const userMoved = useRef(false);
  viewRef.current = view;

  const onViewChange = useRef(props.onViewChange);
  onViewChange.current = props.onViewChange;
  const doFit = useCallback(() => {
    const v = fitView(mode, city.width, city.height, size.w, size.h);
    userMoved.current = false;
    setView(v);
    onViewChange.current?.(v);
  }, [mode, city.width, city.height, size.w, size.h]);

  useImperativeHandle(ref, () => ({ fit: doFit, view: () => viewRef.current }), [doFit]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const key = `${mode}:${city.width}x${city.height}`;
    if (size.w > 0 && (fitted.current !== key || !userMoved.current)) {
      fitted.current = key;
      doFit();
    }
  }, [mode, city.width, city.height, size.w, size.h, doFit]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const raf = requestAnimationFrame(() =>
      drawCity(ctx, city, getDef, view, {
        selected: props.selected,
        bad: props.bad,
        disconnectedRoads: props.disconnectedRoads,
        underlays: props.underlays,
        ghost,
        drag,
        diffAgainst: props.diffAgainst,
        theme: themeFromCss(),
      }, size.w, size.h),
    );
    return () => cancelAnimationFrame(raf);
  }, [city, getDef, view, size, ghost, drag, props.selected, props.bad, props.disconnectedRoads, props.underlays, props.diffAgainst]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cellAt = (sx: number, sy: number) => {
    const [gx, gy] = screenToGrid(viewRef.current, sx, sy);
    return { x: Math.floor(gx), y: Math.floor(gy), fx: gx, fy: gy };
  };
  const setV = (v: View) => {
    userMoved.current = true;
    setView(v);
    props.onViewChange?.(v);
  };

  const ghostFor = (sx: number, sy: number): Ghost | null => {
    if (!props.ghostDef) return null;
    const def = getDef(props.ghostDef.defId);
    const f = footprint({ uid: '', defId: props.ghostDef.defId, x: 0, y: 0, rot: props.ghostDef.rot, locked: false, origin: 'manual' }, def) ?? { w: 1, h: 1 };
    const c = cellAt(sx, sy);
    const x = Math.round(c.fx - f.w / 2);
    const y = Math.round(c.fy - f.h / 2);
    return { ...props.ghostDef, x, y, ok: props.canPlace ? props.canPlace(props.ghostDef.defId, x, y, props.ghostDef.rot) : true };
  };

  const onDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      // Second finger cancels the one-finger action and starts pinch.
      if (gesture.current?.kind === 'paint') props.onPaint?.([], 'end');
      setDrag(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        d: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        zoom: viewRef.current.zoom,
        px: viewRef.current.panX,
        py: viewRef.current.panY,
      };
      return;
    }
    if (pointers.current.size > 2) return;
    const c = cellAt(p.x, p.y);
    if (tool === 'select' || tool === 'pan') {
      const hit = tool === 'select' ? placementAt(city, getDef, c.x, c.y) : undefined;
      if (hit && hit.uid === props.selected && !hit.locked && props.onMove) {
        gesture.current = { kind: 'drag', uid: hit.uid, ox: c.x - hit.x, oy: c.y - hit.y, moved: false, sx: p.x, sy: p.y };
      } else {
        gesture.current = { kind: 'pan', sx: p.x, sy: p.y, px: viewRef.current.panX, py: viewRef.current.panY, moved: false, hitUid: hit?.uid ?? null };
      }
    } else if (tool === 'place') {
      gesture.current = { kind: 'place' };
      setGhost(ghostFor(p.x, p.y));
    } else if (tool === 'wand') {
      gesture.current = null;
      props.onTapCell?.(c.x, c.y);
    } else {
      gesture.current = { kind: 'paint', last: `${c.x},${c.y}` };
      props.onPaint?.([{ x: c.x, y: c.y }], 'start');
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (!pointers.current.has(e.pointerId)) {
      if (tool === 'place' && e.pointerType === 'mouse') setGhost(ghostFor(p.x, p.y));
      return;
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const zoom = Math.max(0.1, Math.min(8, (g.zoom * d) / (g.d || 1)));
      const k = zoom / g.zoom;
      setV({ mode, zoom, panX: cx - (g.cx - g.px) * k, panY: cy - (g.cy - g.py) * k });
    } else if (g.kind === 'pan') {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) > 6) g.moved = true;
      if (g.moved) setV({ ...viewRef.current, panX: g.px + p.x - g.sx, panY: g.py + p.y - g.sy });
    } else if (g.kind === 'drag') {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) > 4) g.moved = true;
      const c = cellAt(p.x, p.y);
      setDrag({ uid: g.uid, x: c.x - g.ox, y: c.y - g.oy });
    } else if (g.kind === 'paint') {
      const c = cellAt(p.x, p.y);
      const key = `${c.x},${c.y}`;
      if (key !== g.last) {
        g.last = key;
        props.onPaint?.([{ x: c.x, y: c.y }], 'move');
      }
    } else if (g.kind === 'place') {
      setGhost(ghostFor(p.x, p.y));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      if (g?.kind === 'pinch') gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'pan' && !g.moved) props.onSelect?.(g.hitUid);
    else if (g.kind === 'drag') {
      if (g.moved) {
        const c = cellAt(p.x, p.y);
        props.onMove?.(g.uid, c.x - g.ox, c.y - g.oy);
      }
      setDrag(null);
    } else if (g.kind === 'paint') props.onPaint?.([], 'end');
    else if (g.kind === 'place') {
      const gh = ghostFor(p.x, p.y);
      setGhost(null);
      if (gh) props.onPlace?.(gh.x, gh.y);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    const v = viewRef.current;
    const zoom = Math.max(0.1, Math.min(8, v.zoom * Math.exp(-e.deltaY * 0.0015)));
    const k = zoom / v.zoom;
    setV({ mode, zoom, panX: p.x - (p.x - v.panX) * k, panY: p.y - (p.y - v.panY) * k });
  };

  useEffect(() => {
    if (tool !== 'place') setGhost(null);
  }, [tool]);

  return (
    <div ref={wrap} className="city-canvas" style={{ height: props.height ?? '60vh' }}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => tool === 'place' && !pointers.current.size && setGhost(null)}
        onWheel={onWheel}
      />
      <div className="canvas-tools">
        <button className="icon-btn" onClick={() => setV({ ...view, zoom: Math.min(8, view.zoom * 1.25), panX: size.w / 2 - (size.w / 2 - view.panX) * 1.25, panY: size.h / 2 - (size.h / 2 - view.panY) * 1.25 })} aria-label="Zoom in">＋</button>
        <button className="icon-btn" onClick={() => setV({ ...view, zoom: view.zoom / 1.25, panX: size.w / 2 - (size.w / 2 - view.panX) / 1.25, panY: size.h / 2 - (size.h / 2 - view.panY) / 1.25 })} aria-label="Zoom out">－</button>
        <button className="icon-btn" onClick={doFit} aria-label="Fit to screen">⤢</button>
      </div>
    </div>
  );
});
