import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { ACTIVIDAD, bmi, bmiLabel, fmt, num, suggestGoals } from '../lib.js';
import { PageHead } from '../ui.jsx';

export default function Profile({ first = false }) {
  const { profile, lastWeight, saveProfile, addMetric, session } = useStore();
  const nav = useNavigate();
  const p = profile || {};
  const [f, setF] = useState({
    display_name: p.display_name || session?.user?.email?.split('@')[0] || '',
    sex: p.sex || 'm',
    birth_year: p.birth_year || '',
    height_cm: p.height_cm || '',
    weight: lastWeight || '',
    goal_weight: p.goal_weight || '',
    activity: p.activity || 'ligera',
    kcal_goal: p.kcal_goal || '',
    protein_goal: p.protein_goal || '',
    water_goal: p.water_goal || 2500,
    alcohol_week_limit: p.alcohol_week_limit ?? 7
  });
  const [touched, setTouched] = useState(!first);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const sug = useMemo(() => suggestGoals({
    sex: f.sex, birth_year: num(f.birth_year), height_cm: num(f.height_cm), weight: num(f.weight), activity: f.activity
  }), [f.sex, f.birth_year, f.height_cm, f.weight, f.activity]);
  const b = bmi(num(f.weight), num(f.height_cm));

  const val = (k) => (touched || !first ? f[k] : '') || (sug ? sug[k] : '');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const w = num(f.weight);
      await saveProfile({
        display_name: f.display_name.trim() || null,
        sex: f.sex,
        birth_year: num(f.birth_year),
        height_cm: num(f.height_cm),
        activity: f.activity,
        start_weight: p.start_weight ?? w,
        goal_weight: num(f.goal_weight),
        kcal_goal: num(val('kcal_goal')) ?? sug?.kcal_goal ?? 2000,
        protein_goal: num(val('protein_goal')) ?? sug?.protein_goal ?? 100,
        water_goal: num(val('water_goal')) ?? 2500,
        alcohol_week_limit: num(f.alcohol_week_limit) ?? 7,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      if (w && w !== lastWeight) await addMetric('peso', w, { unit: 'kg' });
      if (first) nav('/');
      else setMsg('Guardado.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page formpage" onSubmit={submit}>
      <PageHead title={first ? 'Arranquemos' : 'Mis datos y metas'} sub={first ? 'Control de Peso' : 'Ajustes'} />
      {first && <p className="muted">Con estos datos calculo cuántas calorías te conviene comer por día para bajar de forma sostenida (alrededor de medio kilo por semana). Después lo podés cambiar.</p>}

      <section className="card stack12">
        <label className="field">Nombre
          <input value={f.display_name} onChange={set('display_name')} />
        </label>
        <div className="segmented">
          <button type="button" className={f.sex === 'm' ? 'on' : ''} onClick={() => setF({ ...f, sex: 'm' })}>Hombre</button>
          <button type="button" className={f.sex === 'f' ? 'on' : ''} onClick={() => setF({ ...f, sex: 'f' })}>Mujer</button>
        </div>
        <div className="grid3">
          <label className="field">Año de nacimiento
            <input inputMode="numeric" value={f.birth_year} onChange={set('birth_year')} placeholder="1975" required />
          </label>
          <label className="field">Altura (cm)
            <input inputMode="decimal" value={f.height_cm} onChange={set('height_cm')} placeholder="175" required />
          </label>
          <label className="field">Peso actual (kg)
            <input inputMode="decimal" value={f.weight} onChange={set('weight')} placeholder="95,5" required />
          </label>
        </div>
        <label className="field">Peso objetivo (kg)
          <input inputMode="decimal" value={f.goal_weight} onChange={set('goal_weight')} placeholder="82" />
        </label>
        <label className="field">Actividad física
          <select value={f.activity} onChange={set('activity')}>
            {Object.entries(ACTIVIDAD).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        {b && <p className="note">IMC {fmt(b, 1)} ({bmiLabel(b)}).{sug && <> Gastás alrededor de <b>{fmt(sug.tdee)} kcal</b> por día.</>}</p>}
      </section>

      <section className="card stack12">
        <div className="row between baseline">
          <span className="cardtitle">Metas diarias</span>
          {sug && <button type="button" className="btn link small" onClick={() => { setTouched(true); setF((x) => ({ ...x, kcal_goal: sug.kcal_goal, protein_goal: sug.protein_goal, water_goal: sug.water_goal })); }}>Usar sugeridas</button>}
        </div>
        <div className="grid3">
          <label className="field">Calorías (kcal)
            <input inputMode="numeric" value={val('kcal_goal')} onChange={(e) => { setTouched(true); set('kcal_goal')(e); }} />
          </label>
          <label className="field">Proteínas (g)
            <input inputMode="numeric" value={val('protein_goal')} onChange={(e) => { setTouched(true); set('protein_goal')(e); }} />
          </label>
          <label className="field">Agua (ml)
            <input inputMode="numeric" value={val('water_goal')} onChange={(e) => { setTouched(true); set('water_goal')(e); }} />
          </label>
        </div>
        <label className="field">Alcohol: máximo de tragos por semana
          <input inputMode="numeric" value={f.alcohol_week_limit} onChange={set('alcohol_week_limit')} />
          <span className="muted small" style={{ fontWeight: 400 }}>Un trago = 10 g de alcohol: una lata de cerveza, una copa de vino o medio fernet con coca.</span>
        </label>
      </section>

      {msg && <p className="note">{msg}</p>}
      <div className="formactions">
        <button className="btn primary grow" disabled={busy}>{busy ? 'Guardando…' : first ? 'Empezar' : 'Guardar'}</button>
      </div>
    </form>
  );
}
