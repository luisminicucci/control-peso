// Función del servidor para Control de Peso (Supabase Edge Function "peso-api").
// - action "analizar": convierte lo que dijiste ("me comí dos empanadas...") en alimentos con nutrientes, con Gemini o Claude Haiku.
// - action "consejos": mira el resumen de tus últimos días y devuelve sugerencias para bajar de peso.
// - action "push-key": devuelve la clave pública para activar notificaciones en el celular.
// - action "cron": la llama la base cada 15 minutos para mandar los recordatorios de agua.
// Las claves de IA quedan solo acá (secretos GEMINI_API_KEY o ANTHROPIC_API_KEY), nunca en la web.
//
// Está escrita sin librerías externas (salvo las de Claude y notificaciones, que se cargan solo si hacen falta)
// para entrar holgada en los límites de memoria y procesador del plan gratis de Supabase.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-haiku-5-5';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';

// Proveedor de IA: si está la clave de Anthropic usa Claude Haiku; si no, Gemini (plan gratis de Google).
// Se puede forzar con el secreto AI_PROVIDER = "anthropic" o "gemini".
function provider() {
  const forced = (Deno.env.get('AI_PROVIDER') || '').toLowerCase();
  if (forced === 'anthropic' || forced === 'gemini') return forced;
  if (Deno.env.get('ANTHROPIC_API_KEY')) return 'anthropic';
  if (Deno.env.get('GEMINI_API_KEY')) return 'gemini';
  return null;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ───────────────────────── Base de datos (REST directo) ─────────────────────────

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
async function db(path: string, init: RequestInit = {}): Promise<Row[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`Base de datos ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
const enc = encodeURIComponent;

async function getUser(token: string): Promise<Row | null> {
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() : null;
}

// ───────────────────────── IA ─────────────────────────

const num = { type: 'number' };
const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const SCHEMA_ANALISIS = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre corto del alimento o bebida, en castellano' },
          cantidad: { type: 'number', description: 'Cantidad dicha (ej. 2 para "dos empanadas")' },
          unidad: { type: 'string', description: 'unidad, porción, vaso, lata, g, ml, plato, rebanada, etc.' },
          gramos: { type: 'number', description: 'Peso o volumen total estimado en g o ml' },
          kcal: num, proteinas_g: num, carbos_g: num, grasas_g: num, fibra_g: num,
          alcohol_g: { type: 'number', description: 'Gramos de alcohol puro; 0 si no es bebida alcohólica' }
        },
        required: ['nombre', 'cantidad', 'unidad', 'gramos', 'kcal', 'proteinas_g', 'carbos_g', 'grasas_g', 'fibra_g', 'alcohol_g'],
        additionalProperties: false
      }
    },
    tipo_comida: { type: 'string', enum: ['desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'bebida', 'ninguna'] },
    momento: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Fecha y hora local "YYYY-MM-DDTHH:MM" si la persona dijo cuándo fue; null si es ahora' },
    agua_ml: { type: 'number', description: 'Agua tomada que se mencionó, en ml; 0 si no se mencionó' },
    peso_kg: { ...numOrNull, description: 'Peso corporal si lo dijo; null si no' },
    cintura_cm: { ...numOrNull, description: 'Medida de cintura si la dijo; null si no' },
    actividades: {
      type: 'array',
      description: 'Actividad física que la persona dijo que hizo; vacío si no mencionó ninguna',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Actividad en castellano, corta (ej. "Caminata rápida", "Bicicleta", "Pesas")' },
          minutos: { type: 'number' },
          intensidad: { type: 'string', enum: ['baja', 'media', 'alta'] },
          kcal: { type: 'number', description: 'Calorías gastadas por la actividad (MET × peso en kg × horas)' }
        },
        required: ['nombre', 'minutos', 'intensidad', 'kcal'],
        additionalProperties: false
      }
    },
    aclaracion: { type: 'string', description: 'Una frase corta con lo que supusiste (porciones, tamaños, intensidad). Vacío si no hace falta' }
  },
  required: ['items', 'tipo_comida', 'momento', 'agua_ml', 'peso_kg', 'cintura_cm', 'actividades', 'aclaracion'],
  additionalProperties: false
} as const;

const SCHEMA_CONSEJOS = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'Dos o tres frases sobre cómo viene la persona' },
    consejos: { type: 'array', items: { type: 'string' }, description: 'Entre 3 y 5 sugerencias concretas y accionables' }
  },
  required: ['resumen', 'consejos'],
  additionalProperties: false
} as const;

// Normaliza la respuesta por si la IA se salteó algo.
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function limpiarAnalisis(o: Row) {
  return {
    items: (Array.isArray(o.items) ? o.items : []).map((i: Row) => ({
      nombre: String(i.nombre || 'Alimento'), cantidad: n(i.cantidad) || 1, unidad: String(i.unidad || 'porción'), gramos: n(i.gramos),
      kcal: Math.round(n(i.kcal)), proteinas_g: n(i.proteinas_g), carbos_g: n(i.carbos_g), grasas_g: n(i.grasas_g), fibra_g: n(i.fibra_g), alcohol_g: n(i.alcohol_g)
    })),
    tipo_comida: String(o.tipo_comida || 'ninguna'),
    momento: typeof o.momento === 'string' && o.momento ? o.momento : null,
    agua_ml: n(o.agua_ml),
    peso_kg: o.peso_kg == null ? null : n(o.peso_kg) || null,
    cintura_cm: o.cintura_cm == null ? null : n(o.cintura_cm) || null,
    actividades: (Array.isArray(o.actividades) ? o.actividades : []).map((a: Row) => ({
      nombre: String(a.nombre || 'Actividad'), minutos: n(a.minutos), intensidad: String(a.intensidad || 'media'), kcal: Math.round(n(a.kcal))
    })),
    aclaracion: String(o.aclaracion || '')
  };
}

async function ia(system: string, user: string, schema: Row, effort: 'low' | 'medium', maxTokens: number): Promise<Row> {
  if (provider() === 'gemini') return gemini(system, user, schema);
  const [{ default: Anthropic }, { jsonSchemaOutputFormat }] = await Promise.all([
    import('npm:@anthropic-ai/sdk@1.3.0'),
    import('npm:@anthropic-ai/sdk@1.3.0/helpers/json-schema')
  ]);
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    // deno-lint-ignore no-explicit-any
    output_config: { effort, format: jsonSchemaOutputFormat(schema as any) },
    system,
    messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal') throw new Error('La IA no pudo procesar ese texto.');
  if (!res.parsed_output) throw new Error('La IA no devolvió un resultado válido. Probá de nuevo.');
  return res.parsed_output as Row;
}

async function gemini(system: string, user: string, schema: Row): Promise<Row> {
  const key = Deno.env.get('GEMINI_API_KEY')!;
  // Intentos en orden: con esquema y sin "pensar" (más rápido); simple; y por último un modelo más liviano.
  const intentos = [
    { model: GEMINI_MODEL, full: true, ms: 18000 },
    { model: GEMINI_MODEL, full: false, ms: 15000 },
    { model: 'gemini-flash-lite-latest', full: false, ms: 15000 }
  ];
  let ultimo = '';
  for (const it of intentos) {
    const t0 = Date.now();
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${it.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: it.full ? system : `${system}\n\nRespondé SOLO con un JSON que cumpla este esquema:\n${JSON.stringify(schema)}` }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', ...(it.full ? { responseJsonSchema: schema, thinkingConfig: { thinkingBudget: 0 } } : {}) }
        }),
        signal: AbortSignal.timeout(it.ms)
      });
    } catch (err) {
      ultimo = `${it.model}: sin respuesta en ${it.ms / 1000} s`;
      console.log('gemini', it.model, it.full ? 'con esquema' : 'simple', 'error:', (err as Error).name, `${Date.now() - t0} ms`);
      continue;
    }
    const body = await r.text();
    console.log('gemini', it.model, it.full ? 'con esquema' : 'simple', r.status, `${Date.now() - t0} ms`, r.ok ? '' : body.slice(0, 300));
    if (r.status === 429) throw Object.assign(new Error('rate'), { status: 429 });
    if (r.status === 401 || r.status === 403) throw new Error('Google rechazó la clave de Gemini. Revisá el secreto GEMINI_API_KEY en Supabase.');
    if (!r.ok) { ultimo = `${it.model}: error ${r.status}`; continue; }
    const data = JSON.parse(body);
    const text = (data.candidates?.[0]?.content?.parts || []).map((p: Row) => p.text || '').join('');
    try {
      return JSON.parse(text.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '').trim());
    } catch {
      ultimo = `${it.model}: respuesta no válida`;
      console.log('gemini texto no JSON:', text.slice(0, 300));
    }
  }
  throw new Error(`Gemini no respondió bien (${ultimo}). Probá de nuevo en un rato.`);
}

const SYSTEM_ANALIZAR = `Sos un nutricionista argentino que ayuda a registrar comidas y actividad física para bajar de peso.
Te pasan lo que una persona dijo por voz (puede tener errores de dictado) y tenés que devolver cada alimento o bebida con su porción y nutrientes estimados para ESA porción, y la actividad física que haya hecho.

Reglas:
- Usá porciones y productos típicos de Argentina: empanada ≈ 90-110 g; milanesa ≈ 150 g; porción de pizza de muzzarella ≈ 1/8 de grande; factura ≈ 50 g; alfajor ≈ 50 g; "coca chica" = botella 500 ml (si dice "lata", 354 ml); vaso ≈ 250 ml; taza ≈ 250 ml; mate cocido/café solo sin azúcar ≈ 0-5 kcal; cucharada de azúcar ≈ 12 g.
- Distinguí light/zero/sin azúcar cuando lo digan. Si no dicen el tamaño, suponé la porción más común y aclaralo en "aclaracion".
- Cerveza ≈ 5% de alcohol, vino ≈ 12-13%, fernet ≈ 39% (un fernet con coca típico lleva ~60 ml de fernet). Calculá alcohol_g = ml × %alc × 0,789. Las calorías del alcohol van incluidas en kcal.
- Agua sola NO va en items: sumala en agua_ml. Mate amargo, té o café sin azúcar sí podés ponerlos como items con sus pocas kcal, y no los cuentes como agua.
- Si la persona menciona su peso o cintura, completá peso_kg o cintura_cm.
- Si cuenta actividad física (caminar, correr, bici, gimnasio, pesas, fútbol, pádel, natación, baile, limpiar la casa, subir escaleras, pasos), ponela en actividades con minutos, intensidad y kcal = MET × peso (kg) × horas, usando el peso que te paso. MET de referencia: caminar tranquilo 3, caminata rápida 4,3, trotar 7, correr 9-11, bici paseo 4, bici intensa 8, pesas 3,5-6, fútbol 7, pádel 6, natación 6-8, baile 5, tareas de la casa 3. Si dice pasos, 1.000 pasos ≈ 10 min de caminata. Si no dice la duración, suponé una razonable y aclaralo. La actividad NO va en items.
- tipo_comida: deducilo de lo que dijo o de la hora local; "bebida" si solo tomó algo; "ninguna" si no hay comida ni bebida.
- Redondeá kcal a enteros y macros a 1 decimal. Sé realista, ni optimista ni exagerado.`;

async function analizar(texto: string, ahora: string, peso: number | null) {
  const o = await ia(SYSTEM_ANALIZAR, `Fecha y hora local ahora: ${ahora}\nPeso de la persona: ${peso ? peso + ' kg' : 'desconocido (suponé 80 kg)'}\nLo que dijo: "${texto}"`, SCHEMA_ANALISIS, 'low', 4000);
  return limpiarAnalisis(o);
}

const SYSTEM_CONSEJOS = `Sos un nutricionista argentino, cercano y directo, que acompaña a alguien que quiere bajar de peso.
Te pasan un resumen de sus últimos días (calorías, macros, agua, alcohol, peso y cintura, comidas frecuentes).
Hablá de vos, en castellano rioplatense, sin sermones. Basate solo en los datos. Sugerencias concretas (qué cambiar, por qué y cómo), con alimentos argentinos comunes.
No des indicaciones médicas; si algo parece riesgoso (muy pocas calorías, mucho alcohol), sugerí consultarlo con un profesional.`;

async function consejos(datos: unknown) {
  const o = await ia(SYSTEM_CONSEJOS, JSON.stringify(datos), SCHEMA_CONSEJOS, 'medium', 3000);
  return { resumen: String(o.resumen || ''), consejos: Array.isArray(o.consejos) ? o.consejos.map(String) : [] };
}

// ───────────────────────── Notificaciones ─────────────────────────

const loadWebpush = async () => (await import('npm:web-push@3.6.7')).default;

async function getConfig(key: string) {
  const rows = await db(`peso_server_config?key=eq.${enc(key)}&select=value`);
  return rows[0]?.value as string | undefined;
}

async function vapid() {
  const webpush = await loadWebpush();
  let pub = await getConfig('vapid_public');
  let priv = await getConfig('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    await db('peso_server_config', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'vapid_public', value: pub }, { key: 'vapid_private', value: priv }]) });
  }
  webpush.setVapidDetails('mailto:avisos@control-peso.app', pub, priv);
  return { webpush, pub };
}

// Hora local "HH:MM" y fecha "YYYY-MM-DD" en la zona de la persona.
function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const toMin = (hm: string) => { const [h, m] = hm.slice(0, 5).split(':').map(Number); return h * 60 + m; };

async function cron() {
  const { webpush } = await vapid();
  const subs = await db('peso_push_subs?select=*');
  if (!subs?.length) return { enviados: 0 };
  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const profiles = await db(`peso_profiles?select=*&water_reminders=eq.true&user_id=in.(${userIds.join(',')})`);
  let enviados = 0;
  for (const p of profiles || []) {
    const tz = p.timezone || 'America/Argentina/Buenos_Aires';
    const { date, hm } = localParts(tz);
    const now = toMin(hm), start = toMin(p.reminder_start || '09:00'), end = toMin(p.reminder_end || '21:00');
    if (now < start || now > end) continue;

    // Agua tomada hoy (desde la medianoche local; tomamos 30 h hacia atrás y filtramos por fecha local).
    const agua = await db(`peso_metrics?select=value,measured_at&kind=eq.agua&user_id=eq.${p.user_id}&measured_at=gte.${enc(new Date(Date.now() - 30 * 3600e3).toISOString())}`);
    const hoy = (agua || []).filter((a) => localParts(tz, new Date(a.measured_at)).date === date).reduce((s, a) => s + Number(a.value), 0);
    const meta = p.water_goal || 2500;
    if (hoy >= meta) continue;
    const esperado = meta * Math.min(1, (now - start) / Math.max(1, end - start));
    if (hoy >= esperado && now - start > 30) continue; // va al día

    for (const s of subs.filter((x) => x.user_id === p.user_id)) {
      const cada = (p.reminder_every_min || 90) * 60e3;
      if (s.last_sent_at && Date.now() - new Date(s.last_sent_at).getTime() < cada - 5 * 60e3) continue;
      const falta = Math.max(0, Math.round((meta - hoy) / 50) * 50);
      const payload = JSON.stringify({
        title: 'Hora de tomar agua 💧',
        body: `Llevás ${(hoy / 1000).toFixed(1).replace('.', ',')} L de ${(meta / 1000).toFixed(1).replace('.', ',')} L. Te faltan ${falta} ml.`,
        url: './#/'
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 1800 });
        await db(`peso_push_subs?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_sent_at: new Date().toISOString() }) });
        enviados++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db(`peso_push_subs?id=eq.${s.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); // el celular dio de baja
        else console.error('push', code, err);
      }
    }
  }
  return { enviados };
}

// ───────────────────────── Entrada ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'cron') {
      const secret = await getConfig('cron_secret');
      if (!secret || body.secret !== secret) return json({ error: 'no autorizado' }, 401);
      return json(await cron());
    }
    if (action === 'push-key') return json({ publicKey: (await vapid()).pub });

    // El resto necesita una sesión iniciada.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const user = await getUser(token);
    if (!user?.id) return json({ error: 'Iniciá sesión de nuevo.' }, 401);
    const allowed = (Deno.env.get('ALLOWED_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes((user.email || '').toLowerCase())) return json({ error: 'Usuario no habilitado.' }, 403);

    if (!provider() && (action === 'analizar' || action === 'consejos')) {
      return json({ error: 'Falta cargar la clave de la IA en los secretos de Supabase: GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY.' }, 500);
    }
    if (action === 'analizar') {
      const texto = String(body.texto || '').trim().slice(0, 2000);
      if (!texto) return json({ error: 'No llegó ningún texto.' }, 400);
      return json(await analizar(texto, String(body.ahora || new Date().toISOString()), Number(body.peso) || null));
    }
    if (action === 'consejos') return json(await consejos(body.datos));
    return json({ error: 'Acción desconocida' }, 400);
  } catch (err) {
    console.error(err);
    const status = (err as { status?: number }).status;
    if (status === 401) return json({ error: 'La clave de la IA no es válida. Revisala en los secretos de Supabase.' }, 500);
    if (status === 429) return json({ error: 'La IA está saturada, probá en un minuto.' }, 503);
    if ((err as Error).name === 'TimeoutError') return json({ error: 'La IA tardó demasiado en responder. Probá de nuevo.' }, 504);
    return json({ error: (err as Error).message || String(err) }, 500);
  }
});
