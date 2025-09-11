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

function formatYMDLocal(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  // en-CA yields YYYY-MM-DD
  return fmt.format(d)
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

  // Output accumulator (debe existir antes de usarlo en los bloques de debug)
  const out: Out = { ok: true, attempted: 0, inserted: 0, errors: 0, details: [] }

  // Debug: identify project and current row count before inserting
  const preProject = (() => {
    try {
      const u = new URL(supabaseUrl)
      return u.hostname
    } catch { return supabaseUrl }
  })()
  try {
    const { count: preCount, error: preErr } = await admin
      .from('email_transactions')
      .select('id', { count: 'exact', head: true })
    out.details.push({ _preflight: { supabase_host: preProject, pre_count: preCount ?? null, pre_error: preErr?.message || null } })
  } catch (e:any) {
    out.details.push({ _preflight: { supabase_host: preProject, pre_count: 'err', pre_error: e?.message || String(e) } })
  }

  const { user_id: bodyUserId, limit = 50, days = 14, from, debug: debugFlag } = (req.body ?? {}) as {
    user_id?: string
    limit?: number
    days?: number
    from?: string
    debug?: boolean
  }
  // Echo what came in the body for debugging purposes
  out.details.push({
    _body_echo: {
      keys: Object.keys((req.body ?? {})),
      debugFlagType: typeof (req.body ?? {}).debug,
      debugFlagValue: (req.body ?? {}).debug ?? null,
      parsedDebugFlag: Boolean(debugFlag)
    }
  })
  const user_id = bodyUserId || process.env.DEFAULT_USER_ID
  if (!user_id) return res.status(400).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: 'missing user_id' }] })

  // IMAP envs
  const missingImap = missingEnv(['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASSWORD'])
  if (missingImap.length) {
    return res.status(500).json({ ok: false, attempted: 0, inserted: 0, errors: 0, details: [{ error: `missing imap env: ${missingImap.join(', ')}` }] })
  }
  const IMAP_HOST = String(process.env.IMAP_HOST)
  const IMAP_PORT = Number(process.env.IMAP_PORT)
  const IMAP_SECURE = String(process.env.IMAP_SECURE ?? process.env.IMAP_TLS ?? 'true').toLowerCase() !== 'false'
  const IMAP_USER = String(process.env.IMAP_USER)
  const IMAP_PASSWORD = String(process.env.IMAP_PASSWORD)
  const IMAP_MAILBOX = String(process.env.IMAP_MAILBOX || 'INBOX')

  // Filters (permissive)
  const subjectPrefix = (process.env.EMAIL_SYNC_SUBJECT_PREFIX || 'Alerta de Compras Visa').trim()
  const fromFilterEnv = (process.env.EMAIL_SYNC_FROM || 'visa.com').trim()
  const fromFilter = (from && String(from).trim()) || fromFilterEnv
  const defaultCurrency = (process.env.EMAIL_SYNC_DEFAULT_CURRENCY || 'ARS').trim()

  if (debugFlag) {
    out.details.push({
      _debug: {
        enabled: true,
        limit,
        days,
        fromFilter,
        subjectPrefix,
        mailbox: IMAP_MAILBOX
      }
    })
  }

  const debug = {
    scanned: 0,
    matchedFrom: 0,
    matchedSubject: 0,
    skippedNoFromMatch: 0,
    skippedNoSubjectMatch: 0,
    skippedFwdRe: 0,
    examples: [] as { subject: string; fromName?: string; fromAddr?: string }[],
    filters: { fromFilter: fromFilter || null, subjectPrefix: subjectPrefix || null, mailbox: IMAP_MAILBOX }
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }
  })

  try {
    await client.connect()
    await client.mailboxOpen(IMAP_MAILBOX)

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000)
    const searchQuery: SearchObject = { since }
    // IMPORTANTE: No filtramos por "from" aquí (suele fallar por address exacto). Filtramos luego del parse.

    const uidsRes = await client.search(searchQuery)
    const uids = Array.isArray(uidsRes) ? uidsRes : []
    if (uids.length === 0) {
      out.details.push({ _summary: { ...debug, info: 'no uids for date range' } })
      return res.status(200).json(out)
    }

    // Recorrer de más reciente a más antiguo, intentando upsert hasta alcanzar "limit" verdaderos (post-filtro)
    const take = Math.min(Number(limit), uids.length)
    const rev = [...uids].reverse() // recent first

    for (const uid of rev) {
      if (out.attempted >= take) break
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

        // Fechas
        const internal = msg.internalDate ? new Date(msg.internalDate) : new Date()
        const email_datetime = internal.toISOString()
        const date_local = formatYMDLocal(internal, 'America/Argentina/Buenos_Aires')

        // Identificadores IMAP
        const messageId = (parsed.messageId as string | undefined) || (msg.envelope?.messageId as string | undefined) || null
        const provider = 'imap'
        const imap_mailbox = IMAP_MAILBOX
        const imap_uid = Number(uid)

        // Usamos siempre la clave única por UID de IMAP (índice: email_tx_unique_uid)
        const conflictTarget: string = 'user_id,provider,imap_mailbox,imap_uid'

        // hash requerido por el esquema actual (aunque deduplicamos por UID)
        const hash = createHash('sha256')
          .update(`${user_id}|${provider}|${imap_mailbox}|${imap_uid}|${messageId || ''}|${date_local}|${subject}`)
          .digest('hex')

        // Upsert por UID de IMAP para evitar duplicados reales
        const { data: upData, error: upErr }: { data: any[] | null; error: any } = await admin
          .from('email_transactions')
          .upsert([{
            user_id,
            provider,
            imap_mailbox,
            imap_uid,
            message_id: messageId,

            subject,
            email_datetime,
            date_local,

            source: 'imap',
            processed: false,

            from_name: fromName || null,
            from_address: fromAddr || null,

            merchant: null,
            amount: null,
            currency: defaultCurrency || 'ARS',
            card_last4: null,
            hash,
          }], { onConflict: conflictTarget, ignoreDuplicates: false })
          .select()

        out.attempted++

        if (debugFlag) {
          out.details.push({
            _attempt: {
              uid,
              subject,
              conflictTarget,
              hasMessageId: Boolean(messageId),
              imap_uid,
              row_user: user_id,
              hash_prefix: hash.slice(0, 12),
              email_datetime,
              date_local,
              from: { name: fromName, addr: fromAddr }
            }
          })
        }

        if (upErr) {
          const msgErr = String(upErr.message || '')
          if (/no unique|no.*exclusion constraint matching the ON CONFLICT/i.test(msgErr)) {
            out.errors++
            if (debugFlag) out.details.push({ _result: { uid, status: 'schema-conflict', message: msgErr, conflictTarget } })
            else out.details.push({ uid, subject, error: msgErr })
          } else if (/duplicate key|unique constraint|conflict/i.test(msgErr)) {
            if (debugFlag) out.details.push({ _result: { uid, status: 'duplicate', message: msgErr } })
          } else {
            out.errors++
            if (debugFlag) out.details.push({ _result: { uid, status: 'error', message: msgErr } })
            else out.details.push({ uid, subject, error: msgErr })
          }
        } else {
          const insertedCount = Array.isArray(upData) ? upData.length : 0
          out.inserted += insertedCount
          if (debugFlag) {
            out.details.push({ _result: { uid, status: insertedCount > 0 ? 'inserted' : 'updated-or-noop', inserted: insertedCount } })
          }
        }
      } catch (e: any) {
        out.attempted++
        out.errors++
        out.details.push({ error: e?.message || String(e) })
      }
    }

    // Postflight count
    try {
      const { count: postCount, error: postErr } = await admin
        .from('email_transactions')
        .select('id', { count: 'exact', head: true })
      out.details.push({ _postflight: { count: postCount ?? null, error: postErr?.message || null } })
    } catch (e:any) {
      out.details.push({ _postflight: { count: 'err', error: e?.message || String(e) } })
    }

    out.details.push({ _summary: debug })
    return res.status(200).json(out)
  } catch (e: any) {
    console.error('[email/sync] Fatal error:', e)
    return res.status(500).json({ ok: false, attempted: out.attempted, inserted: out.inserted, errors: out.errors + 1, details: [{ error: e?.message || String(e) }] })
  } finally {
    try { await client.logout() } catch {}
    try { await client.close() } catch {}
  }
}