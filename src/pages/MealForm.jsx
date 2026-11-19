import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useStore } from '../store.jsx';
import { MEAL_TYPES, dayKey, fmt, guessMealType, nowLocalString, num, sumItems, toLocalInput } from '../lib.js';
import { Icon, speechSupported, useSpeech } from '../ui.jsx';

const NUTS = [
  { k: 'protein_g', l: 'Prot.' },
  { k: 'carbs_g', l: 'Carbos' },
  { k: 'fat_g', l: 'Grasas' },
  { k: 'fiber_g', l: 'Fibra' },
  { k: 'alcohol_g', l: 'Alcohol' }
];
const SCALE = ['grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'alcohol_g'];

const fromIA = (it) => ({
  name: it.nombre, quantity: it.cantidad, unit: it.unidad, grams: it.gramos, kcal: Math.round(it.kcal),
  protein_g: it.proteinas_g, carbs_g: it.carbos_g, fat_g: it.grasas_g, fiber_g: it.fibra_g, alcohol_g: it.alcohol_g
});
const blank = () => ({ name: '', quantity: 1, unit: 'porción', grams: null, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, alcohol_g: 0 });

export default function MealForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { meals, saveMeal, deleteMeal, addMetric } = useStore();
  const existing = id ? meals.find((m) => m.id === id) : null;

  const dia = params.get('dia');
  const initialDate = existing ? new Date(existing.eaten_at)
    : dia ? new Date(dia + 'T' + new Date().toTimeString().slice(0, 5)) : new Date();

  const [text, setText] = useState(existing?.raw_text || '');
  const [items, setItems] = useState(existing?.items?.map((i) => ({ ...i })) || []);
  const [mealType, setMealType] = useState(existing?.meal_type || guessMealType(initialDate));
  const [when, setWhen] = useState(toLocalInput(initialDate));
  const [source, setSource] = useState(existing?.source || 'texto');
  const [extras, setExtras] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [draft, setDraft] = useState('');

  const speech = useSpeech({ onText: (t) => { setSource('voz'); analizar(t); } });

  // Si venimos del botón de micrófono, empezamos a escuchar de una.
  useEffect(() => {
    if (!id && params.get('voz') === '1' && speechSupported) speech.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analizar(t) {
    const nuevo = (t ?? draft).trim();
    if (!nuevo) return;
    setBusy('ia'); setMsg('');
    try {
      const r = await api('analizar', { texto: nuevo, ahora: nowLocalString() });
      setText((prev) => (prev ? prev + '. ' + nuevo : nuevo));
      setItems((prev) => [...prev, ...r.items.map(fromIA)]);
      if (!existing && items.length === 0 && r.tipo_comida && r.tipo_comida !== 'ninguna') setMealType(r.tipo_comida);
      if (r.momento && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.momento)) setWhen(r.momento.slice(0, 16));
      const ex = {};
      if (r.agua_ml > 0) ex.agua = { v: r.agua_ml, on: true };
      if (r.peso_kg) ex.peso = { v: r.peso_kg, on: true };
      if (r.cintura_cm) ex.cintura = { v: r.cintura_cm, on: true };
      setExtras((prev) => ({ ...prev, ...ex }));
      setNote(r.aclaracion || '');
      if (!r.items.length && !Object.keys(ex).length) setMsg('No encontré comidas en lo que dijiste. Probá de nuevo o escribilo.');
      if (t === undefined) setDraft('');
    } catch (e) {
      setText((prev) => prev || nuevo);
      setMsg(e.message);
    } finally {
      setBusy('');
    }
  }

  function upd(i, k, v) {
    setItems((list) => list.map((it, j) => {
      if (j !== i) return it;
      if (k === 'quantity') {
        const q = num(v);
        const old = num(it.quantity);
        if (q && old) {
          const f = q / old;
          const n = { ...it, quantity: v };
          for (const s of SCALE) if (it[s] != null) n[s] = Math.round(Number(it[s]) * f * 10) / 10;
          n.kcal = Math.round(n.kcal);
          return n;
        }
      }
      return { ...it, [k]: v };
    }));
  }

  const total = useMemo(() => sumItems(items.map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, num(v) ?? v])))), [items]);

  async function guardar() {
    setBusy('save'); setMsg('');
    try {
      const at = new Date(when).toISOString();
      if (items.length) {
        await saveMeal({
          id: existing?.id, eaten_at: at, meal_type: mealType, raw_text: text || null, source,
          items: items.map((i) => ({ ...i, quantity: num(i.quantity), grams: num(i.grams), kcal: num(i.kcal) || 0, ...Object.fromEntries(NUTS.map((n) => [n.k, num(i[n.k]) || 0])) }))
        });
      } else if (existing) {
        await deleteMeal(existing.id);
      }
      const units = { agua: 'ml', peso: 'kg', cintura: 'cm' };
      for (const [k, x] of Object.entries(extras)) if (x.on && num(x.v)) await addMetric(k, num(x.v), { unit: units[k], measured_at: at, source: source === 'voz' ? 'voz' : 'manual' });
      nav(dayKey(at) === dayKey() ? '/' : '/?dia=' + dayKey(at));
    } catch (e) {
      setMsg(e.message);
      setBusy('');
    }
  }

  async function borrar() {
    if (!existing || !window.confirm('¿Borrar esta comida?')) return;
    setBusy('save');
    try { await deleteMeal(existing.id); nav(-1); } catch (e) { setMsg(e.message); setBusy(''); }
  }

  if (id && !existing) return <div className="page"><p className="muted">No encontré esa comida.</p></div>;

  const hasExtras = Object.keys(extras).length > 0;

  return (
    <div className="page formpage">
      <div className="formhead">
        <button type="button" className="iconbtn" aria-label="Volver" onClick={() => nav(-1)}><Icon name="close" /></button>
        <span className="formtitle">{existing ? 'Editar comida' : 'Registrar comida'}</span>
        {existing ? <button type="button" className="iconbtn danger-ic" aria-label="Borrar" onClick={borrar}><Icon name="trash" size={20} /></button> : <span style={{ width: 44 }} />}
      </div>

      <section className="voicebox">
        <button type="button" className={'micbtn' + (speech.listening ? ' on' : '')} disabled={busy === 'ia' || !speechSupported}
          onClick={() => (speech.listening ? speech.stop() : speech.start())} aria-label={speech.listening ? 'Terminar' : 'Hablar'}>
          <Icon name={speech.listening ? 'stop' : 'mic'} size={34} />
        </button>
        <div className="voicetext">
          {speech.listening ? (speech.interim || <span className="muted">Te escucho… decí qué comiste y tocá el botón para terminar.</span>)
            : busy === 'ia' ? <span className="muted">Calculando calorías y nutrientes…</span>
            : items.length ? <span className="muted">¿Algo más? Tocá el micrófono para sumar.</span>
            : speechSupported ? <span className="muted">Tocá el micrófono y contá qué comiste, o escribilo abajo.</span>
            : <span className="muted">Este navegador no tiene dictado: escribilo abajo (en el celu podés usar el micrófono del teclado).</span>}
        </div>
      </section>
      {speech.err && <p className="note">{speech.err}</p>}

      <div className="row gap8">
        <input className="inline-input grow" placeholder='Ej: "dos empanadas de carne y una coca chica"' value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setSource('texto'); analizar(); } }} />
        <button type="button" className="btn" disabled={busy === 'ia' || !draft.trim()} onClick={() => { setSource('texto'); analizar(); }}>
          <Icon name="sparkle" size={18} />Analizar
        </button>
      </div>

      {text && <p className="muted small">“{text}”</p>}
      {note && <p className="note small">{note}</p>}
      {msg && <div className="alert">{msg}</div>}

      {(items.length > 0 || existing) && (
        <>
          <div className="chiprow">
            {MEAL_TYPES.map((t) => <button key={t.id} type="button" className={'pill' + (mealType === t.id ? ' on' : '')} onClick={() => setMealType(t.id)}>{t.label}</button>)}
          </div>

          <section className="card flush">
            {items.map((it, i) => (
              <div key={i} className="itemrow">
                <div className="row gap8">
                  <input className="inline-input grow strong" value={it.name} placeholder="Alimento" onChange={(e) => upd(i, 'name', e.target.value)} />
                  <button type="button" className="iconbtn" aria-label="Quitar" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="close" size={18} /></button>
                </div>
                <div className="itemgrid">
                  <label>Cant.<input inputMode="decimal" value={it.quantity ?? ''} onChange={(e) => upd(i, 'quantity', e.target.value)} /></label>
                  <label className="wide">Unidad<input value={it.unit ?? ''} onChange={(e) => upd(i, 'unit', e.target.value)} /></label>
                  <label>g/ml<input inputMode="decimal" value={it.grams ?? ''} onChange={(e) => upd(i, 'grams', e.target.value)} /></label>
                  <label className="kcal">kcal<input inputMode="numeric" value={it.kcal ?? ''} onChange={(e) => upd(i, 'kcal', e.target.value)} /></label>
                  {NUTS.map((n) => (n.k !== 'alcohol_g' || Number(it.alcohol_g) > 0) && (
                    <label key={n.k}>{n.l}<input inputMode="decimal" value={it[n.k] ?? ''} onChange={(e) => upd(i, n.k, e.target.value)} /></label>
                  ))}
                </div>
              </div>
            ))}
            <div className="itemfoot row between wrap gap8">
              <button type="button" className="btn small link" onClick={() => setItems([...items, blank()])}><Icon name="plus" size={16} />Agregar a mano</button>
              <span className="strong">{fmt(total.kcal)} kcal <span className="muted small">· P {fmt(total.protein_g)} · C {fmt(total.carbs_g)} · G {fmt(total.fat_g)}</span></span>
            </div>
          </section>
        </>
      )}

      {hasExtras && (
        <section className="card stack8">
          <span className="cardtitle">También anoto</span>
          {[['agua', 'Agua', 'ml'], ['peso', 'Peso', 'kg'], ['cintura', 'Cintura', 'cm']].map(([k, l, u]) => extras[k] && (
            <label key={k} className="check">
              <input type="checkbox" checked={extras[k].on} onChange={(e) => setExtras({ ...extras, [k]: { ...extras[k], on: e.target.checked } })} />
              {l}: <input className="inline-input mini" inputMode="decimal" value={extras[k].v} onChange={(e) => setExtras({ ...extras, [k]: { ...extras[k], v: e.target.value } })} /> {u}
            </label>
          ))}
        </section>
      )}

      {(items.length > 0 || hasExtras || existing) && (
        <>
          <label className="field">Fecha y hora
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="formactions">
            <button type="button" className="btn primary grow" disabled={!!busy} onClick={guardar}>
              {busy === 'save' ? 'Guardando…' : <><Icon name="check" size={20} />Guardar</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
