// pages/api/email/sync.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

type Out = {
  ok: boolean
  attempted: number
  inserted: number
  errors: number
  details: any[]
}

function missingEnv(keys: string[]) {
  return keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '')
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const normalize = (s: string) =>
  s ? s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ') : ''

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out | any>) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: 'Method Not Allowed' }] })

  // Secret header (avoid public abuse)
  const secret = req.headers['x-email-secret']
  const expected = process.env.EMAIL_INGEST_SECRET
  if (!expected || secret !== expected) {
    return res.status(401).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: 'Unauthorized' }] })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: 'missing supabase env' }] })
  }

  const admin = createClient(supabaseUrl, serviceKey)

  const { user_id: bodyUserId, limit = 50, days = 14, from } = (req.body ?? {}) as {
    user_id?: string
    limit?: number
    days?: number
    from?: string
  }
  const user_id = bodyUserId || process.env.DEFAULT_USER_ID
  if (!user_id) return res.status(400).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: 'missing user_id' }] })

  // IMAP envs
  const missingImap = missingEnv(['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASSWORD'])
  if (missingImap.length) {
    return res.status(500).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: `missing imap env: ${missingImap.join(', ')}` }] })
  }
  const IMAP_HOST = String(process.env.IMAP_HOST)
  const IMAP_PORT = Number(process.env.IMAP_PORT)
  const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() === 'true'
  const IMAP_USER = String(process.env.IMAP_USER)
  const IMAP_PASSWORD = String(process.env.IMAP_PASSWORD)

  // Filters (permissive)
  const subjectPrefix = (process.env.EMAIL_SYNC_SUBJECT_PREFIX || '').trim()
  const fromFilterEnv = (process.env.EMAIL_SYNC_FROM || '').trim()
  const fromFilter = (from && String(from).trim()) || fromFilterEnv

  const out: Out = { ok: true, attempted: 0, inserted: 0, errors: 0, details: [] }
  const debug = {
    scanned: 0,
    matchedFrom: 0,
    matchedSubject: 0,
    skippedNoFromMatch: 0,
    skippedNoSubjectMatch: 0,
    skippedFwdRe: 0,
    examples: [] as { subject: string; fromName?: string; fromAddr?: string }[],
    filters: { fromFilter: fromFilter || null, subjectPrefix: subjectPrefix || null }
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }
  })

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000)
    const searchQuery: SearchObject = { since }
    // IMPORTANTE: No filtramos por "from" aquí (suele fallar por address exacto). Filtramos luego del parse.

    const uidsRes = await client.search(searchQuery)
    const uids = Array.isArray(uidsRes) ? uidsRes : []
    if (uids.length === 0) {
      out.details.push({ _summary: { ...debug, info: 'no uids for date range' } })
      return res.status(200).json(out)
    }

    // Tomar los más recientes primero
    const take = Math.min(Number(limit), uids.length)
    const slice = uids.slice(-take).reverse() // recent first

    for (const uid of slice) {
      try {
        debug.scanned++
        const msg: any = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true })
        if (!msg || !msg.source) continue

        const parsed = await simpleParser(msg.source as any)
        const subject = parsed.subject || ''
        if (/^\s*(fwd:|re:)/i.test(subject)) { debug.skippedFwdRe++; continue }

        const fromName = (parsed.from?.value?.[0]?.name as string | undefined) || (msg.envelope?.from?.[0]?.name as string | undefined) || ''
        const fromAddr = (parsed.from?.value?.[0]?.address as string | undefined) || (msg.envelope?.from?.[0]?.address as string | undefined) || ''

        // From filter (includes, normalized)
        let fromOk = true
        if (fromFilter) {
          const hay = normalize(`${fromName} <${fromAddr}>`)
          fromOk = hay.includes(normalize(fromFilter))
        }
        if (!fromOk) {
          debug.skippedNoFromMatch++
          if (debug.examples.length < 10) debug.examples.push({ subject, fromName, fromAddr })
          continue
        }
        debug.matchedFrom++

        // Subject filter (includes, normalized)
        const subjectOk = subjectPrefix ? normalize(subject).includes(normalize(subjectPrefix)) : true
        if (!subjectOk) {
          debug.skippedNoSubjectMatch++
          if (debug.examples.length < 10) debug.examples.push({ subject, fromName, fromAddr })
          continue
        }
        debug.matchedSubject++

        const body = (parsed.text || '').trim() || (parsed.html ? stripHtml(parsed.html) : '')
        const email_datetime = (msg.internalDate ? new Date(msg.internalDate) : new Date()).toISOString()

        // Build a stable hash (dedupe) using user, from, subject and datetime/message-id
        const messageId = (parsed.messageId as string | undefined) || ''
        const dedupeKey = `${user_id}|${fromAddr}|${subject}|${messageId || email_datetime}`
        const hash = createHash('sha256').update(dedupeKey).digest('hex')

        // Insert minimal row; parser de merchant/amount quedará en promote o parsers específicos
        const { error } = await admin
          .from('email_transactions')
          .upsert([{
            user_id,
            subject,
            email_datetime,
            source: 'imap',
            processed: false,
            merchant: null,
            amount: null,
            currency: null,
            card_last4: null,
            date_local: null,
            message_id: messageId || null,
            hash,
          }], { onConflict: 'hash', ignoreDuplicates: true })

        out.attempted++
        if (error) {
          // If duplicate (unique violation on hash), treat as no-op
          const msgErr = String(error.message || '')
          if (/duplicate key|unique constraint|conflict/i.test(msgErr)) {
            out.details.push({ uid, subject, info: 'duplicate (hash conflict)' })
          } else {
            out.errors++
            out.details.push({ uid, subject, error: error.message })
          }
        } else {
          out.inserted++
        }
      } catch (e: any) {
        out.attempted++
        out.errors++
        out.details.push({ error: e?.message || String(e) })
      }
    }

    out.details.push({ _summary: debug })
    return res.status(200).json(out)
  } catch (e: any) {
    console.error('[email/sync] Fatal error:', e)
    return res.status(500).json({ ok: false, attempted: out.attempted, inserted: out.inserted, errors: out.errors + 1, details: [{ error: e?.message || String(e) }] })
  } finally {
    try { await client.logout() } catch {}
  }
}