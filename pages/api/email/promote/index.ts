// pages/api/email/promote/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, serviceRoleKey)


const EMAIL_INGEST_SECRET = process.env.EMAIL_INGEST_SECRET!

// Robust parser for Visa alert emails (AR format)
function parseVisaAlertEmail(body: string) {
  const merchant = /Comercio:\s*([^\n\r]+)/i.exec(body)?.[1]?.trim() ?? null;
  const city = /Ciudad:\s*([^\n\r]+)/i.exec(body)?.[1]?.trim() ?? null;
  const last4 = /Tarjeta:\s*(\d{4})/i.exec(body)?.[1]?.trim() ?? null;
  const currency = /Moneda:\s*([A-Z]{3})/i.exec(body)?.[1]?.trim() ?? null;
  // e.g. "Monto: 211278.59 (puede haber...)" or "Monto: 1,649.00 (aprox ...)"
  const rawAmount = /Monto:\s*([\d.,]+)/i.exec(body)?.[1] ?? null;
  const amount =
    rawAmount != null
      ? parseFloat(rawAmount.replace(/\./g, '').replace(',', '.'))
      : null;

  return { merchant, city, card_last4: last4, currency, amount };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Permitir llamadas del Cron de Vercel sin secreto
  const fromCron = req.headers['x-vercel-cron'] === '1'
  if (!fromCron && req.headers['x-email-secret'] !== EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50))

    const { data: pending, error: selErr } = await admin
      .from('email_transactions')
      .select('*')
      .eq('processed', false)
      .limit(limit)

    if (selErr) throw selErr

    const inserted: any[] = []
    const errors: any[] = []

    for (const row of pending || []) {
      const parsed = parseVisaAlertEmail(String(row.body ?? ''));

      const amount =
        row.amount != null && !Number.isNaN(Number(row.amount))
          ? Number(row.amount)
          : parsed.amount;

      const currency = row.currency ?? parsed.currency ?? 'ARS';
      const merchant = row.merchant ?? parsed.merchant ?? null;

      // If we still don't have a valid amount, skip to avoid NOT NULL errors
      if (amount == null || Number.isNaN(Number(amount))) {
        errors.push({ row, error: { message: 'Missing amount after parse' } });
        continue;
      }

      const payload = {
        user_id: row.user_id,
        amount,
        currency,
        date: row.date_local,
        description: merchant ?? row.subject ?? 'Gasto tarjeta',
        tags: ['visa_alert'],
        payment_type: 'credit',
        merchant: merchant ?? undefined,
        source: 'email',
        raw_description: row.subject,
        hash: row.hash,
      };

      const { data, error } = await admin
        .from('transactions')
        .upsert(payload, { onConflict: 'hash' })
        .select();

      if (error) {
        errors.push({ row, error });
      } else {
        inserted.push(...(data || []));
        await admin
          .from('email_transactions')
          .update({ processed: true })
          .eq('id', row.id);
      }
    }

    return res.status(200).json({
      ok: true,
      attempted: pending?.length || 0,
      insertedCount: inserted.length,
      errorsCount: errors.length,
      errors,
    })
  } catch (e: any) {
    console.error(e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}