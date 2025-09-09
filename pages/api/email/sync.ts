// pages/api/email/sync.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
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
  const byLabel = /Comercio:\s*([^\n\r\.,-]+?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (byLabel?.[1]) return cleanupMerchant(byLabel[1])
  const compraEn = /Compra\s+en\s+([^\n\r\.,-]+?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (compraEn?.[1]) return cleanupMerchant(compraEn[1])
  const genericEn = /\ben\s+([^\n\r\.,-]{3,}?)(?=\s*-|[\.,\n\r]|$)/i.exec(text)
  if (genericEn?.[1]) return cleanupMerchant(genericEn[1])
  return undefined
}
function cleanupMerchant(raw: string): string {
  let s = raw.trim().replace(/\s{2,}/g, ' ')
  s = s.replace(/^(COMPRA|PAGO|CONSUMO)\s+EN\s+/i, '')
  s = s.replace(/\b(MONEDA|ARS|AR\$|PESOS?)\b.*$/i, '')
  return s.trim().toUpperCase()
}
function parseEmail(subject: string, body: string, dateIso?: string): Parsed {
  const text = `${subject} ${body}`

  // 1) Patrones "fuertes": Monto/Importe + número (con o sin $) + opcional código moneda
  const strongAmount =
    /(?:Monto|Importe)\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:ARS|USD|EUR)?/i.exec(text) ||
    /(?:Monto|Importe)\s*:?\s*\$?\s*(\d+(?:\.\d+)?)(?:\s*(ARS|USD|EUR))?/i.exec(text)

  // 2) Patrones por código de moneda en contexto
  const currencyAmount =
    /(ARS|USD|EUR)\s*\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(text) ||
    /(ARS|USD|EUR)\s*\$?\s*(\d+(?:\.\d+)?)/i.exec(text)

  // 3) Patrones con símbolo $
  const symbolAmount =
    /\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(text) ||
    /\$\s*(\d+(?:\.\d+)?)/i.exec(text)

  let amount: number | undefined

  const picked =
    strongAmount ??
    (currencyAmount && (currencyAmount[2] ? ({ 1: currencyAmount[2] } as any) : null)) ??
    symbolAmount

  if (picked) {
    const raw = picked[1]
    amount = raw.includes(',')
      ? Number(raw.replace(/\./g, '').replace(',', '.'))
      : Number(raw)
  }

  // moneda: priorizar explícita, si no, inferir
  const currency =
    /ARS|USD|EUR/i.exec(text)?.[0]?.toUpperCase() ||
    (/\$/.test(text) ? 'ARS' : undefined)

  const merchant =
    extractMerchant(subject) || extractMerchant(body) || extractMerchant(text)

  const last4Match =
    /terminación\s*(\d{4})/i.exec(text) ||
    /(\d{4})\b(?!.*\d)/.exec(text)
  const card_last4 = last4Match?.[1]

  const occurred_at = dateIso

  return { amount, currency, merchant, card_last4, occurred_at }
}
async function ingestOne(
  admin: ReturnType<typeof createClient>,
  user_id: string,
  subject: string,
  body: string,
  date: Date,
  messageId?: string
) {
  const parsed = parseEmail(subject, body, date.toISOString())
  // incluir messageId en el hash si está disponible para dedupe más robusto
  const hash = crypto.createHash('sha256')
    .update([subject || '', body || '', parsed.occurred_at || '', messageId || ''].join('|'))
    .digest('hex')

  const payload = {
    user_id,
    hash,
    subject,
    body,
    email_datetime: parsed.occurred_at || new Date().toISOString(),
    date_local: (parsed.occurred_at || new Date().toISOString()).slice(0, 10),
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
  const { data, error } = await admin.from('email_transactions').upsert(payload, { onConflict: 'hash' }).select()
  if (error) throw new Error(error.message)
  return data
}
function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' })

  const secret = req.headers['x-email-secret'] || req.headers['x-email-sync-secret']
  if (!secret || secret !== process.env.EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const { user_id = process.env.DEFAULT_USER_ID, limit = 50, from = process.env.EMAIL_SYNC_FROM || '', days = 14 } =
    (req.body || {}) as { user_id?: string; limit?: number; from?: string; days?: number }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ ok: false, error: 'missing supabase env' })
  if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id' })

  const admin = createClient(supabaseUrl, serviceKey)
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT || 993),
    secure: String(process.env.IMAP_SECURE || 'true') === 'true',
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  })

  const out = { ok: true, attempted: 0, inserted: 0, errors: 0, details: [] as any[] }

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000)
    const searchQuery: SearchObject = { since }
    if (from) {
      searchQuery.from = from
    }

    const uids = await client.search(searchQuery)
    const msgs: any[] = []
    for await (const m of client.fetch(uids, { uid: true, envelope: true, source: true, internalDate: true })) {
      msgs.push(m)
    }

    msgs.sort((a, b) => (b.internalDate?.getTime?.() || 0) - (a.internalDate?.getTime?.() || 0))
    const selected = msgs.slice(0, Number(limit))

    for (const m of selected) {
      try {
        const parsedMail = await simpleParser(m.source as Buffer)
        const subject = parsedMail.subject || ''
        const body = (parsedMail.text || '').trim() || (parsedMail.html ? stripHtml(parsedMail.html) : '')
        await ingestOne(admin, user_id, subject, body, m.internalDate || new Date(), parsedMail.messageId || undefined)
        out.attempted++
        out.inserted++
      } catch (e: any) {
        out.attempted++
        out.errors++
        out.details.push({ uid: m.uid, error: e?.message || String(e) })
      }
    }

    return res.status(200).json(out)
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  } finally {
    try { await client.logout() } catch {}
  }
}