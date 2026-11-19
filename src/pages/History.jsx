import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { dayKey, dayLabel, fmt, fmtL } from '../lib.js';
import { PageHead } from '../ui.jsx';
import { MealRow } from './Today.jsx';

export default function History() {
  const { meals, totals, profile } = useStore();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(21);
  const goal = profile.kcal_goal || 2000;

  const days = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? meals.filter((m) => (m.raw_text || '').toLowerCase().includes(s) || (m.items || []).some((i) => i.name.toLowerCase().includes(s))) : meals;
    const by = new Map();
    for (const m of list) {
      const k = dayKey(m.eaten_at);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(m);
    }
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [meals, q]);

  return (
    <div className="page">
      <PageHead title="Comidas" sub="Historial" />
      <input className="inline-input" placeholder="Buscar (ej: pizza, cerveza…)" value={q} onChange={(e) => setQ(e.target.value)} />
      {days.length === 0 && <p className="muted">{q ? 'No encontré comidas con eso.' : 'Todavía no registraste comidas.'}</p>}
      {days.slice(0, limit).map(([k, list]) => {
        const t = totals[k] || {};
        return (
          <section key={k} className="card flush">
            <Link to={k === dayKey() ? '/' : '/?dia=' + k} className="cardhead row between dayhead">
              <span className="cardtitle">{dayLabel(k, true)}</span>
              <span className={'small strong' + (t.kcal > goal * 1.05 ? ' warn' : '')}>{fmt(t.kcal)} / {fmt(goal)} kcal{t.agua ? <span className="muted"> · {fmtL(t.agua)}</span> : null}</span>
            </Link>
            {list.sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at)).map((m) => <MealRow key={m.id} m={m} />)}
          </section>
        );
      })}
      {days.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + 30)}>Ver más días</button>}
    </div>
  );
}
