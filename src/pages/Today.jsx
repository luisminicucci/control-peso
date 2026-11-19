import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { addDays, dayKey, dayLabel, fmt, fmtL, mealLabel, sumItems, timeLabel, tragos, ZERO, lastNDays } from '../lib.js';
import { Bar, Icon, Ring } from '../ui.jsx';
import { FastCard } from './Fast.jsx';

export const BEBIDAS = [
  { label: 'Cerveza (lata 473)', item: { name: 'Cerveza', quantity: 1, unit: 'lata 473 ml', grams: 473, kcal: 200, protein_g: 1.6, carbs_g: 17, fat_g: 0, fiber_g: 0, alcohol_g: 18.7 } },
  { label: 'Copa de vino', item: { name: 'Vino', quantity: 1, unit: 'copa 150 ml', grams: 150, kcal: 125, protein_g: 0.1, carbs_g: 4, fat_g: 0, fiber_g: 0, alcohol_g: 14.8 } },
  { label: 'Fernet con coca', item: { name: 'Fernet con coca', quantity: 1, unit: 'vaso', grams: 300, kcal: 250, protein_g: 0, carbs_g: 32, fat_g: 0, fiber_g: 0, alcohol_g: 18.5 } }
];

export default function Today() {
  const { profile, meals, metrics, totals, addMetric, deleteMetric, saveMeal, setError } = useStore();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const today = dayKey();
  const day = params.get('dia') || today;
  const isToday = day === today;
  const [busy, setBusy] = useState(false);

  const t = totals[day] || { ...ZERO, agua: 0 };
  const goal = profile.kcal_goal || 2000;
  const left = goal - t.kcal;
  const dayMeals = meals.filter((m) => dayKey(m.eaten_at) === day).sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at));
  const water = metrics.filter((m) => m.kind === 'agua' && dayKey(m.measured_at) === day);
  const weightToday = metrics.find((m) => m.kind === 'peso' && dayKey(m.measured_at) === day);

  // Alcohol: semana de lunes a domingo que contiene el día.
  const dow = (new Date(day + 'T12:00').getDay() + 6) % 7;
  const week = lastNDays(7, addDays(day, 6 - dow));
  const alcWeek = week.reduce((s, k) => s + (totals[k]?.alcohol_g || 0), 0);
  const limit = Number(profile.alcohol_week_limit ?? 7);

  function goDay(k) { setParams(k === today ? {} : { dia: k }); }
  const when = () => (isToday ? new Date() : new Date(day + 'T' + new Date().toTimeString().slice(0, 5))).toISOString();

  async function agua(ml) {
    setBusy(true);
    try { await addMetric('agua', ml, { unit: 'ml', measured_at: when() }); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function quitarAgua() {
    const last = water[0];
    if (!last) return;
    setBusy(true);
    try { await deleteMetric(last.id); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function bebida(b) {
    setBusy(true);
    try { await saveMeal({ eaten_at: when(), meal_type: 'bebida', source: 'manual', raw_text: b.label, items: [b.item] }); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div className="daypicker">
          <button type="button" className="iconbtn" aria-label="Día anterior" onClick={() => goDay(addDays(day, -1))}><Icon name="left" size={20} /></button>
          <div className="col">
            <span className="muted small">{isToday ? new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</span>
            <h1>{dayLabel(day)}</h1>
          </div>
          <button type="button" className="iconbtn" aria-label="Día siguiente" disabled={isToday} onClick={() => goDay(addDays(day, 1))}><Icon name="left" size={20} style={{ transform: 'scaleX(-1)' }} /></button>
        </div>
        <button type="button" className="btn primary desktop-only" onClick={() => nav('/registrar?voz=1' + (isToday ? '' : '&dia=' + day))}><Icon name="mic" size={20} />Registrar comida</button>
      </div>

      <div className="homegrid">
        <div className="stack16">
          <section className="hero">
            <div className="row gap16 wrap center-mobile">
              <Ring value={t.kcal} goal={goal}>
                <span className="hero-num">{fmt(t.kcal)}</span>
                <span className="hero-sub">de {fmt(goal)} kcal</span>
              </Ring>
              <div className="col gap10 grow">
                <span className="hero-big">{left >= 0 ? <>Te quedan <b>{fmt(left)}</b> kcal</> : <>Te pasaste <b className="warn-l">{fmt(-left)}</b> kcal</>}</span>
                <Macro label="Proteínas" v={t.protein_g} goal={profile.protein_goal || 100} />
                <Macro label="Carbohidratos" v={t.carbs_g} goal={Math.round(goal * 0.45 / 4)} />
                <Macro label="Grasas" v={t.fat_g} goal={Math.round(goal * 0.3 / 9)} />
                <Macro label="Fibra" v={t.fiber_g} goal={30} />
              </div>
            </div>
          </section>

          <section className="card flush">
            <div className="cardhead row between">
              <span className="cardtitle">Comidas</span>
              <Link to={'/registrar?voz=1' + (isToday ? '' : '&dia=' + day)} className="small strong">+ Agregar</Link>
            </div>
            {dayMeals.length === 0 && (
              <button type="button" className="emptymic" onClick={() => nav('/registrar?voz=1' + (isToday ? '' : '&dia=' + day))}>
                <span className="micbig"><Icon name="mic" size={30} /></span>
                <span className="muted">Tocá y decí lo que comiste.<br /><i>"Desayuné un café con leche y dos tostadas con queso"</i></span>
              </button>
            )}
            {dayMeals.map((m) => <MealRow key={m.id} m={m} />)}
          </section>
        </div>

        <div className="stack16">
          {isToday && <FastCard />}
          <section className="card stack12">
            <div className="row between baseline">
              <span className="cardtitle row gap6"><Icon name="drop" size={18} className="water-ic" />Agua</span>
              <span className="strong">{fmtL(t.agua)} <span className="muted small">/ {fmtL(profile.water_goal || 2500)}</span></span>
            </div>
            <Bar value={t.agua} goal={profile.water_goal || 2500} color="var(--water)" over="var(--water)" />
            <div className="row gap8 wrap">
              <button type="button" className="btn small water" disabled={busy} onClick={() => agua(250)}>+ Vaso 250</button>
              <button type="button" className="btn small water" disabled={busy} onClick={() => agua(500)}>+ Botella 500</button>
              <button type="button" className="btn small water" disabled={busy} onClick={() => agua(1000)}>+ 1 L</button>
              {water.length > 0 && <button type="button" className="btn small link" disabled={busy} onClick={quitarAgua}>Deshacer</button>}
            </div>
          </section>

          <section className="card stack12">
            <div className="row between baseline">
              <span className="cardtitle row gap6"><Icon name="glass" size={18} className="alc-ic" />Alcohol esta semana</span>
              <span className="strong">{fmt(tragos(alcWeek), 1)} <span className="muted small">/ {fmt(limit)} tragos</span></span>
            </div>
            <Bar value={tragos(alcWeek)} goal={limit || 1} color="var(--alc)" over="var(--danger)" />
            <div className="row gap8 wrap">
              {BEBIDAS.map((b) => <button key={b.label} type="button" className="btn small" disabled={busy} onClick={() => bebida(b)}>+ {b.label}</button>)}
            </div>
            <span className="muted small">Lo que digas por voz ("me tomé dos cervezas") también suma acá.</span>
          </section>

          <section className="card row between">
            <div className="col">
              <span className="cardtitle">Peso</span>
              <span className="muted small">{weightToday ? `${fmt(weightToday.value, 1)} kg registrado ${isToday ? 'hoy' : 'ese día'}` : isToday ? 'Todavía no te pesaste hoy' : 'Sin registro ese día'}</span>
            </div>
            <Link to="/cuerpo" className="btn small">{weightToday ? 'Ver' : 'Registrar'}</Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function Macro({ label, v, goal }) {
  return (
    <div className="stack4">
      <div className="row between small"><span className="hero-sub">{label}</span><span>{fmt(v)} <span className="hero-sub">/ {fmt(goal)} g</span></span></div>
      <div className="bar dark"><div style={{ width: Math.min(100, (v / goal) * 100) + '%', background: 'var(--accent-light)' }} /></div>
    </div>
  );
}

export function MealRow({ m, showDate }) {
  const nav = useNavigate();
  const t = sumItems(m.items);
  return (
    <button type="button" className="exprow" onClick={() => nav('/comida/' + m.id)}>
      <span className={'mealbadge ' + (m.meal_type || '')}>{t.alcohol_g > 0 ? <Icon name="glass" size={18} /> : mealLabel(m.meal_type).slice(0, 2)}</span>
      <span className="col grow">
        <span className="exptitle">{mealLabel(m.meal_type)} <span className="muted small">· {showDate ? dayLabel(dayKey(m.eaten_at)) + ' ' : ''}{timeLabel(m.eaten_at)}</span></span>
        <span className="muted small ellipsis">{(m.items || []).map((i) => i.name).join(', ') || m.raw_text || '—'}</span>
      </span>
      <span className="amount">{fmt(t.kcal)} <span className="muted small">kcal</span></span>
    </button>
  );
}
