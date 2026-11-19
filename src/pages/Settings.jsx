import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useStore } from '../store.jsx';
import { supabase } from '../supabase.js';
import { fmt, fmtL } from '../lib.js';
import { Icon, PageHead } from '../ui.jsx';

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function Settings() {
  const { profile, saveProfile, session } = useStore();
  const [r, setR] = useState({
    on: !!profile.water_reminders,
    start: (profile.reminder_start || '09:00').slice(0, 5),
    end: (profile.reminder_end || '21:00').slice(0, 5),
    every: profile.reminder_every_min || 90
  });
  const [subscribed, setSubscribed] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    if (!pushOk) return;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
  }, [pushOk]);

  async function suscribir() {
    if (!pushOk) throw new Error('Este navegador no permite notificaciones. En el celu, abrí la app instalada desde Chrome.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('No diste permiso para notificaciones. Habilitalo en los ajustes del navegador para este sitio.');
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('La app todavía no terminó de instalarse. Recargá la página y probá de nuevo.')), 8000))]);
    const { publicKey } = await api('push-key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
    const j = sub.toJSON();
    const { error } = await supabase.from('peso_push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: session.user.id }, { onConflict: 'endpoint' });
    if (error) throw error;
    setSubscribed(true);
  }

  async function guardarRecordatorios(e) {
    e?.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (r.on && !subscribed) await suscribir();
      await saveProfile({
        water_reminders: r.on, reminder_start: r.start, reminder_end: r.end, reminder_every_min: Number(r.every) || 90,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      setMsg(r.on ? 'Listo. Te voy a avisar en este dispositivo cuando vengas atrasado con el agua.' : 'Recordatorios desactivados.');
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  }

  async function probar() {
    setMsg('');
    try {
      if (!subscribed) await suscribir();
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Así se ven los avisos 💧', { body: `Meta de hoy: ${fmtL(profile.water_goal || 2500)} de agua.`, icon: 'icon-192.png', tag: 'prueba' });
    } catch (err) { setMsg(err.message); }
  }

  return (
    <div className="page formpage">
      <PageHead title="Ajustes" />

      <Link to="/perfil" className="card row between linkcard">
        <span className="col">
          <span className="cardtitle">Mis datos y metas</span>
          <span className="muted small">{fmt(profile.kcal_goal)} kcal · {fmt(profile.protein_goal)} g proteínas · {fmtL(profile.water_goal)} agua · objetivo {profile.goal_weight ? fmt(profile.goal_weight, 1) + ' kg' : '–'}</span>
        </span>
        <Icon name="edit" size={20} />
      </Link>

      <form className="card stack12" onSubmit={guardarRecordatorios}>
        <span className="cardtitle row gap6"><Icon name="bell" size={18} />Recordatorios de agua</span>
        <label className="check"><input type="checkbox" checked={r.on} onChange={(e) => setR({ ...r, on: e.target.checked })} />Avisarme si vengo atrasado con el agua</label>
        {r.on && (
          <div className="grid3">
            <label className="field">Desde<input type="time" value={r.start} onChange={(e) => setR({ ...r, start: e.target.value })} /></label>
            <label className="field">Hasta<input type="time" value={r.end} onChange={(e) => setR({ ...r, end: e.target.value })} /></label>
            <label className="field">Cada
              <select value={r.every} onChange={(e) => setR({ ...r, every: Number(e.target.value) })}>
                {[45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? m + ' min' : m / 60 + ' h'}</option>)}
              </select>
            </label>
          </div>
        )}
        <span className="muted small">Los avisos llegan aunque la app esté cerrada, al dispositivo donde los actives (activalo en el celular). Solo te avisa si vas por debajo de lo esperado para esa hora.</span>
        {msg && <p className="note">{msg}</p>}
        <div className="row gap8 wrap">
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          {pushOk && <button type="button" className="btn" onClick={probar}>Probar aviso</button>}
        </div>
      </form>

      <section className="card stack8">
        <span className="cardtitle">Instalar en el celular</span>
        <p className="muted small">En Chrome (Android): menú ⋮ → <b>Agregar a la pantalla principal</b> o <b>Instalar app</b>. Queda como una app más, con su ícono.</p>
      </section>

      <section className="card stack8">
        <span className="cardtitle">Próximamente</span>
        <p className="muted small">Importar pasos, actividad y sueño desde Samsung Health (reloj incluido), registro de hambre y ánimo, y fotos de progreso.</p>
      </section>

      <section className="card row between">
        <span className="col"><span className="cardtitle">Sesión</span><span className="muted small">{session.user.email}</span></span>
        <button type="button" className="btn danger" onClick={() => supabase.auth.signOut()}>Salir</button>
      </section>
    </div>
  );
}
