// pages/api/email/promote/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'

const SECRET = process.env.EMAIL_INGEST_SECRET

type Out = {
  ok: boolean
  attempted: number
  updated: number
  errors: number
  details: any[]
}

// Ejemplos que solemos ver en Visa AR (en subject o cuerpo)
const VISA_SUBJECT_REGEX =
  /VISA\s+Consumo\s+autorizado\s*-\s*Comercio:\s*(.+?)\s*-\s*Moneda:\s*([A-Z]{3})\s*-\s*Monto:\s*\$\s*([\d\.\,]+)\s*-\s*Terminación\s*(\d+)/i

// En algunos correos el detalle viene en el cuerpo
const BODY_REGEX_1 =
  /Comercio:\s*(.+?)\s*-\s*Moneda:\s*([A-Z]{3})\s*-\s*Monto:\s*\$\s*([\d\.\,]+)\s*-\s*Terminación\s*(\d+)/i

const BODY_REGEX_2 =
  /Consumo autorizado[\s\S]*?Monto:\s*\$\s*([\d\.\,]+)[\s\S]*?Moneda:\s*([A-Z]{3})[\s\S]*?(?:en|Comercio:)\s*([A-Z0-9\*\s\.\-]+)[\s\S]*?Terminación\s*(\d+)/i

const normalizeAmount = (raw: string) =>
  Number(raw.replace(/\./g, '').replace(',', '.'))

function fmtYMDLocal(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(d)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out | any>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'Method not allowed' }] })
  }

  // simple auth
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
  if (!user_id) {
    return res.status(400).json({ ok: false, attempted: 0, updated: 0, errors: 0, details: [{ error: 'missing user_id' }] })
  }

  // IMAP setup (por si necesitamos leer cuerpo)
  const IMAP_HOST = String(process.env.IMAP_HOST || '')
  const IMAP_PORT = Number(process.env.IMAP_PORT || 993)
  const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() === 'true'
  const IMAP_USER = String(process.env.IMAP_USER || '')
  const IMAP_PASSWORD = String(process.env.IMAP_PASSWORD || '')
  const FROM_FILTER = (process.env.EMAIL_SYNC_FROM || 'visa.com').trim()

  const out: Out = { ok: true, attempted: 0, updated: 0, errors: 0, details: [] }

  // 1) Traer pendientes
  const { data: pending, error: qErr } = await admin
    .from('email_transactions')
    .select('id, subject, email_datetime, processed, currency, date_local')
    .eq('user_id', user_id)
    .eq('processed', false)
    .order('email_datetime', { ascending: false })
    .limit(Number(limit))

  if (qErr) {
    return res.status(500).json({ ok: false, attempted: 0, updated: 0, errors: 1, details: [{ error: qErr.message }] })
  }

  out.attempted = pending?.length || 0
  if (!pending || pending.length === 0) {
    return res.status(200).json(out)
  }

  // 2) Conexión IMAP (lazy: sólo si hace falta)
  let client: ImapFlow | null = null
  async function ensureImap() {
    if (client) return client
    if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return null
    client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: IMAP_SECURE,
      auth: { user: IMAP_USER, pass: IMAP_PASSWORD }
    })
    await client.connect()
    await client.mailboxOpen('INBOX')
    return client
  }

  // 3) Procesar
  for (const row of pending) {
    try {
      const subject = row.subject || ''
      let merchant: string | null = null
      let currency: string | null = null
      let amount: number | null = null
      let last4: string | null = null

      // a) Intentar parsear del subject
      const mSubj = subject.match(VISA_SUBJECT_REGEX)
      if (mSubj) {
        merchant = mSubj[1].trim()
        currency = (mSubj[2] || row.currency || 'ARS').trim()
        amount = normalizeAmount(mSubj[3])
        last4 = mSubj[4].trim()
      }

      // b) Si no se pudo, intentar del cuerpo (IMAP)
      if (!merchant || !amount || !currency) {
        const cli = await ensureImap()
        if (cli) {
          // Buscar por fecha aproximada y remitente
          const center = row.email_datetime ? new Date(row.email_datetime) : new Date()
          const since = new Date(center.getTime() - 48 * 3600 * 1000) // 48h antes
          const searchQuery: SearchObject = { since }
          const uidsRes = await cli.search(searchQuery)
          const uids = Array.isArray(uidsRes) ? uidsRes : []
          // Tomar últimos 200 para acotar
          const sample = uids.slice(-200).reverse()

          for (const uid of sample) {
            const msg: any = await cli.fetchOne(uid, { source: true, envelope: true, internalDate: true })
            if (!msg || !msg.source) continue
            const parsed = await simpleParser(msg.source as any)

            // From filter
            const fromName = (parsed.from?.value?.[0]?.name as string | undefined) || (msg.envelope?.from?.[0]?.name as string | undefined) || ''
            const fromAddr = (parsed.from?.value?.[0]?.address as string | undefined) || (msg.envelope?.from?.[0]?.address as string | undefined) || ''
            const hay = `${fromName} <${fromAddr}>`.toLowerCase()
            if (!hay.includes(FROM_FILTER.toLowerCase())) continue

            // Subject match
            const subj = parsed.subject || ''
            if (!/Alerta de Compras Visa/i.test(subj) && !VISA_SUBJECT_REGEX.test(subj)) continue

            const bodyTxt = (parsed.text || '').trim() || (parsed.html ? (parsed.html as string).replace(/<[^>]+>/g, ' ') : '')
            let mm = subj.match(VISA_SUBJECT_REGEX) || bodyTxt.match(BODY_REGEX_1) || bodyTxt.match(BODY_REGEX_2)
            if (mm) {
              // Mapear grupos segun regex
              if (mm.length >= 5) {
                // subj/body con grupos [1]=merchant [2]=currency [3]=amount [4]=last4
                merchant = (mm[1] || '').trim()
                currency = (mm[2] || row.currency || 'ARS').trim()
                amount = normalizeAmount(mm[3] || '')
                last4 = (mm[4] || '').trim()
              } else if (mm.length >= 4) {
                // BODY_REGEX_2: [1]=amount [2]=currency [3]=merchant [4]=last4
                amount = normalizeAmount(mm[1] || '')
                currency = (mm[2] || row.currency || 'ARS').trim()
                merchant = (mm[3] || '').trim()
                last4 = (mm[4] || '').trim()
              }
              break
            }
          }
        }
      }

      if (!merchant || !amount || !currency) {
        out.details.push({ id: row.id, subject, info: 'skip: not enough data (merchant/amount/currency)' })
        continue
      }

      // c) Actualizar fila como procesada
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

  // Cerrar IMAP si se abrió
  if (client) {
    try {
      const c = client as ImapFlow
      await c.logout()
    } catch (_e) {
      // ignore logout errors
    }
  }

  return res.status(200).json(out)
}