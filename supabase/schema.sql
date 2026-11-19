-- Control de Peso: tablas, reglas de seguridad y recordatorios de agua.
-- Se puede correr en el mismo proyecto de Supabase de "Gastos en Familia":
-- todas las tablas empiezan con peso_ y no tocan nada de lo que ya existe.
-- Se puede volver a correr sin problema (no borra datos).

-- ───────────────────────── Perfil y metas ─────────────────────────
create table if not exists public.peso_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text,
  sex text check (sex in ('m', 'f')),
  birth_year int,
  height_cm numeric,
  activity text default 'ligera',          -- sedentaria | ligera | moderada | alta
  start_weight numeric,
  goal_weight numeric,
  kcal_goal int,                            -- meta diaria de calorías
  protein_goal int,                         -- gramos por día
  water_goal int default 2500,              -- ml por día
  alcohol_week_limit numeric default 7,     -- tragos estándar (10 g de alcohol) por semana
  timezone text default 'America/Argentina/Buenos_Aires',
  water_reminders boolean default false,
  reminder_start time default '09:00',
  reminder_end time default '21:00',
  reminder_every_min int default 90,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ───────────────────────── Comidas ─────────────────────────
-- Una "comida" es lo que se registró de una vez (por voz, texto o a mano).
create table if not exists public.peso_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text,                           -- desayuno | almuerzo | merienda | cena | colacion | bebida
  raw_text text,                            -- lo que se dijo o escribió
  source text not null default 'texto',     -- voz | texto | manual | import
  note text,
  created_at timestamptz default now()
);
create index if not exists peso_meals_user_date on public.peso_meals (user_id, eaten_at desc);

-- Cada alimento de la comida, con sus nutrientes ya calculados para la porción.
create table if not exists public.peso_meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.peso_meals on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  grams numeric,
  kcal numeric not null default 0,
  protein_g numeric default 0,
  carbs_g numeric default 0,
  fat_g numeric default 0,
  fiber_g numeric default 0,
  alcohol_g numeric default 0,              -- > 0 = bebida alcohólica (se suma aparte)
  sort int default 0
);
create index if not exists peso_items_meal on public.peso_meal_items (meal_id);
create index if not exists peso_items_user on public.peso_meal_items (user_id);

-- ───────────────────────── Mediciones ─────────────────────────
-- Tabla genérica para todo lo que es "un número en un momento":
-- hoy: peso (kg), cintura (cm), agua (ml).
-- después: pasos, kcal_activas, sueno_min, frecuencia, grasa_pct, hambre, animo...
-- source + external_id evitan duplicados al importar de Samsung Health / Health Connect.
create table if not exists public.peso_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,                       -- peso | cintura | agua | ...
  measured_at timestamptz not null default now(),
  value numeric not null,
  unit text,
  source text not null default 'manual',    -- manual | voz | samsung_health | health_connect
  external_id text,
  meta jsonb,
  created_at timestamptz default now()
);
create index if not exists peso_metrics_user_kind on public.peso_metrics (user_id, kind, measured_at desc);
create unique index if not exists peso_metrics_external on public.peso_metrics (user_id, source, external_id) where external_id is not null;

-- ───────────────────────── Notificaciones ─────────────────────────
create table if not exists public.peso_push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  last_sent_at timestamptz,
  created_at timestamptz default now()
);

-- Datos internos del servidor (claves de notificaciones, etc.). Sin reglas = nadie desde la web lo puede leer.
create table if not exists public.peso_server_config (
  key text primary key,
  value text not null
);

-- ───────────────────────── Seguridad: cada uno ve solo lo suyo ─────────────────────────
alter table public.peso_profiles enable row level security;
alter table public.peso_meals enable row level security;
alter table public.peso_meal_items enable row level security;
alter table public.peso_metrics enable row level security;
alter table public.peso_push_subs enable row level security;
alter table public.peso_server_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array['peso_profiles', 'peso_meals', 'peso_meal_items', 'peso_metrics', 'peso_push_subs'] loop
    execute format('drop policy if exists "propio" on public.%I', t);
    execute format('create policy "propio" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ───────────────────────── Recordatorios de agua (cada 15 minutos) ─────────────────────────
-- El servidor revisa quién tiene recordatorios activos y le manda un aviso al celular
-- si viene atrasado con el agua. Usa las extensiones pg_cron y pg_net de Supabase.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

insert into public.peso_server_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

do $$
begin
  perform cron.unschedule('peso-recordatorios');
exception when others then null;
end $$;

select cron.schedule(
  'peso-recordatorios',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xlwnzlvgtpiqguumqbal.supabase.co/functions/v1/peso-api',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'cron', 'secret', (select value from public.peso_server_config where key = 'cron_secret'))
  );
  $cron$
);
