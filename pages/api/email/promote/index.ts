// pages/api/email/promote/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const SECRET = process.env.EMAIL_INGEST_SECRET

type Out = {
  ok: boolean
  attempted: number
  updated: number
  errors: number
  details: any[]
}

const VISA_REGEX =
  /VISA\s+Consumo\s+autorizado\s*-\s*Comercio:\s*(.+?)\s*-\s*Moneda:\s*([A-Z]{3})\s*-\s*Monto:\s*\$\s*([\d\.\,]+)\s*-\s*Terminación\s*(\d+)/i

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out | any>) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'Method not allowed' }] })

  try {
    // simple auth to avoid public abuse
    if (!SECRET || req.headers['x-email-secret'] !== SECRET) {
      return res.status(401).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'Unauthorized' }] })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'Missing Supabase envs' }] })
    }
    const admin = createClient(supabaseUrl, serviceKey)

    const { user_id: bodyUserId, limit = 50 } = (req.body ?? {}) as { user_id?: string; limit?: number }
    const user_id = bodyUserId || process.env.DEFAULT_USER_ID
    if (!user_id) return res.status(400).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'missing user_id' }] })

    // traer pendientes para este usuario
    const { data: pending, error: qErr } = await admin
      .from('email_transactions')
      .select('id, subject, email_datetime, processed, currency')
      .eq('user_id', user_id)
      .eq('processed', false)
      .order('email_datetime', { ascending: false })
      .limit(Number(limit))

    if (qErr) return res.status(500).json({ ok: false, attempted: 0, updated: 0, errors: 1, details: [{ error: qErr.message }] })

    const out: Out = { ok: true, attempted: pending?.length || 0, updated: 0, errors: 0, details: [] }

    for (const row of pending || []) {
      try {
        const subject = row.subject || ''
        const m = subject.match(VISA_REGEX)
        if (!m) {
          // no se pudo parsear, lo dejamos pendiente
          out.details.push({ id: row.id, subject, info: 'skip: no visa match' })
          continue
        }
        const merchant = m[1].trim()
        const currency = (m[2] || row.currency || 'ARS').trim()
        const rawAmount = m[3].trim()
        const last4 = m[4].trim()

        // normalizar monto "6.248,69" -> 6248.69
        const amount = Number(rawAmount.replace(/\./g, '').replace(',', '.'))

        // marcar como procesado y guardar campos parseados
        const { error: upErr } = await admin
          .from('email_transactions')
          .update({
            merchant,
            currency,
            amount,
            card_last4: last4,
            processed: true,
          })
          .eq('id', row.id)
          .eq('user_id', user_id)

        if (upErr) {
          out.errors++
          out.details.push({ id: row.id, subject, error: upErr.message })
        } else {
          out.updated++
        }
      } catch (e: any) {
        out.errors++
        out.details.push({ id: row.id, error: e?.message || String(e) })
      }
    }

    return res.status(200).json(out)
  } catch (e: any) {
    return res.status(500).json({ ok: false, attempted: 0, updated: 0, errors: 1, details: [{ error: e?.message || 'Internal error' }] })
  }
}