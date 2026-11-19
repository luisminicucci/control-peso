import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { dailyTotals } from './lib.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

// Cuántos días hacia atrás traemos (alcanza para tendencias e informes).
const DIAS_HISTORIA = 400;

async function fetchAll(query) {
  const page = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await query().range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) return rows;
    from += page;
  }
}

// Llama a la función del servidor (IA, notificaciones).
export async function api(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('peso-api', { body: { action, ...payload }, timeout: 70000 });
  if (error) {
    let msg = error.message;
    const status = error.context?.status;
    try { const b = await error.context?.clone?.().json(); if (b?.error) msg = b.error; else if (b?.msg || b?.message) msg = b.msg || b.message; } catch { /* sin cuerpo */ }
    if (/abort|timeout/i.test(msg + ' ' + (error.context?.name || '') + ' ' + (error.context?.message || ''))) msg = 'La IA tardó demasiado en responder (más de 70 segundos). Probá de nuevo; si se repite, revisá los Logs de peso-api.';
    else if (error.name === 'FunctionsFetchError') msg = 'No se pudo conectar con la función peso-api. Revisá que exista en Supabase con ese nombre exacto.';
    else if (status === 404) msg = 'No existe la función peso-api en Supabase (404).';
    else if (status === 401 && !/sesión|clave/i.test(msg)) msg = 'La función rechazó el pedido (401). Apagá "Verify JWT" en los ajustes de peso-api.';
    else if (status && !/\(\d{3}\)/.test(msg)) msg += ` (${status})`;
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function StoreProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = cargando
  const [profile, setProfile] = useState(undefined); // undefined = cargando, null = sin configurar
  const [meals, setMeals] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [error, setError] = useState('');
  const metricsRef = useRef([]);
  metricsRef.current = metrics;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadAll = useCallback(async () => {
    if (!session) return;
    try {
      const uid = session.user.id;
      const since = new Date(Date.now() - DIAS_HISTORIA * 864e5).toISOString();
      const [prof, ms, mt] = await Promise.all([
        supabase.from('peso_profiles').select('*').eq('user_id', uid).maybeSingle(),
        fetchAll(() => supabase.from('peso_meals').select('*, items:peso_meal_items(*)').gte('eaten_at', since).order('eaten_at', { ascending: false })),
        fetchAll(() => supabase.from('peso_metrics').select('*').gte('measured_at', since).order('measured_at', { ascending: false }))
      ]);
      if (prof.error) throw prof.error;
      for (const m of ms) m.items?.sort((a, b) => (a.sort || 0) - (b.sort || 0));
      setMeals(ms);
      setMetrics(mt);
      setProfile(prof.data || null);
      setError('');
    } catch (err) {
      const msg = err.message || String(err);
      setError(/peso_/.test(msg) && /does not exist|schema cache/i.test(msg)
        ? 'Faltan las tablas en Supabase: corré supabase/schema.sql en el SQL Editor.'
        : msg);
      setProfile((p) => (p === undefined ? null : p));
    }
  }, [session]);

  useEffect(() => {
    if (session) loadAll();
    else if (session === null) { setProfile(undefined); setMeals([]); setMetrics([]); }
  }, [session, loadAll]);

  // Al volver a la app (por ejemplo, de la compu al celu), refrescamos.
  useEffect(() => {
    if (!session) return;
    const onFocus = () => document.visibilityState === 'visible' && loadAll();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [session, loadAll]);

  // ───────── Acciones ─────────

  const saveProfile = useCallback(async (changes) => {
    const row = { ...changes, user_id: session.user.id, updated_at: new Date().toISOString() };
    const { data, error: e } = await supabase.from('peso_profiles').upsert(row).select().single();
    if (e) throw e;
    setProfile(data);
    return data;
  }, [session]);

  // meal: { id?, eaten_at, meal_type, raw_text, source, note, items: [...] }
  const saveMeal = useCallback(async (meal) => {
    const { items = [], id, ...rest } = meal;
    let mealId = id;
    if (id) {
      const { error: e } = await supabase.from('peso_meals').update(rest).eq('id', id);
      if (e) throw e;
      const { error: e2 } = await supabase.from('peso_meal_items').delete().eq('meal_id', id);
      if (e2) throw e2;
    } else {
      const { data, error: e } = await supabase.from('peso_meals').insert(rest).select('id').single();
      if (e) throw e;
      mealId = data.id;
    }
    if (items.length) {
      const rows = items.map((it, i) => ({
        meal_id: mealId, sort: i, name: it.name || 'Alimento', quantity: it.quantity ?? null, unit: it.unit || null,
        grams: it.grams ?? null, kcal: Math.round(Number(it.kcal) || 0), protein_g: Number(it.protein_g) || 0,
        carbs_g: Number(it.carbs_g) || 0, fat_g: Number(it.fat_g) || 0, fiber_g: Number(it.fiber_g) || 0, alcohol_g: Number(it.alcohol_g) || 0
      }));
      const { error: e3 } = await supabase.from('peso_meal_items').insert(rows);
      if (e3) throw e3;
    }
    // Si había un ayuno en curso y se registra algo con calorías, el ayuno termina a la hora de esa comida.
    const kcal = items.reduce((s, it) => s + (Number(it.kcal) || 0), 0);
    if (!id && kcal > 0) {
      const at = new Date(rest.eaten_at || Date.now());
      const activo = metricsRef.current.find((m) => m.kind === 'ayuno' && !m.meta?.end && new Date(m.measured_at).getTime() < at.getTime() + 60000);
      if (activo) await supabase.from('peso_metrics').update({ meta: { ...activo.meta, end: new Date(Math.max(at.getTime(), new Date(activo.measured_at).getTime())).toISOString() } }).eq('id', activo.id);
    }
    await loadAll();
    return mealId;
  }, [loadAll]);

  const deleteMeal = useCallback(async (id) => {
    const { error: e } = await supabase.from('peso_meals').delete().eq('id', id);
    if (e) throw e;
    setMeals((ms) => ms.filter((m) => m.id !== id));
  }, []);

  const addMetric = useCallback(async (kind, value, extra = {}) => {
    const row = { kind, value, ...extra };
    const { data, error: e } = await supabase.from('peso_metrics').insert(row).select().single();
    if (e) throw e;
    setMetrics((mt) => [data, ...mt].sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at)));
    return data;
  }, []);

  const updateMetric = useCallback(async (id, changes) => {
    const { data, error: e } = await supabase.from('peso_metrics').update(changes).eq('id', id).select().single();
    if (e) throw e;
    setMetrics((mt) => mt.map((m) => (m.id === id ? data : m)));
    return data;
  }, []);

  const deleteMetric = useCallback(async (id) => {
    const { error: e } = await supabase.from('peso_metrics').delete().eq('id', id);
    if (e) throw e;
    setMetrics((mt) => mt.filter((m) => m.id !== id));
  }, []);

  const value = useMemo(() => {
    const totals = dailyTotals(meals, metrics);
    const weights = metrics.filter((m) => m.kind === 'peso');
    const lastWeight = weights[0] ? Number(weights[0].value) : profile?.start_weight ? Number(profile.start_weight) : null;
    return {
      session, profile, meals, metrics, totals, lastWeight, error, setError, loadAll,
      saveProfile, saveMeal, deleteMeal, addMetric, updateMetric, deleteMetric
    };
  }, [session, profile, meals, metrics, error, loadAll, saveProfile, saveMeal, deleteMeal, addMetric, updateMetric, deleteMetric]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
