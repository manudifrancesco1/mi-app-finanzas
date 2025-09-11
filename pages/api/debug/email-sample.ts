import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'Missing Supabase envs' })
    }
    const admin = createClient(supabaseUrl, serviceKey)

    const { count, error: countErr } = await admin
      .from('email_transactions')
      .select('id', { count: 'exact', head: true })
    if (countErr) throw countErr

    const { data, error } = await admin
      .from('email_transactions')
      .select('id,user_id,email_datetime,date_local,subject,merchant,amount,currency,processed')
      .order('email_datetime', { ascending: false })
      .limit(10)
    if (error) throw error

    return res.status(200).json({ ok: true, count, sample: data })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}