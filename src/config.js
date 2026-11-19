// Datos de conexión a Supabase (el mismo proyecto que Gastos en Familia).
// La clave "publishable" está pensada para ir en la web: la seguridad la dan las reglas
// de la base (cada uno ve solo sus datos). La clave de Anthropic NO va acá: vive en el servidor.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xlwnzlvgtpiqguumqbal.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_5gj1parCAPImvn-z0VWq7w_cTawz9y8';
