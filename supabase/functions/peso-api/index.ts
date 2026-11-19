// Función del servidor para Control de Peso (Supabase Edge Function "peso-api").
// - action "analizar": convierte lo que dijiste ("me comí dos empanadas...") en alimentos con nutrientes, con Claude Haiku o Gemini.
// - action "consejos": mira el resumen de tus últimos días y devuelve sugerencias para bajar de peso.
// - action "push-key": devuelve la clave pública para activar notificaciones en el celular.
// - action "cron": la llama la base cada 15 minutos para mandar los recordatorios de agua.
// Las claves de IA quedan solo acá (secretos ANTHROPIC_API_KEY o GEMINI_API_KEY), nunca en la web.

import { z } from 'npm:zod@4.1.13';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
// Las librerías pesadas (Claude y notificaciones) se cargan solo cuando hacen falta,
// para no pasarse del límite de memoria/procesador del plan gratis de Supabase.
const loadAnthropic = async () => {
  const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
    import('npm:@anthropic-ai/sdk@1.3.0'),
    import('npm:@anthropic-ai/sdk@1.3.0/helpers/zod')
  ]);
  return { Anthropic, zodOutputFormat };
};
const loadWebpush = async () => (await import('npm:web-push@3.6.7')).default;

const MODEL = 'claude-haiku-5-5';
// Proveedor de IA: si está la clave de Anthropic usa Claude Haiku; si no, Gemini (plan gratis de Google).
// Se puede forzar con el secreto AI_PROVIDER = "anthropic" o "gemini".
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
function provider() {
  const forced = (Deno.env.get('AI_PROVIDER') || '').toLowerCase();
  if (forced === 'anthropic' || forced === 'gemini') return forced;
  if (Deno.env.get('ANTHROPIC_API_KEY')) return 'anthropic';
  if (Deno.env.get('GEMINI_API_KEY')) return 'gemini';
  return null;
}

// Pide a la IA una respuesta JSON que cumpla el esquema.
async function ia<T extends z.ZodType>(system: string, user: string, schema: T, effort: 'low' | 'medium', maxTokens: number): Promise<z.infer<T>> {
  if (provider() === 'gemini') return gemini(system, user, schema);
  const { Anthropic, zodOutputFormat } = await loadAnthropic();
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal') throw new Error('La IA no pudo procesar ese texto.');
  if (!res.parsed_output) throw new Error('La IA no devolvió un resultado válido. Probá de nuevo.');
  return res.parsed_output as z.infer<T>;
}

async function gemini<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> {
  const key = Deno.env.get('GEMINI_API_KEY');
  const jsonSchema = z.toJSONSchema(schema);
  const call = (withSchema: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: withSchema ? system : `${system}\n\nRespondé SOLO con un JSON que cumpla este esquema:\n${JSON.stringify(jsonSchema)}` }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', ...(withSchema ? { responseJsonSchema: jsonSchema } : {}) }
    })
  });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // por si el modelo no acepta el esquema
  if (r.status === 429) throw Object.assign(new Error('rate'), { status: 429 });
  if (r.status === 400 || r.status === 403) throw new Error('La clave de Gemini no es válida o el modelo no está disponible. Revisá GEMINI_API_KEY.');
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
  let obj: unknown;
  try { obj = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new Error('La IA no devolvió un resultado válido. Probá de nuevo.'); }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) { console.error('gemini schema', parsed.error, text); throw new Error('La IA devolvió datos incompletos. Probá de nuevo.'); }
  return parsed.data;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false }
});

// ───────────────────────── IA: analizar comida ─────────────────────────

const Item = z.object({
  nombre: z.string().describe('Nombre corto del alimento o bebida, en castellano'),
  cantidad: z.number().describe('Cantidad dicha (ej. 2 para "dos empanadas")'),
  unidad: z.string().describe('unidad, porción, vaso, lata, g, ml, plato, rebanada, etc.'),
  gramos: z.number().describe('Peso o volumen total estimado en g o ml'),
  kcal: z.number(),
  proteinas_g: z.number(),
  carbos_g: z.number(),
  grasas_g: z.number(),
  fibra_g: z.number(),
  alcohol_g: z.number().describe('Gramos de alcohol puro; 0 si no es bebida alcohólica')
});

const Analisis = z.object({
  items: z.array(Item),
  tipo_comida: z.enum(['desayuno', 'almuerzo', 'merienda', 'cena', 'colacion', 'bebida', 'ninguna']),
  momento: z.string().nullable().describe('Fecha y hora local "YYYY-MM-DDTHH:MM" si la persona dijo cuándo fue; null si es ahora'),
  agua_ml: z.number().describe('Agua tomada que se mencionó, en ml; 0 si no se mencionó'),
  peso_kg: z.number().nullable().describe('Peso corporal si lo dijo; null si no'),
  cintura_cm: z.number().nullable().describe('Medida de cintura si la dijo; null si no'),
  aclaracion: z.string().describe('Una frase corta con lo que supusiste (porciones, tamaños). Vacío si no hace falta')
});

