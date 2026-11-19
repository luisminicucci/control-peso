import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { bmi, bmiLabel, dayLabel, dayKey, fmt, num, series, timeLabel, toLocalInput, trend } from '../lib.js';
import { Icon, LineChart, PageHead } from '../ui.jsx';

const RANGOS = [{ d: 30, l: '1 mes' }, { d: 90, l: '3 meses' }, { d: 365, l: '1 año' }, { d: 0, l: 'Todo' }];

export default function Body() {
  const { profile, metrics, addMetric, deleteMetric, setError } = useStore();
  const [kind, setKind] = useState('peso');
  const [value, setValue] = useState('');
  const [when, setWhen] = useState(toLocalInput());
  const [rango, setRango] = useState(90);
  const [busy, setBusy] = useState(false);

  const unit = kind === 'peso' ? 'kg' : 'cm';
  const all = useMemo(() => series(metrics, kind), [metrics, kind]);
  const pts = rango ? all.filter((p) => p.t >= Date.now() - rango * 864e5) : all;
  const tr = kind === 'peso' ? trend(all).filter((p) => !rango || p.t >= Date.now() - rango * 864e5) : [];

  const weights = series(metrics, 'peso');
  const waist = series(metrics, 'cintura');
  const last = weights.at(-1)?.v ?? (profile.start_weight ? Number(profile.start_weight) : null);
  const start = profile.start_weight ? Number(profile.start_weight) : weights[0]?.v;
  const goal = profile.goal_weight ? Number(profile.goal_weight) : null;
  const lost = start && last ? start - last : null;
  const progress = start && goal && last && start !== goal ? Math.max(0, Math.min(100, ((start - last) / (start - goal)) * 100)) : null;
  const b = bmi(last, Number(profile.height_cm));

  // Ritmo de las últimas 4 semanas sobre la tendencia.
  const trAll = trend(weights);
  const ref = trAll.filter((p) => p.t <= Date.now() - 28 * 864e5).at(-1) || trAll[0];
  const pace = trAll.length > 1 && ref && trAll.at(-1).t - ref.t > 6 * 864e5 ? ((trAll.at(-1).v - ref.v) / ((trAll.at(-1).t - ref.t) / (7 * 864e5))) : null;
  const weeksToGoal = pace && pace < -0.05 && goal && last > goal ? Math.ceil((last - goal) / -pace) : null;

  async function add(e) {
    e.preventDefault();
    const v = num(value);
    if (!v) return;
    setBusy(true);
    try {
      await addMetric(kind, v, { unit, measured_at: new Date(when).toISOString() });
      setValue('');
      setWhen(toLocalInput());
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <PageHead title="Cuerpo" sub="Peso y medidas" />

      <div className="kpis">
        <div className="card kpi"><span className="muted small">Peso actual</span><span className="kpi-num">{fmt(last, 1)} kg</span>{b && <span className="muted small">IMC {fmt(b, 1)} · {bmiLabel(b)}</span>}</div>
        <div className="card kpi"><span className="muted small">Bajaste</span><span className={'kpi-num' + (lost > 0 ? ' accent' : '')}>{lost == null ? '–' : `${lost > 0 ? '' : '+'}${fmt(Math.abs(lost), 1)} kg`}</span><span className="muted small">desde {fmt(start, 1)} kg</span></div>
        <div className="card kpi"><span className="muted small">Objetivo</span><span className="kpi-num">{goal ? fmt(goal, 1) + ' kg' : '–'}</span>
          {progress != null && <><div className="bar"><div style={{ width: progress + '%', background: 'var(--accent)' }} /></div><span className="muted small">{fmt(progress)}% del camino{weeksToGoal ? ` · ~${weeksToGoal} semanas a este ritmo` : ''}</span></>}
        </div>
        <div className="card kpi"><span className="muted small">Ritmo (4 semanas)</span><span className="kpi-num">{pace == null ? '–' : `${pace > 0 ? '+' : ''}${fmt(pace, 2)} kg/sem`}</span>
          <span className="muted small">{waist.length ? `Cintura: ${fmt(waist.at(-1).v, 1)} cm${waist.length > 1 ? ` (${fmt(waist.at(-1).v - waist[0].v, 1)})` : ''}` : 'Sin medidas de cintura'}</span></div>
      </div>

      <form className="card stack12" onSubmit={add}>
        <div className="segmented">
          <button type="button" className={kind === 'peso' ? 'on' : ''} onClick={() => setKind('peso')}>Peso</button>
          <button type="button" className={kind === 'cintura' ? 'on' : ''} onClick={() => setKind('cintura')}>Cintura</button>
        </div>
        <div className="row gap8 wrap">
          <label className="field compact">{kind === 'peso' ? 'Peso (kg)' : 'Cintura (cm, a la altura del ombligo)'}
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'peso' ? fmt(last, 1) : ''} required />
          </label>
          <label className="field compact">Fecha y hora
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        </div>
        <button className="btn primary" disabled={busy}><Icon name="plus" size={18} />Guardar {kind}</button>
        {kind === 'peso' && <span className="muted small">Consejo: pesate a la mañana, después de ir al baño y antes de desayunar. La línea gruesa del gráfico es la tendencia: mirá esa, no el número de cada día.</span>}
      </form>

      <section className="card stack12">
        <div className="row between wrap gap8">
          <span className="cardtitle">{kind === 'peso' ? 'Evolución del peso' : 'Evolución de la cintura'}</span>
          <div className="row gap4">{RANGOS.map((r) => <button key={r.d} type="button" className={'pill small' + (rango === r.d ? ' on' : '')} onClick={() => setRango(r.d)}>{r.l}</button>)}</div>
        </div>
        <LineChart unit={unit} goal={kind === 'peso' ? goal : null}
          series={kind === 'peso'
            ? [{ points: pts, color: 'var(--chart-dots)', dots: true, width: 1 }, { points: tr, color: 'var(--accent)', width: 3 }]
            : [{ points: pts, color: 'var(--accent)', dots: true }]} />
      </section>

      <section className="card flush">
        <div className="cardhead"><span className="cardtitle">Registros</span></div>
        {all.length === 0 && <p className="empty muted">Sin registros todavía.</p>}
        {[...all].reverse().slice(0, 60).map((p) => (
          <div key={p.id} className="exprow static">
            <span className="col grow"><span>{dayLabel(dayKey(p.at), true)}</span><span className="muted small">{timeLabel(p.at)}</span></span>
            <span className="amount">{fmt(p.v, 1)} {unit}</span>
            <button type="button" className="iconbtn" aria-label="Borrar" onClick={() => window.confirm('¿Borrar este registro?') && deleteMetric(p.id).catch((e) => setError(e.message))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}
