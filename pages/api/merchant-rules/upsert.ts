// pages/api/merchant-rules/upsert.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    if (!supabaseUrl || !serviceKey) return res.status(500).json({ ok: false, error: 'Missing Supabase envs' })
    const admin = createClient(supabaseUrl, serviceKey)

    const { user_id, pattern, is_regex = false, category_id = null, subcategory_id = null, priority = 100, active = true } =
      (req.body || {}) as {
        user_id?: string
        pattern?: string
        is_regex?: boolean
        category_id?: string | null
        subcategory_id?: string | null
        priority?: number
        active?: boolean
      }

    if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' })
    if (!pattern || !String(pattern).trim()) return res.status(400).json({ ok: false, error: 'missing pattern' })

    const row = {
      user_id,
      pattern: String(pattern).trim(),
      is_regex: !!is_regex,
      category_id,
      subcategory_id,
      priority: Number(priority) || 100,
      active: !!active,
      updated_at: new Date().toISOString(),
    }

    // upsert por (user_id, pattern)
    const { data, error } = await admin
      .from('merchant_rules')
      .upsert([row], { onConflict: 'user_id,pattern' })
      .select()
      .single()

    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, rule: data })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'internal error' })
  }
}