const SYSTEM_ANALIZAR = `Sos un nutricionista argentino que ayuda a registrar comidas para bajar de peso.
Te pasan lo que una persona dijo por voz (puede tener errores de dictado) y tenés que devolver cada alimento o bebida con su porción y nutrientes estimados para ESA porción.

Reglas:
- Usá porciones y productos típicos de Argentina: empanada ≈ 90-110 g; milanesa ≈ 150 g; porción de pizza de muzzarella ≈ 1/8 de grande; factura ≈ 50 g; alfajor ≈ 50 g; "coca chica" = botella 500 ml (si dice "lata", 354 ml); vaso ≈ 250 ml; taza ≈ 250 ml; mate cocido/café solo sin azúcar ≈ 0-5 kcal; cucharada de azúcar ≈ 12 g.
- Distinguí light/zero/sin azúcar cuando lo digan. Si no dicen el tamaño, suponé la porción más común y aclaralo en "aclaracion".
- Cerveza ≈ 5% de alcohol, vino ≈ 12-13%, fernet ≈ 39% (un fernet con coca típico lleva ~60 ml de fernet). Calculá alcohol_g = ml × %alc × 0,789. Las calorías del alcohol van incluidas en kcal.
- Agua sola NO va en items: sumala en agua_ml. Mate amargo, té o café sin azúcar sí podés ponerlos como items con sus pocas kcal, y no los cuentes como agua.
- Si la persona menciona su peso o cintura, completá peso_kg o cintura_cm.
- tipo_comida: deducilo de lo que dijo o de la hora local; "bebida" si solo tomó algo; "ninguna" si no hay comida ni bebida.
- Redondeá kcal a enteros y macros a 1 decimal. Sé realista, ni optimista ni exagerado.`;

async function analizar(texto: string, ahora: string) {
  return ia(SYSTEM_ANALIZAR, `Fecha y hora local ahora: ${ahora}\nLo que dijo: "${texto}"`, Analisis, 'low', 4000);
}

// ───────────────────────── IA: consejos ─────────────────────────

const Consejos = z.object({
  resumen: z.string().describe('Dos o tres frases sobre cómo viene la persona'),
  consejos: z.array(z.string()).describe('Entre 3 y 5 sugerencias concretas y accionables')
});

const SYSTEM_CONSEJOS = `Sos un nutricionista argentino, cercano y directo, que acompaña a alguien que quiere bajar de peso.
Te pasan un resumen de sus últimos días (calorías, macros, agua, alcohol, peso y cintura, comidas frecuentes).
Hablá de vos, en castellano rioplatense, sin sermones. Basate solo en los datos. Sugerencias concretas (qué cambiar, por qué y cómo), con alimentos argentinos comunes.
No des indicaciones médicas; si algo parece riesgoso (muy pocas calorías, mucho alcohol), sugerí consultarlo con un profesional.`;

async function consejos(datos: unknown) {
  return ia(SYSTEM_CONSEJOS, JSON.stringify(datos), Consejos, 'medium', 3000);
}

// ───────────────────────── Notificaciones ─────────────────────────

async function getConfig(key: string) {
  const { data } = await admin.from('peso_server_config').select('value').eq('key', key).maybeSingle();
  return data?.value as string | undefined;
}

async function vapid() {
  const webpush = await loadWebpush();
  let pub = await getConfig('vapid_public');
  let priv = await getConfig('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    await admin.from('peso_server_config').upsert([
      { key: 'vapid_public', value: pub },
      { key: 'vapid_private', value: priv }
    ]);
  }
  webpush.setVapidDetails('mailto:avisos@control-peso.app', pub, priv);
  return pub;
}

// Hora local "HH:MM" y fecha "YYYY-MM-DD" en la zona de la persona.
function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const toMin = (hm: string) => { const [h, m] = hm.slice(0, 5).split(':').map(Number); return h * 60 + m; };

async function cron() {
  await vapid();
  const webpush = await loadWebpush();
  const { data: subs } = await admin.from('peso_push_subs').select('*');
  if (!subs?.length) return { enviados: 0 };
  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const { data: profiles } = await admin.from('peso_profiles').select('*').in('user_id', userIds).eq('water_reminders', true);
  let enviados = 0;
  for (const p of profiles || []) {
    const tz = p.timezone || 'America/Argentina/Buenos_Aires';
    const { date, hm } = localParts(tz);
    const now = toMin(hm), start = toMin(p.reminder_start || '09:00'), end = toMin(p.reminder_end || '21:00');
    if (now < start || now > end) continue;

    // Agua tomada hoy (desde la medianoche local; tomamos 30 h hacia atrás y filtramos por fecha local).
    const { data: agua } = await admin.from('peso_metrics').select('value, measured_at')
      .eq('user_id', p.user_id).eq('kind', 'agua').gte('measured_at', new Date(Date.now() - 30 * 3600e3).toISOString());
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
        await admin.from('peso_push_subs').update({ last_sent_at: new Date().toISOString() }).eq('id', s.id);
        enviados++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from('peso_push_subs').delete().eq('id', s.id); // el celular dio de baja
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
    if (action === 'push-key') return json({ publicKey: await vapid() });

    // El resto necesita una sesión iniciada.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Iniciá sesión de nuevo.' }, 401);
    const allowed = (Deno.env.get('ALLOWED_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes((u.user.email || '').toLowerCase())) return json({ error: 'Usuario no habilitado.' }, 403);

    if (!provider() && (action === 'analizar' || action === 'consejos')) {
      return json({ error: 'Falta cargar la clave de la IA en los secretos de Supabase: GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY.' }, 500);
    }
    if (action === 'analizar') {
      const texto = String(body.texto || '').trim().slice(0, 2000);
      if (!texto) return json({ error: 'No llegó ningún texto.' }, 400);
      return json(await analizar(texto, String(body.ahora || new Date().toISOString())));
    }
    if (action === 'consejos') return json(await consejos(body.datos));
    return json({ error: 'Acción desconocida' }, 400);
  } catch (err) {
    console.error(err);
    const status = (err as { status?: number }).status;
    if (status === 401) return json({ error: 'La clave de la IA no es válida. Revisala en los secretos de Supabase.' }, 500);
    if (status === 429) return json({ error: 'La IA está saturada, probá en un minuto.' }, 503);
    return json({ error: (err as Error).message || String(err) }, 500);
  }
});
