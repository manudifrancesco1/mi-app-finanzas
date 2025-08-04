// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

console.log('Supabase URL:', supabaseUrl)
console.log('Supabase ANON KEY:', supabaseAnonKey?.slice(0, 10) + '…')

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
// Después de export const supabase = createClient(...)
console.log('🛰️  Supabase Client URL:', supabaseUrl)
console.log('🔑  Supabase Client Key:', supabaseAnonKey?.slice(0,8) + '…')
