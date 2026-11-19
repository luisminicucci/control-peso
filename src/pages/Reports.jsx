import { useMemo, useState } from 'react';
import { api, useStore } from '../store.jsx';
import { ACTIVIDAD, addDays, dayKey, fmt, fmtL, lastNDays, series, shortDate, suggestGoals, tragos, trend } from '../lib.js';
import { BarChart, Icon, LineChart, PageHead } from '../ui.jsx';
import { fastStats, horasMin, useFasts } from './Fast.jsx';

const PERIODOS = [{ d: 7, l: '7 días' }, { d: 14, l: '14 días' }, { d: 30, l: '30 días' }, { d: 90, l: '90 días' }];

export default function Reports() {
  const { profile, meals, metrics, totals, lastWeight } = useStore();
  const [n, setN] = useState(14);
  const [ia, setIa] = useState(null);
  const [iaBusy, setIaBusy] = useState(false);
  const [iaErr, setIaErr] = useState('');

  const fasts = useFasts();
  const fs = useMemo(() => fastStats(fasts, new Date(lastNDays(n)[0] + 'T00:00').getTime()), [fasts, n]);
  const goal = profile.kcal_goal || 2000;
  const waterGoal = profile.water_goal || 2500;
  const limit = Number(profile.alcohol_week_limit ?? 7);

  const r = useMemo(() => {
    const days = lastNDays(n);
    const rows = days.map((k) => ({ k, ...(totals[k] || {}) }));
    const logged = rows.filter((x) => x.comidas > 0);
    // Para promedios de comida no contamos hoy si todavía está a medias (menos de 3 comidas).
    const full = logged.filter((x) => x.k !== dayKey() || x.comidas >= 3);
    const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + (f(x) || 0), 0) / arr.length : null);
    const kcal = avg(full, (x) => x.kcal);
    const prot = avg(full, (x) => x.protein_g);
    const carbs = avg(full, (x) => x.carbs_g);
    const fat = avg(full, (x) => x.fat_g);
    const fiber = avg(full, (x) => x.fiber_g);
    const alc = rows.reduce((s, x) => s + (x.alcohol_g || 0), 0);
    const actKcal = rows.reduce((s, x) => s + (x.actividad || 0), 0);
    const actMin = rows.reduce((s, x) => s + (x.act_min || 0), 0);
    const actDias = rows.filter((x) => x.actividad > 0).length;
    const waterDays = rows.filter((x) => x.agua > 0);
    const water = avg(rows.filter((x) => x.k !== dayKey() || x.agua > 0), (x) => x.agua);
    const inGoal = full.filter((x) => x.kcal <= goal * 1.05).length;
    const ws = series(metrics, 'peso');
    const tr = trend(ws);
    const since = new Date(days[0] + 'T00:00').getTime();
    const trIn = tr.filter((p) => p.t >= since);
    const before = tr.filter((p) => p.t < since).at(-1);
    const wFrom = before?.v ?? trIn[0]?.v;
    const wChange = trIn.length && wFrom != null ? trIn.at(-1).v - wFrom : null;
    const g = suggestGoals({ sex: profile.sex, birth_year: profile.birth_year, height_cm: Number(profile.height_cm), weight: lastWeight, activity: profile.activity });
    const deficit = g && kcal ? g.tdee - kcal : null;

    // Alimentos que más calorías aportaron.
    const foods = {};
    for (const m of meals) {
      if (new Date(m.eaten_at).getTime() < since) continue;
      for (const it of m.items || []) {
        const key = it.name.trim().toLowerCase();
        foods[key] ||= { name: it.name, kcal: 0, veces: 0 };
        foods[key].kcal += Number(it.kcal) || 0;
        foods[key].veces++;
      }
    }
    const top = Object.values(foods).sort((a, b) => b.kcal - a.kcal).slice(0, 8);
    const totalKcal = logged.reduce((s, x) => s + x.kcal, 0);

    // Alcohol por semana (lunes a domingo), últimas semanas que cubren el período.
    const weeks = [];
    const today = dayKey();
    const dow = (new Date().getDay() + 6) % 7;
    let wEnd = addDays(today, 6 - dow);
    for (let i = 0; i < Math.max(4, Math.ceil(n / 7)); i++) {
      const wk = lastNDays(7, wEnd);
      weeks.unshift({ label: shortDate(wk[0]), value: tragos(wk.reduce((s, k) => s + (totals[k]?.alcohol_g || 0), 0)) });
      wEnd = addDays(wEnd, -7);
    }

    return { actKcal, actMin, actDias, days, rows, logged, full, kcal, prot, carbs, fat, fiber, alc, water, waterDays, inGoal, wChange, trIn, ws, g, deficit, top, totalKcal, weeks };
  }, [n, totals, metrics, meals, goal, profile, lastWeight]);

  const tips = useMemo(() => reglas(r, profile, { goal, waterGoal, limit, n }), [r, profile, goal, waterGoal, limit, n]);

  async function pedirIA() {
    setIaBusy(true); setIaErr('');
    try {
      const datos = {
        periodo_dias: n, dias_con_registro: r.logged.length,
        perfil: { sexo: profile.sex, edad: profile.birth_year ? new Date().getFullYear() - profile.birth_year : null, altura_cm: profile.height_cm, actividad: ACTIVIDAD[profile.activity]?.label, peso_actual: lastWeight, peso_objetivo: profile.goal_weight },
        metas: { kcal: goal, proteinas_g: profile.protein_goal, agua_ml: waterGoal, tragos_semana: limit },
        promedios_diarios: { kcal: Math.round(r.kcal || 0), proteinas_g: Math.round(r.prot || 0), carbos_g: Math.round(r.carbs || 0), grasas_g: Math.round(r.fat || 0), fibra_g: Math.round(r.fiber || 0), agua_ml: Math.round(r.water || 0) },
        gasto_estimado_kcal: r.g?.tdee, dias_dentro_de_meta: r.inGoal,
        actividad: { minutos_total: Math.round(r.actMin), kcal_total: Math.round(r.actKcal), dias_con_actividad: r.actDias },
        alcohol_tragos_total: Math.round(tragos(r.alc) * 10) / 10,
        cambio_peso_tendencia_kg: r.wChange != null ? Math.round(r.wChange * 10) / 10 : null,
        calorias_por_dia: r.rows.map((x) => ({ dia: x.k, kcal: Math.round(x.kcal || 0), comidas: x.comidas || 0 })),
        ayunos: fs.cantidad ? { cantidad: fs.cantidad, cumplidos: fs.cumplidos, promedio_horas: Math.round(fs.promedio * 10) / 10 } : null,
        alimentos_con_mas_calorias: r.top.map((f) => ({ alimento: f.name, kcal_total: Math.round(f.kcal), veces: f.veces }))
      };
      setIa(await api('consejos', { datos }));
    } catch (e) { setIaErr(e.message); }
    setIaBusy(false);
  }

  const kcalSplit = r.kcal ? [
    { l: 'Proteínas', v: (r.prot * 4) / r.kcal, c: 'var(--c-prot)' },
    { l: 'Carbos', v: (r.carbs * 4) / r.kcal, c: 'var(--c-carb)' },
    { l: 'Grasas', v: (r.fat * 9) / r.kcal, c: 'var(--c-fat)' },
    { l: 'Alcohol', v: Math.max(0, 1 - ((r.prot * 4 + r.carbs * 4 + r.fat * 9) / r.kcal)), c: 'var(--alc)' }
  ].filter((x) => x.v > 0.005) : [];

  return (
    <div className="page">
      <PageHead title="Informes" sub="Cómo venís">
        <div className="row gap4">{PERIODOS.map((p) => <button key={p.d} type="button" className={'pill small' + (n === p.d ? ' on' : '')} onClick={() => setN(p.d)}>{p.l}</button>)}</div>
      </PageHead>

      <div className="kpis">
        <div className="card kpi"><span className="muted small">Promedio diario</span><span className="kpi-num">{fmt(r.kcal)} kcal</span><span className="muted small">meta {fmt(goal)} · {r.inGoal}/{r.full.length} días en meta</span></div>
        <div className="card kpi"><span className="muted small">Déficit estimado</span><span className={'kpi-num' + (r.deficit > 0 ? ' accent' : '')}>{r.deficit == null ? '–' : `${fmt(r.deficit)} kcal`}</span><span className="muted small">{r.deficit > 0 ? `≈ ${fmt((r.deficit * 7) / 7700, 2)} kg por semana` : 'gasto estimado ' + fmt(r.g?.tdee)}</span></div>
        <div className="card kpi"><span className="muted small">Peso (tendencia)</span><span className={'kpi-num' + (r.wChange < 0 ? ' accent' : '')}>{r.wChange == null ? '–' : `${r.wChange > 0 ? '+' : ''}${fmt(r.wChange, 1)} kg`}</span><span className="muted small">en {n} días</span></div>
        <div className="card kpi"><span className="muted small">Proteínas</span><span className="kpi-num">{fmt(r.prot)} g</span><span className="muted small">meta {fmt(profile.protein_goal)} g por día</span></div>
        <div className="card kpi"><span className="muted small">Agua</span><span className="kpi-num">{fmtL(r.water)}</span><span className="muted small">por día · meta {fmtL(waterGoal)}</span></div>
        <div className="card kpi"><span className="muted small">Actividad física</span><span className="kpi-num">{fmt(r.actMin / (n / 7))} min</span><span className="muted small">por semana · {fmt(r.actKcal)} kcal en {r.actDias} días</span></div>
        <div className="card kpi"><span className="muted small">Alcohol</span><span className="kpi-num">{fmt(tragos(r.alc) / (n / 7), 1)}</span><span className="muted small">tragos por semana · máx. {fmt(limit)}</span></div>
      </div>

      <section className="card stack12 suggest">
        <div className="row between wrap gap8">
          <span className="cardtitle row gap6"><Icon name="sparkle" size={18} />Sugerencias</span>
          <button type="button" className="btn small" disabled={iaBusy || !r.logged.length} onClick={pedirIA}>{iaBusy ? 'Pensando…' : 'Pedir análisis a la IA'}</button>
        </div>
        {iaErr && <div className="alert">{iaErr}</div>}
        {ia && <div className="stack8 iabox"><p>{ia.resumen}</p><ul>{ia.consejos.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        <ul className="tips">{tips.map((t, i) => <li key={i} className={t.tipo}>{t.txt}</li>)}</ul>
      </section>

      <div className="summarygrid">
        <section className="card stack12">
          <span className="cardtitle">Calorías por día</span>
          <BarChart data={r.rows.map((x) => ({ label: shortDate(x.k), value: Math.round(x.kcal || 0) }))} goal={goal} unit="kcal" />
        </section>

        <section className="card stack12">
          <span className="cardtitle">Peso</span>
          <LineChart unit="kg" goal={profile.goal_weight ? Number(profile.goal_weight) : null}
            series={[{ points: r.ws.filter((p) => p.t >= new Date(r.days[0] + 'T00:00').getTime()), color: 'var(--chart-dots)', dots: true, width: 1 }, { points: r.trIn, color: 'var(--accent)', width: 3 }]} />
        </section>

        <section className="card stack12">
          <span className="cardtitle">De dónde vienen las calorías</span>
          {kcalSplit.length ? <>
            <div className="splitbar">{kcalSplit.map((x) => <div key={x.l} style={{ width: x.v * 100 + '%', background: x.c }} title={x.l} />)}</div>
            <div className="row gap12 wrap small">{kcalSplit.map((x) => <span key={x.l} className="row gap6"><span className="dot" style={{ background: x.c }} />{x.l} {fmt(x.v * 100)}%</span>)}</div>
            <span className="muted small">Promedio por día: {fmt(r.prot)} g proteínas · {fmt(r.carbs)} g carbohidratos · {fmt(r.fat)} g grasas · {fmt(r.fiber)} g fibra.</span>
          </> : <p className="muted small">Todavía no hay comidas en este período.</p>}
        </section>

        <section className="card stack12">
          <span className="cardtitle">Calorías quemadas en actividad</span>
          {r.actKcal > 0 ? <BarChart data={r.rows.map((x) => ({ label: shortDate(x.k), value: Math.round(x.actividad || 0), color: 'var(--act)' }))} unit="kcal" />
            : <p className="muted small">Todavía no registraste actividad en este período. Decila por voz como una comida: "caminé 40 minutos".</p>}
        </section>

        <section className="card stack12">
          <span className="cardtitle">Agua por día</span>
          <BarChart data={r.rows.map((x) => ({ label: shortDate(x.k), value: x.agua || 0, color: 'var(--water)' }))} goal={waterGoal} unit="ml" />
        </section>

        <section className="card stack12">
          <span className="cardtitle">Alcohol por semana (tragos)</span>
          <BarChart data={r.weeks.map((w) => ({ ...w, color: w.value > limit ? 'var(--danger)' : 'var(--alc)' }))} goal={limit} unit="tragos" dec={1} goalLabel="máx." />
        </section>

        <section className="card stack12">
          <div className="row between baseline wrap gap8">
            <span className="cardtitle">Ayunos (horas)</span>
            {fs.cantidad > 0 && <span className="muted small">{fs.cantidad} ayunos · {fs.cumplidos} cumplidos{fs.done.some((f) => f.libre) ? ' · azul = libre' : ''} · promedio {horasMin(fs.promedio * 3600e3)}</span>}
          </div>
          {fs.cantidad ? (
            <BarChart data={[...fs.done].reverse().map((f) => ({ label: shortDate(dayKey(new Date(f.end))), value: Math.round((f.ms / 3600e3) * 10) / 10, color: f.libre ? 'var(--water)' : f.ms >= f.target * 3600e3 ? 'var(--accent)' : 'var(--fast)' }))}
              goal={fs.conObjetivo.length ? Math.round(fs.conObjetivo.reduce((a, f) => a + f.target, 0) / fs.conObjetivo.length) : 0} unit="h" dec={1} goalLabel="objetivo" />
          ) : <p className="muted small">Todavía no hay ayunos terminados en este período. Se empiezan desde la pantalla Hoy.</p>}
        </section>

        <section className="card flush">
          <div className="cardhead"><span className="cardtitle">Lo que más calorías te sumó</span></div>
          {r.top.length === 0 && <p className="empty muted small">Sin datos.</p>}
          {r.top.map((f) => (
            <div key={f.name} className="exprow static">
              <span className="col grow"><span className="ellipsis">{f.name}</span><span className="muted small">{f.veces} {f.veces === 1 ? 'vez' : 'veces'}</span></span>
              <span className="amount">{fmt(f.kcal)} kcal <span className="muted small">{r.totalKcal ? fmt((f.kcal / r.totalKcal) * 100) + '%' : ''}</span></span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

// Observaciones automáticas, sin IA.
function reglas(r, profile, { goal, waterGoal, limit, n }) {
  const out = [];
  if (!r.logged.length) return [{ tipo: 'info', txt: 'Registrá tus comidas unos días y acá vas a ver observaciones sobre cómo venís.' }];
  if (r.logged.length < Math.min(n, 7) * 0.6) out.push({ tipo: 'info', txt: `Registraste comidas en ${r.logged.length} de ${n} días. Cuanto más completo, más útiles los números.` });
  if (r.kcal != null) {
    if (r.kcal > goal * 1.08) out.push({ tipo: 'warn', txt: `Venís comiendo ${fmt(r.kcal - goal)} kcal por encima de tu meta en promedio. Mirá abajo qué alimentos suman más: achicar uno o dos de esos suele alcanzar.` });
    else if (r.kcal < goal * 0.75) out.push({ tipo: 'warn', txt: 'Estás comiendo bastante menos que tu meta. Bajar muy rápido cuesta sostenerlo y hace perder músculo: no te quedes corto.' });
    else out.push({ tipo: 'ok', txt: 'Las calorías están cerca de tu meta. Bien ahí, la clave es sostenerlo.' });
  }
  if (r.prot != null && profile.protein_goal && r.prot < profile.protein_goal * 0.8) out.push({ tipo: 'warn', txt: `Las proteínas vienen bajas (${fmt(r.prot)} g de ${fmt(profile.protein_goal)} g). Sumá huevo, pollo, carne magra, atún, queso port salut light o yogur: llenan más y cuidan el músculo.` });
  if (r.fiber != null && r.fiber < 20) out.push({ tipo: 'warn', txt: `Poca fibra (${fmt(r.fiber)} g por día). Verduras en almuerzo y cena, fruta entera y legumbres ayudan a no tener hambre.` });
  if (r.water != null && r.water < waterGoal * 0.7) out.push({ tipo: 'warn', txt: `Tomás en promedio ${fmtL(r.water)} de agua, la meta es ${fmtL(waterGoal)}. Activá los recordatorios en Ajustes.` });
  const perWeek = tragos(r.alc) / (n / 7);
  if (perWeek > limit) out.push({ tipo: 'warn', txt: `El alcohol está arriba de tu máximo (${fmt(perWeek, 1)} tragos por semana). Además de las calorías, abre el apetito: es de lo primero que conviene recortar.` });
  if (r.wChange != null && r.wChange < -0.1 && r.wChange / (n / 7) < -1.2) out.push({ tipo: 'warn', txt: 'Estás bajando más de 1 kg por semana. Al principio es normal (sale agua), pero si sigue así, comé un poco más.' });
  if (r.wChange != null && r.wChange > 0.3 && n >= 14) out.push({ tipo: 'warn', txt: `La tendencia del peso subió ${fmt(r.wChange, 1)} kg en ${n} días. Revisá fines de semana y alcohol.` });
  if (r.wChange != null && r.wChange < -0.2) out.push({ tipo: 'ok', txt: `La tendencia bajó ${fmt(-r.wChange, 1)} kg en ${n} días. Va funcionando.` });
  // Fines de semana
  const we = r.full.filter((x) => [0, 6].includes(new Date(x.k + 'T12:00').getDay()));
  const wd = r.full.filter((x) => ![0, 6].includes(new Date(x.k + 'T12:00').getDay()));
  if (we.length >= 2 && wd.length >= 3) {
    const a = we.reduce((s, x) => s + x.kcal, 0) / we.length, b = wd.reduce((s, x) => s + x.kcal, 0) / wd.length;
    if (a > b * 1.2) out.push({ tipo: 'warn', txt: `Los fines de semana comés ${fmt(a - b)} kcal más que entre semana. Planificar el asado o la salida ayuda a no compensar de más.` });
  }
  return out;
}
