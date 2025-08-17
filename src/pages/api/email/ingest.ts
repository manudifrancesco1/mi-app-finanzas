// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'

// Read from NEXT_PUBLIC_* first (Next.js exposes these to the browser),
// fall back to non-public names if someone used different env keys.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ''

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  (process.env as any).SUPABASE_ANON_KEY ||
  ''

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail fast with a clear message instead of cryptic runtime errors
  throw new Error(
    'Supabase envs missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)