import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DefLookup } from '../lib/grid';
import { defaultProject, migrate } from '../lib/project';
import { effectiveQty } from '../lib/inventory';
import { evaluateCity, potentialValues, referenceFrom } from '../lib/scoring';
import type { CategoryValues } from '../lib/scoring';
import { kvGet, kvSet, requestPersistence } from '../lib/storage';
import type { BuildingDef, CityState, Project } from '../lib/types';

const KEY = 'project';

interface Ctx {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  replace: (p: Project) => void;
  getDef: DefLookup;
  defMap: Map<string, BuildingDef>;
  baseline: CityState | null;
  /** Category references from the baseline (or current city) so scores read "100 = baseline". */
  ref: CategoryValues;
  saved: 'saved' | 'saving' | 'error';
  persistent: boolean;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [saved, setSaved] = useState<Ctx['saved']>('saved');
  const [persistent, setPersistent] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // The newest project not yet written to storage (null when everything is saved).
  const pending = useRef<Project | null>(null);

  useEffect(() => {
    kvGet<Project>(KEY)
      .then((p) => setProject(p ? migrate(p) : defaultProject()))
      .catch(() => setProject(defaultProject()));
    requestPersistence().then(setPersistent);
  }, []);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    kvSet(KEY, p).then(
      () => setSaved(pending.current ? 'saving' : 'saved'),
      () => setSaved('error'),
    );
  }, []);

  const persist = useCallback(
    (p: Project) => {
      setSaved('saving');
      pending.current = p;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 250);
    },
    [flush],
  );

  // Write immediately when the app is hidden or closed (iOS may suspend it right after).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  const update = useCallback(
    (fn: (p: Project) => Project) =>
      setProject((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        persist(next);
        return next;
      }),
    [persist],
  );
  const replace = useCallback((p: Project) => update(() => p), [update]);

  const value = useMemo<Ctx | null>(() => {
    if (!project) return null;
    const defMap = new Map(project.buildings.map((b) => [b.id, b]));
    const getDef: DefLookup = (id) => defMap.get(id);
    const baseline = project.layouts.find((l) => l.id === project.baselineId)?.city ?? null;
    const refCity = baseline ?? project.city;
    const potential = potentialValues(
      refCity.placements.map((p) => p.defId),
      project.inventory.filter((i) => i.category === 'building' && i.defId).map((i) => ({ defId: i.defId!, qty: effectiveQty(i) })),
      getDef,
      project.settings,
    );
    const ref = referenceFrom(evaluateCity(refCity, getDef, project.settings, null, project.sets).values, potential);
    return { project, update, replace, getDef, defMap, baseline, ref, saved, persistent };
  }, [project, update, replace, saved, persistent]);

  if (!value) return <div className="loading">Loading project…</div>;
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}
