// Utilidades: fechas, formatos, cálculos de nutrición y agregados.

export const pad = (n) => String(n).padStart(2, '0');

// Clave de día local "YYYY-MM-DD" para un Date o ISO.
export function dayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}
export function startOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Para <input type="datetime-local">
export function toLocalInput(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${dayKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export function nowLocalString() {
  const d = new Date();
  const dia = d.toLocaleDateString('es-AR', { weekday: 'long' });
  return `${toLocalInput(d)} (${dia})`;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export function dayLabel(key, long = false) {
  const today = dayKey();
  if (key === today) return 'Hoy';
  if (key === addDays(today, -1)) return 'Ayer';
  const d = startOfDay(key);
  return long
    ? d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    : `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
export const shortDate = (key) => { const d = startOfDay(key); return `${d.getDate()}/${d.getMonth() + 1}`; };
export const timeLabel = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export const fmt = (n, dec = 0) =>
  n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const fmtL = (ml) => fmt((ml || 0) / 1000, 1) + ' L';
export const num = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; };

// ───────── Metas ─────────

export const ACTIVIDAD = {
  sedentaria: { label: 'Sedentaria (casi nada de movimiento)', f: 1.2 },
  ligera: { label: 'Ligera (caminatas, 1-3 días de ejercicio)', f: 1.375 },
  moderada: { label: 'Moderada (3-5 días de ejercicio)', f: 1.55 },
  alta: { label: 'Alta (6-7 días o trabajo físico)', f: 1.725 }
};

// Mifflin-St Jeor + factor de actividad, con un déficit de ~500 kcal (≈ medio kilo por semana).
export function suggestGoals({ sex, birth_year, height_cm, weight, activity }) {
  const age = birth_year ? new Date().getFullYear() - birth_year : 40;
  if (!weight || !height_cm) return null;
  const bmr = 10 * weight + 6.25 * height_cm - 5 * age + (sex === 'f' ? -161 : 5);
  const tdee = bmr * (ACTIVIDAD[activity]?.f || 1.375);
  const piso = sex === 'f' ? 1200 : 1500;
  const kcal = Math.round(Math.max(piso, tdee - 500) / 50) * 50;
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal_goal: kcal,
    protein_goal: Math.round(weight * 1.6 / 5) * 5,
    water_goal: Math.round(Math.min(3500, Math.max(2000, weight * 30)) / 250) * 250
  };
}

export function bmi(weight, height_cm) {
  if (!weight || !height_cm) return null;
  return weight / (height_cm / 100) ** 2;
}
export function bmiLabel(b) {
  if (b == null) return '';
  if (b < 18.5) return 'bajo peso';
  if (b < 25) return 'normal';
  if (b < 30) return 'sobrepeso';
  if (b < 35) return 'obesidad I';
  if (b < 40) return 'obesidad II';
  return 'obesidad III';
}

// ───────── Agregados ─────────

export const MEAL_TYPES = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Almuerzo' },
  { id: 'merienda', label: 'Merienda' },
  { id: 'cena', label: 'Cena' },
  { id: 'colacion', label: 'Colación' },
  { id: 'bebida', label: 'Bebida' }
];
export const mealLabel = (id) => MEAL_TYPES.find((m) => m.id === id)?.label || 'Comida';
export function guessMealType(d = new Date()) {
  const h = d.getHours();
  if (h < 11) return 'desayuno';
  if (h < 15.5) return 'almuerzo';
  if (h < 19.5) return 'merienda';
  return 'cena';
}

export const ZERO = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, alcohol_g: 0 };
export function sumItems(items) {
  const t = { ...ZERO };
  for (const it of items || []) for (const k in t) t[k] += Number(it[k]) || 0;
  return t;
}

// Totales por día: { 'YYYY-MM-DD': { kcal, protein_g, ..., agua, comidas } }
export function dailyTotals(meals, metrics) {
  const by = {};
  const get = (k) => (by[k] ||= { ...ZERO, agua: 0, comidas: 0, actividad: 0, act_min: 0 });
  for (const m of meals) {
    const d = get(dayKey(m.eaten_at));
    const t = sumItems(m.items);
    for (const k in ZERO) d[k] += t[k];
    d.comidas++;
  }
  for (const x of metrics) {
    if (x.kind === 'agua') get(dayKey(x.measured_at)).agua += Number(x.value);
    if (x.kind === 'actividad') { const d = get(dayKey(x.measured_at)); d.actividad += Number(x.value); d.act_min += Number(x.meta?.minutos) || 0; }
  }
  return by;
}

// Últimos valores de una medición ordenados por fecha ascendente.
export function series(metrics, kind) {
  return metrics.filter((m) => m.kind === kind)
    .map((m) => ({ t: new Date(m.measured_at).getTime(), v: Number(m.value), id: m.id, at: m.measured_at }))
    .sort((a, b) => a.t - b.t);
}

// Promedio móvil exponencial (tendencia de peso que filtra el ruido diario).
export function trend(points, alpha = 0.25) {
  let e = null;
  return points.map((p) => { e = e == null ? p.v : e + alpha * (p.v - e); return { ...p, v: e }; });
}

// Un trago estándar = 10 g de alcohol puro.
export const tragos = (g) => (g || 0) / 10;

export function lastNDays(n, end = dayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}

// ───────── Comidas frecuentes ─────────

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ITEM_KEYS = ['name', 'quantity', 'unit', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'alcohol_g'];
export const copyItem = (it) => Object.fromEntries(ITEM_KEYS.map((k) => [k, it[k] ?? null]));

// Comidas completas que se repiten (mismos alimentos), priorizando el tipo de comida actual.
export function frequentMeals(meals, mealType, max = 6) {
  const by = new Map();
  for (const m of meals) {
    if (!m.items?.length) continue;
    const key = m.items.map((i) => norm(i.name)).sort().join('|');
    const g = by.get(key) || { key, n: 0, tipo: 0, last: 0, meal: null };
    const t = new Date(m.eaten_at).getTime();
    g.n++;
    if (m.meal_type === mealType) g.tipo++;
    if (t > g.last) { g.last = t; g.meal = m; }
    by.set(key, g);
  }
  const ahora = Date.now();
  return [...by.values()]
    .map((g) => ({ ...g, score: g.n + g.tipo * 2 + (ahora - g.last < 3 * 864e5 ? 1 : 0) }))
    .filter((g) => g.n >= 2 || g.tipo >= 1)
    .sort((a, b) => b.score - a.score || b.last - a.last)
    .slice(0, max)
    .map((g) => ({ key: g.key, veces: g.n, meal: g.meal, kcal: Math.round(sumItems(g.meal.items).kcal), nombre: g.meal.items.map((i) => i.name).join(' + ') }));
}

// Alimentos sueltos ya registrados que coinciden con lo que se escribe.
export function matchFoods(meals, q, max = 5) {
  const qq = norm(q);
  if (qq.length < 2) return [];
  const by = new Map();
  for (const m of meals) for (const it of m.items || []) {
    const k = norm(it.name);
    if (!k.includes(qq)) continue;
    const g = by.get(k) || { n: 0, last: 0, item: it };
    const t = new Date(m.eaten_at).getTime();
    g.n++;
    if (t > g.last) { g.last = t; g.item = it; }
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => (norm(b.item.name).startsWith(qq) - norm(a.item.name).startsWith(qq)) || b.n - a.n).slice(0, max).map((g) => ({ ...g.item, veces: g.n }));
}
