import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { fmt, sumItems, timeLabel, dayLabel, dayKey, toLocalInput } from '../lib.js';
import { Icon } from '../ui.jsx';

// Ayuno intermitente. Cada ayuno es una fila en peso_metrics:
// kind = 'ayuno', measured_at = inicio, value = objetivo en horas, meta.end = fin (null mientras está en curso).

export const PROTOCOLOS = [12, 14, 16, 18, 20, 24];

export function horasMin(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

// Ayunos ordenados del más reciente al más viejo, con duración calculada.
export function useFasts() {
  const { metrics } = useStore();
  return useMemo(() => metrics.filter((m) => m.kind === 'ayuno').map((m) => {
    const start = new Date(m.measured_at).getTime();
    const end = m.meta?.end ? new Date(m.meta.end).getTime() : null;
    const target = m.value == null ? 16 : Number(m.value); // 0 = ayuno libre, sin objetivo
    return { ...m, start, end, target, libre: target === 0, ms: (end || Date.now()) - start };
  }).sort((a, b) => b.start - a.start), [metrics]);
}

function useNow(every = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}

export function FastCard() {
  const { meals, addMetric, updateMetric, deleteMetric, setError } = useStore();
  const fasts = useFasts();
  const tick = useNow();
  const now = Math.max(tick, Date.now());
  const active = fasts.find((f) => !f.end);
  const lastDone = fasts.find((f) => f.end);
  const lastMeal = useMemo(() => meals.find((m) => sumItems(m.items).kcal > 0 && new Date(m.eaten_at).getTime() <= now), [meals, now]);
  const [target, setTarget] = useState(() => { try { const v = localStorage.getItem('ayuno-objetivo'); return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : 16; } catch { return 16; } });
  const [desde, setDesde] = useState('comida');
  const [editing, setEditing] = useState(false);
  const [startEdit, setStartEdit] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  function empezar() {
    try { localStorage.setItem('ayuno-objetivo', String(target)); } catch { /* sin almacenamiento */ }
    const inicio = desde === 'comida' && lastMeal ? new Date(lastMeal.eaten_at) : new Date();
    run(() => addMetric('ayuno', target, { unit: 'h', measured_at: inicio.toISOString(), meta: { end: null } }));
  }

  if (active) {
    const ms = now - active.start;
    const goalMs = active.target * 3600e3;
    const libre = active.libre;
    const pct = libre ? 100 : Math.max(0, Math.min(100, (ms / goalMs) * 100));
    const listo = !libre && ms >= goalMs;
    const fin = new Date(active.start + goalMs);
    return (
      <section className="card stack12 fastcard">
        <div className="row between baseline">
          <span className="cardtitle row gap6"><Icon name="clock" size={18} className="fast-ic" />Ayuno en curso</span>
          <span className="muted small">{libre ? 'libre, sin objetivo' : `objetivo ${active.target} h`}</span>
        </div>
        <div className="row between baseline wrap gap8">
          <span className="fast-num">{horasMin(ms)}</span>
          <span className={'small strong' + (listo ? ' accent' : ' muted')}>
            {libre ? 'cortalo cuando quieras' : listo ? '¡Objetivo cumplido! 🎉' : `faltan ${horasMin(goalMs - ms)} · ${dayKey(fin) === dayKey() ? 'hoy' : dayLabel(dayKey(fin)).toLowerCase()} ${timeLabel(fin)}`}
          </span>
        </div>
        {!libre && <div className="bar fastbar"><div style={{ width: pct + '%', background: listo ? 'var(--accent)' : 'var(--fast)' }} /></div>}
        <span className="muted small">Empezó {dayLabel(dayKey(active.start)).toLowerCase()} a las {timeLabel(active.start)}<br />Si registrás una comida, el ayuno termina solo</span>
        {editing ? (
          <div className="row gap8 wrap">
            <input type="datetime-local" className="inline-input grow" value={startEdit} onChange={(e) => setStartEdit(e.target.value)} />
            <button type="button" className="btn small primary" disabled={busy} onClick={() => run(async () => { await updateMetric(active.id, { measured_at: new Date(startEdit).toISOString() }); setEditing(false); })}>Guardar</button>
            <button type="button" className="btn small link" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        ) : (
          <div className="row gap8 wrap">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => run(() => updateMetric(active.id, { meta: { ...active.meta, end: new Date().toISOString() } }))}>Terminar ayuno</button>
            <button type="button" className="btn small" onClick={() => { setStartEdit(toLocalInput(new Date(active.start))); setEditing(true); }}>Cambiar inicio</button>
            <button type="button" className="btn small link" disabled={busy} onClick={() => window.confirm('¿Descartar este ayuno?') && run(() => deleteMetric(active.id))}>Descartar</button>
          </div>
        )}
      </section>
    );
  }

  const desdeComida = lastMeal ? now - new Date(lastMeal.eaten_at).getTime() : null;
  return (
    <section className="card stack12 fastcard">
      <div className="row between baseline">
        <span className="cardtitle row gap6"><Icon name="clock" size={18} className="fast-ic" />Ayuno intermitente</span>
        {desdeComida != null && <span className="muted small">última comida hace {horasMin(desdeComida)}</span>}
      </div>
      <div className="chiprow">
        <button type="button" className={'pill small' + (target === 0 ? ' on' : '')} onClick={() => setTarget(0)}>Libre</button>
        {PROTOCOLOS.map((h) => <button key={h} type="button" className={'pill small' + (target === h ? ' on' : '')} onClick={() => setTarget(h)}>{h}:{24 - h > 0 ? 24 - h : 0}</button>)}
      </div>
      {lastMeal && (
        <div className="segmented">
          <button type="button" className={desde === 'comida' ? 'on' : ''} onClick={() => setDesde('comida')}>Desde la última comida ({timeLabel(lastMeal.eaten_at)})</button>
          <button type="button" className={desde === 'ahora' ? 'on' : ''} onClick={() => setDesde('ahora')}>Desde ahora</button>
        </div>
      )}
      <button type="button" className="btn primary" disabled={busy} onClick={empezar}><Icon name="clock" size={18} />{target ? `Empezar ayuno de ${target} h` : 'Empezar ayuno libre'}</button>
      {lastDone && (
        <span className="muted small">
          Último: {horasMin(lastDone.ms)} {lastDone.libre ? '(libre)' : lastDone.ms >= lastDone.target * 3600e3 ? '✓ cumplido' : `(objetivo ${lastDone.target} h)`}, terminó {dayLabel(dayKey(lastDone.end)).toLowerCase()} {timeLabel(lastDone.end)}
        </span>
      )}
    </section>
  );
}

// Resumen para Informes.
export function fastStats(fasts, desdeMs) {
  const done = fasts.filter((f) => f.end && f.start >= desdeMs);
  const horas = done.map((f) => f.ms / 3600e3);
  return {
    done,
    cantidad: done.length,
    cumplidos: done.filter((f) => !f.libre && f.ms >= f.target * 3600e3).length,
    conObjetivo: done.filter((f) => !f.libre),
    promedio: horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null,
    maximo: horas.length ? Math.max(...horas) : null
  };
}

export { fmt };
