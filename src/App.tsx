import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { Dashboard } from './pages/Dashboard';
import { MyCity } from './pages/MyCity';
import { Inventory } from './pages/Inventory';
import { Optimizer } from './pages/Optimizer';
import { Buildings } from './pages/Buildings';
import { Recommendations } from './pages/Recommendations';
import { Layouts } from './pages/Layouts';

const ROUTES = [
  { id: 'dashboard', label: 'Home', ico: '◉', el: Dashboard },
  { id: 'city', label: 'My City', ico: '▦', el: MyCity },
  { id: 'inventory', label: 'Inventory', ico: '☰', el: Inventory },
  { id: 'optimizer', label: 'Optimize', ico: '⚙', el: Optimizer },
  { id: 'buildings', label: 'Buildings', ico: '⌂', el: Buildings },
  { id: 'plan', label: 'Plan', ico: '✓', el: Recommendations },
  { id: 'layouts', label: 'Layouts', ico: '⧉', el: Layouts },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

export function go(route: RouteId, param?: string) {
  location.hash = `#/${route}${param ? '/' + encodeURIComponent(param) : ''}`;
}

function parseHash(): { route: RouteId; param?: string } {
  const [, r, p] = location.hash.split('/');
  const route = (ROUTES.find((x) => x.id === r)?.id ?? 'dashboard') as RouteId;
  return { route, param: p ? decodeURIComponent(p) : undefined };
}

export function App() {
  const [loc, setLoc] = useState(parseHash);
  const { saved } = useStore();
  useEffect(() => {
    const on = () => {
      setLoc(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const R = ROUTES.find((r) => r.id === loc.route)!;
  const Page = R.el;
  return (
    <div className="app">
      <header className="topbar">
        <span className="title">FoE City Optimizer · {R.label}</span>
        <span className="save-dot">{saved === 'saved' ? 'Saved' : saved === 'saving' ? 'Saving…' : '⚠ Save failed'}</span>
      </header>
      <main>
        <Page param={loc.param} />
      </main>
      <nav className="tabs">
        {ROUTES.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === loc.route ? 'active' : ''}>
            <span className="ico" aria-hidden>{r.ico}</span>
            {r.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
