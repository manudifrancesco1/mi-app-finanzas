// pages/api/email/promote/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createHash } from 'crypto'

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

const BODY_REGEX_3 =
  /Comercio:\s*([^\n\r]+)[\s\S]*?Moneda:\s*([A-Z]{3})[\s\S]*?Monto:\s*\$?\s*([\d\.,]+)/i

const LAST4_REGEX =
  /(Terminación|Tarjeta)\s*:?\s*(\d{3,4})/i

const normalizeAmount = (raw: string) =>
  Number(raw.replace(/\./g, '').replace(',', '.'))

const txHash = (user_id: string, date_local: string, merchant: string, amount: number, currency: string) =>
  createHash('sha256').update(`${user_id}|${date_local}|${merchant}|${amount}|${currency}`).digest('hex')

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

  const { data: rules } = await admin
    .from('merchant_rules')
    .select('pattern,is_regex,priority,category_id,subcategory_id,active')
    .eq('user_id', user_id)
    .eq('active', true)
    .order('priority', { ascending: true })

  const applyRule = (merchant: string) => {
    const hay = (merchant || '').toLowerCase()
    for (const r of rules || []) {
      if (!r) continue
      if (!r.is_regex) {
        if (hay.includes((r.pattern || '').toLowerCase())) return r
      } else {
        try {
          if (new RegExp(r.pattern, 'i').test(merchant || '')) return r
        } catch {}
      }
    }
    return null
  }

  const out: Out = { ok: true, attempted: 0, updated: 0, errors: 0, details: [] }

  // presupuesto de tiempo para evitar timeout en serverless
  const DEADLINE = Date.now() + 18000; // ~18s

  // IMAP setup (por si necesitamos leer cuerpo)
  const IMAP_HOST = String(process.env.IMAP_HOST || '')
  const IMAP_PORT = Number(process.env.IMAP_PORT || 993)
  const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() === 'true'
  const IMAP_USER = String(process.env.IMAP_USER || '')
  const IMAP_PASSWORD = String(process.env.IMAP_PASSWORD || '')
  const FROM_FILTER = (process.env.EMAIL_SYNC_FROM || 'visa.com').trim()

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
    if (Date.now() > DEADLINE) {
      out.details.push({ id: row.id, info: 'timeout-budget' })
      break
    }
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
      if ((!merchant || !amount || !currency) && Date.now() < DEADLINE) {
        const cli = await ensureImap()
        if (cli) {
          // Ventana ±24h alrededor del email para acotar búsqueda
          const center = row.email_datetime ? new Date(row.email_datetime) : new Date()
          const since = new Date(center.getTime() - 24 * 3600 * 1000)
          const before = new Date(center.getTime() + 24 * 3600 * 1000)
          const searchQuery: SearchObject = { since, before }
          const uidsRes = await cli.search(searchQuery)
          const uids = Array.isArray(uidsRes) ? uidsRes : []
          // Limitar a 80 más recientes
          const sample = uids.slice(-80).reverse()
          let matched = false

          for (const uid of sample) {
            // cut by time budget
            if (Date.now() > DEADLINE) break

            const msg: any = await cli.fetchOne(uid, { source: true, envelope: true, internalDate: true })
            if (!msg || !msg.source) continue
            const parsed = await simpleParser(msg.source as any)

            // From filter
            const fromName = (parsed.from?.value?.[0]?.name as string | undefined) || (msg.envelope?.from?.[0]?.name as string | undefined) || ''
            const fromAddr = (parsed.from?.value?.[0]?.address as string | undefined) || (msg.envelope?.from?.[0]?.address as string | undefined) || ''
            const hay = `${fromName} <${fromAddr}>`.toLowerCase()
            if (!hay.includes(FROM_FILTER.toLowerCase())) continue

            const subj = parsed.subject || ''
            const bodyTxt = (parsed.text || '').trim() || (parsed.html ? (parsed.html as string).replace(/<[^>]+>/g, ' ') : '')

            // Intentos de extracción en orden: subject, body variantes
            let mSubj2 = subj.match(VISA_SUBJECT_REGEX)
            let mBody1 = bodyTxt.match(BODY_REGEX_1)
            let mBody2 = bodyTxt.match(BODY_REGEX_2)
            let mBody3 = bodyTxt.match(BODY_REGEX_3)

            if (mSubj2) {
              merchant = (mSubj2[1] || '').trim()
              currency = (mSubj2[2] || row.currency || 'ARS').trim()
              amount = normalizeAmount(mSubj2[3] || '')
              last4 = (mSubj2[4] || '').trim()
              matched = true
            } else if (mBody1) {
              // BODY_REGEX_1: [1]=merchant [2]=currency [3]=amount
              merchant = (mBody1[1] || '').trim()
              currency = (mBody1[2] || row.currency || 'ARS').trim()
              amount = normalizeAmount(mBody1[3] || '')
              // last4 puede venir en otra línea
              const mL4 = bodyTxt.match(LAST4_REGEX)
              last4 = mL4 ? (mL4[2] || '').trim() : last4
              matched = true
            } else if (mBody2) {
              // BODY_REGEX_2: [1]=amount [2]=currency [3]=merchant [4]=last4
              amount = normalizeAmount(mBody2[1] || '')
              currency = (mBody2[2] || row.currency || 'ARS').trim()
              merchant = (mBody2[3] || '').trim()
              last4 = (mBody2[4] || '').trim()
              matched = true
            } else if (mBody3) {
              // BODY_REGEX_3: [1]=merchant [2]=currency [3]=amount
              merchant = (mBody3[1] || '').trim()
              currency = (mBody3[2] || row.currency || 'ARS').trim()
              amount = normalizeAmount(mBody3[3] || '')
              const mL4 = bodyTxt.match(LAST4_REGEX)
              last4 = mL4 ? (mL4[2] || '').trim() : last4
              matched = true
            }

            if (matched) break
          }

          if (!matched) {
            out.details.push({ id: row.id, subject, info: 'no-match-in-imap-window', window: { since: since.toISOString(), before: before.toISOString() } })
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

        const date_local = row.date_local || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(row.email_datetime))
        const dedupe = txHash(user_id, date_local, merchant!, amount!, currency!)
        const matched = applyRule(merchant!)

        const txPayload: any = {
          user_id,
          date: date_local,
          amount: amount!,
          currency: (currency || 'ARS').trim(),
          expense_mode: 'variable',
          description: merchant!,
          hash: dedupe,
        }

        if (matched?.category_id) txPayload.category_id = matched.category_id
        if (matched?.subcategory_id) txPayload.subcategory_id = matched.subcategory_id

        const { error: txErr } = await admin
          .from('transactions')
          .upsert([txPayload], { onConflict: 'hash', ignoreDuplicates: true })

        if (txErr) {
          out.details.push({ id: row.id, subject, warn: 'transaction upsert failed', err: txErr.message })
        } else {
          out.details.push({ id: row.id, subject, tx: 'upserted', merchant, amount, currency })
        }
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