// pages/api/email/promote.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

type Json = Record<string, unknown>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const EMAIL_INGEST_SECRET = process.env.EMAIL_INGEST_SECRET!

// Cliente admin (service role) SOLO en server-side API routes
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export default async function handler(req: NextApiRequest, res: NextApiResponse<Json>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Permitir Cron de Vercel sin secreto; para requests manuales exigirlo
  const fromCron = req.headers['x-vercel-cron'] === '1'
  const provided = req.headers['x-email-secret']
  if (!fromCron && provided !== EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  // Validaciones mínimas de entorno
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured (Supabase envs missing)' })
  }

  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50))

    // 1) Leer pendientes
    const { data: pending, error: selErr } = await admin
      .from('email_transactions')
      .select('*')
      .eq('processed', false)
      .order('id', { ascending: true })
      .limit(limit)

    if (selErr) throw selErr

    const insertedRows: any[] = []
    const errors: Array<{ id?: number; reason: string }> = []

    // 2) Procesar una por una (más claro; si quieres más perf, se puede batch + Promise.all con cuidado)
    for (const row of pending ?? []) {
      try {
        // Construir payload destino
        const payload = {
          user_id: row.user_id,
          amount: row.amount,
          currency: row.currency || 'ARS',
          date: row.date_local ?? row.date_utc ?? new Date().toISOString(),
          description: row.merchant || row.subject || 'Gasto tarjeta',
          tags: ['visa_alert'],
          payment_type: 'credit',
          merchant: row.merchant ?? null,
          source: 'email',
          raw_description: row.subject ?? null,
          hash: row.hash, // clave idempotente
        }

        // 2a) Upsert por hash
        const { data: upserted, error: upErr } = await admin
          .from('transactions')
          .upsert(payload, { onConflict: 'hash' })
          .select()

        if (upErr) throw upErr

        // 2b) Marcar como procesado (aunque ya existiera el hash)
        const { error: updErr } = await admin
          .from('email_transactions')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('id', row.id)

        if (updErr) throw updErr

        insertedRows.push(...(upserted ?? []))
      } catch (e: any) {
        errors.push({ id: row?.id, reason: e?.message ?? 'Unknown error' })
      }
    }

    return res.status(200).json({
      ok: true,
      attempted: pending?.length ?? 0,
      insertedCount: insertedRows.length,
      errorsCount: errors.length,
      // opcional: devolver ids para debug
      insertedIds: insertedRows.map((r) => r.id).filter(Boolean),
      errors,
    })
  } catch (e: any) {
    // No logueamos secretos, solo mensaje
    console.error('[promote] error:', e?.message)
    return res.status(500).json({ ok: false, error: e?.message ?? 'Internal error' })
  }
}