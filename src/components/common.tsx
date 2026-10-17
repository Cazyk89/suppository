import { useEffect, useState } from 'react';
import { blobGet } from '../lib/storage';
import type { CategoryValues } from '../lib/scoring';
import type { Underlay, VerifyStatus } from '../lib/types';

export function fmt(n: number, d = 1): string {
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(d).replace(/\.0+$/, '');
}

export function StatusBadge({ s }: { s: VerifyStatus }) {
  return <span className={`badge ${s === 'verified' ? 'good' : s === 'user' ? 'warn' : 'bad'}`}>{s === 'verified' ? 'verified' : s === 'user' ? 'user-entered' : 'unknown'}</span>;
}

export const CAT_NAMES: Record<keyof CategoryValues, string> = {
  military: 'Military (mode-weighted att+def %)',
  fp: 'Forge Points / day',
  goods: 'Goods / day',
  other: 'Other value pts',
};

export function CategoryTable({ base, next }: { base: CategoryValues; next?: CategoryValues }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>{next ? 'Current' : 'Value'}</th>
          {next && <th>Proposed</th>}
          {next && <th>Δ</th>}
        </tr>
      </thead>
      <tbody>
        {(Object.keys(CAT_NAMES) as (keyof CategoryValues)[]).map((k) => {
          const d = next ? next[k] - base[k] : 0;
          return (
            <tr key={k}>
              <td>{CAT_NAMES[k]}</td>
              <td>{fmt(base[k])}</td>
              {next && <td>{fmt(next[k])}</td>}
              {next && <td className={d > 1e-6 ? 'good' : d < -1e-6 ? 'bad' : 'muted'}>{d > 0 ? '+' : ''}{fmt(d)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Loads underlay screenshot blobs into drawable images. */
export function useUnderlayImages(underlays: Underlay[]) {
  const [imgs, setImgs] = useState<Map<string, HTMLImageElement>>(new Map());
  const keys = underlays.map((u) => u.blobKey).join('|');
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    Promise.all(
      underlays.map(async (u) => {
        const b = await blobGet(u.blobKey);
        if (!b) return null;
        const url = URL.createObjectURL(b);
        urls.push(url);
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        return [u.blobKey, img] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setImgs(new Map(pairs.filter((x): x is readonly [string, HTMLImageElement] => !!x)));
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return underlays.filter((u) => imgs.has(u.blobKey)).map((u) => ({ img: imgs.get(u.blobKey)!, u }));
}

export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog">
        <div className="row between">
          <span />
          <button className="sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </>
  );
}
