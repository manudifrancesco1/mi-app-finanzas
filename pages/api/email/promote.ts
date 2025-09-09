

// pages/api/email/promote.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, serviceRoleKey)

const EMAIL_INGEST_SECRET = process.env.EMAIL_INGEST_SECRET!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Allow internal Vercel Cron calls without the shared secret
  const fromCron = req.headers['x-vercel-cron'] === '1'
  if (!fromCron && req.headers['x-email-secret'] !== EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  try {
    // Support optional limit param, default 50, cap at 200
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50))
    // 1) Select all pending email_transactions
    const { data: pending, error: selErr } = await admin
      .from('email_transactions')
      .select('*')
      .eq('processed', false)
      .limit(limit)

    if (selErr) throw selErr

    let inserted: any[] = []
    let errors: any[] = []

    for (const row of pending || []) {
      const payload = {
        user_id: row.user_id,
        amount: row.amount,
        currency: row.currency || 'ARS',
        date: row.date_local,
        description: row.merchant || row.subject || 'Gasto tarjeta',
        tags: ['visa_alert'],
        payment_type: 'credit',
        merchant: row.merchant,
        source: 'email',
        raw_description: row.subject,
        hash: row.hash,
      }

      const { data, error } = await admin
        .from('transactions')
        .upsert(payload, { onConflict: 'hash' })
        .select()

      if (error) {
        errors.push({ row, error })
      } else {
        inserted.push(...(data || []))
        // marcar como procesada
        await admin.from('email_transactions').update({ processed: true }).eq('id', row.id)
      }
    }
 
    return res.status(200).json({
      ok: true,
      attempted: pending?.length || 0,
      inserted,
      errors,
    })
  } catch (e: any) {
    console.error(e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}