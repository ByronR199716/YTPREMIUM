/**
 * Acceso por códigos de YTPremium.
 *
 * Usa el mismo servidor (Supabase) y el mismo panel que PremiumMusic.
 * La "anon public key" está pensada para ir dentro de apps: no da acceso a las tablas,
 * solo a las funciones públicas como validate_access.
 */
export const AccessConfig = {
  SUPABASE_URL: 'https://dcgaxwkxqbyvuwgsionf.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZ2F4d2t4cWJ5dnV3Z3Npb25mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzIxODUsImV4cCI6MjEwNjgwODE4NX0.Bql5bv4ZIPASPw558vnkTz9idcYmqqqWleMYrzcCXsc',
  /** Servicio en el panel (tabla services). Los códigos de otros servicios no sirven aquí. */
  SERVICE: 'ytpremium',
  APP_TITLE: 'YTPremium',
} as const
