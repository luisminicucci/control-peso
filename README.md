# Control de Peso

App web para bajar de peso. Funciona en la compu y se instala en el celular como una app (PWA).

## Qué hace

- **Registro de comida por voz**: tocás el micrófono y decís "me comí dos empanadas de carne y una coca chica". Claude Haiku calcula calorías, proteínas, carbohidratos, grasas, fibra y alcohol. Se puede corregir todo antes de guardar. También por texto o a mano.
- **Hoy**: calorías que te quedan, macros, agua con botones rápidos, alcohol de la semana (aparte, en tragos estándar) y peso del día.
- **Cuerpo**: peso y cintura con gráfico de tendencia, IMC, ritmo semanal y cuánto falta para el objetivo.
- **Informes**: calorías por día contra la meta, déficit estimado, de dónde vienen las calorías, agua, alcohol por semana, alimentos que más suman, sugerencias automáticas y análisis con IA.
- **Recordatorios de agua**: notificaciones en el celular (aunque la app esté cerrada) si venís atrasado.
- Metas calculadas con tu edad, altura, peso y actividad (déficit de ~500 kcal por día).

## Puesta en marcha

Usa el mismo proyecto de Supabase que *Gastos en Familia* (tablas aparte, con prefijo `peso_`).

1. **Tablas**: en Supabase, *SQL Editor* → *New query*, pegar el contenido de [`supabase/schema.sql`](supabase/schema.sql) y tocar *Run*.
2. **Función del servidor**: *Edge Functions* → *Deploy a new function* → *Via Editor*. Nombre: `peso-api`. Pegar el contenido de [`supabase/functions/peso-api/index.ts`](supabase/functions/peso-api/index.ts) y tocar *Deploy function*. Después, en los ajustes de la función, **desactivar "Verify JWT"** (la función verifica el usuario por su cuenta; hace falta para los recordatorios).
3. **Clave de Anthropic**: crearla en [console.anthropic.com](https://console.anthropic.com/settings/keys) y cargarla en Supabase, *Edge Functions* → *Secrets*, con el nombre `ANTHROPIC_API_KEY`. Nunca va en la web.
4. **GitHub Pages**: en *Settings › Pages*, elegir *Source: GitHub Actions*. Cada cambio en `main` se publica solo.

Opcional: el secreto `ALLOWED_EMAILS` (emails separados por coma) limita quién puede usar la IA.

## Datos

- `peso_profiles`: datos personales, metas y recordatorios.
- `peso_meals` + `peso_meal_items`: cada comida y sus alimentos con nutrientes.
- `peso_metrics`: tabla genérica de mediciones (`peso`, `cintura`, `agua`, y más adelante pasos, sueño, ánimo...). `source` + `external_id` evitan duplicados al importar de Samsung Health / Health Connect.
- `peso_push_subs`: dispositivos con notificaciones activadas.

## Desarrollo

```bash
npm install
npm run dev
```

Hecho con React + Vite + Supabase + Claude Haiku.
