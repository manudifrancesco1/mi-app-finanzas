import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

type Parsed = {
  amount?: number
  currency?: string
  merchant?: string
  card_last4?: string
  occurred_at?: string
}

function extractMerchant(text: string): string | undefined {
  // Prefer explicit label "Comercio: XXX" (stop at hyphen, dot, comma or EOL)
  const byLabel = /Comercio:\s*([^\n\r\.,-]+?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (byLabel?.[1]) return cleanupMerchant(byLabel[1])

  // Common phrasing: "Compra en XXX" (stop at typical separators)
  const compraEn = /Compra\s+en\s+([^\n\r\.,-]+?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (compraEn?.[1]) return cleanupMerchant(compraEn[1])

  // Generic fallback: " en XXX" up to a separator
  const genericEn = /\ben\s+([^\n\r\.,-]{3,}?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (genericEn?.[1]) return cleanupMerchant(genericEn[1])

  return undefined
}

function cleanupMerchant(raw: string): string {
  let s = raw
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s{2,}/g, ' ')

  // Remove leading verbs/labels like "COMPRA EN"
  s = s.replace(/^(COMPRA|PAGO|CONSUMO)\s+EN\s+/i, '')

  // Cut at common trailing labels if they leaked in
  s = s.replace(/\b(MONEDA|ARS|AR\$|PESOS?)\b.*$/i, '')

  return s.trim().toUpperCase()
}

function parseEmail(subject: string, body: string, dateIso?: string): Parsed {
  const text = `${subject} ${body}`

  // Parse amount ($1.234,56 or 1234.56)
  const montoMatch =
    text.match(/(?:\$|\b)(\d{1,3}(?:\.\d{3})*,\d{2})/) ||
    text.match(/(?:\$|\b)(\d+(?:\.\d+)?)/)
  let amount: number | undefined
  if (montoMatch) {
    const raw = montoMatch[1]
    amount = raw.includes(',')
      ? Number(raw.replace(/\./g, '').replace(',', '.'))
      : Number(raw)
  }

  const currency =
    /ARS|USD|EUR/.exec(text)?.[0] ||
    (text.includes('$') ? 'ARS' : undefined)

  let merchant: string | undefined = extractMerchant(subject) || extractMerchant(body) || extractMerchant(text)

  const last4Match =
    /terminación\s*(\d{4})/i.exec(text) ||
    /(\d{4})\b(?!.*\d)/.exec(text)
  const card_last4 = last4Match?.[1]

  const occurred_at = dateIso

  return { amount, currency, merchant, card_last4, occurred_at }
}

function hashPayload(subject: string, body: string, date?: string) {
  return crypto
    .createHash('sha256')
    .update([subject || '', body || '', date || ''].join('|'))
    .digest('hex')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  const secret = req.headers['x-email-secret']
  if (!secret || secret !== process.env.EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  try {
    const { subject = '', body = '', date, user_id } = (req.body || {}) as {
      subject?: string
      body?: string
      date?: string
      user_id?: string
    }

    const parsed = parseEmail(subject, body, date)

    // Optional DB upsert into staging `email_transactions`
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    let db = { attempted: false, inserted: null as any, error: null as any }

    if (supabaseUrl && serviceKey && user_id) {
      db.attempted = true
      try {
        const admin = createClient(supabaseUrl, serviceKey)
        const hash = hashPayload(subject, body, parsed.occurred_at)

        const payload = {
          user_id,
          hash,
          subject,
          body,
          email_datetime: parsed.occurred_at || new Date().toISOString(),
          date_local: parsed.occurred_at ? parsed.occurred_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          merchant: parsed.merchant || null,
          city: null,
          amount: parsed.amount ?? null,
          currency: parsed.currency || 'ARS',
          card_last4: parsed.card_last4 || null,
          source: 'Email',
          description: parsed.merchant ? `${parsed.merchant}${parsed.card_last4 ? ` (****${parsed.card_last4})` : ''}` : subject,
          tags: 'visa_alert',
          processed: false,
        }

        // Ensure table exists on your DB. Expected unique index on `hash`.
        const { data, error } = await admin
          .from('email_transactions')
          .upsert(payload, { onConflict: 'hash' })
          .select()

        if (error) {
          db.error = error.message
        } else {
          db.inserted = data
        }
      } catch (e: any) {
        db.error = e?.message || String(e)
      }
    }

    return res.status(200).json({ ok: true, received: { subject, date, hasBody: Boolean(body), user_id: user_id || null }, parsed, db })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'ingest failed' })
  }
}