// pages/api/email/sync.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
// Gmail ID extraction fallback: When available, the Gmail message id will be extracted from msg.gmailMessageId or msg['x-gm-msgid'].

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

const cleanMerchant = (val: string | null | undefined) => {
  const s = (val || '').trim();
  if (!s) return s as any;
  let out = s.replace(/\s+/g, ' ');
  const STOP_MARKERS = [
    'País:', 'Pais:', 'Ciudad:', 'Tarjeta:', 'Autorización:', 'Autorizacion:',
    'Referencia:', 'Tipo de transacción:', 'Tipo de transaccion:', 'Moneda:', 'Monto:',
    'Importante:', '(puede haber una diferencia', 'Alerta de Compras Visa',
    '¿Demasiado contenido', 'Demasiado contenido', 'Anular la suscripción',
    'Suscripción a las alertas', 'Suscripcion a las alertas',
    'Este correo electrónico se envió', 'Si cree que recibió', 'llame de inmediato',
    '------------------------------', '----------------', '--', '—', '–'
  ];
  for (const mk of STOP_MARKERS) {
    const idx = out.toLowerCase().indexOf(mk.toLowerCase());
    if (idx > 0) {
      out = out.slice(0, idx).trim();
      break;
    }
  }
  out = out.replace(/[|·•–—-]{2,}.*$/, '').trim();
  out = out.replace(/\(.*/, '').trim();
  const MAX_LEN = 80;
  if (out.length > MAX_LEN) {
    const cut = out.slice(0, MAX_LEN);
    const lastSpace = cut.lastIndexOf(' ');
    out = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return out;
};

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

  // --- Incremental state (process only new UIDs) ---
  const mailboxKey = IMAP_MAILBOX;
  let lastUid = 0;
  try {
    const { data: st } = await admin
      .from('email_sync_state')
      .select('last_uid')
      .eq('user_id', user_id)
      .eq('mailbox', mailboxKey)
      .limit(1)
      .maybeSingle();
    lastUid = Number(st?.last_uid || 0);
    out.details.push({ _state: { mailbox: mailboxKey, last_uid: lastUid } });
  } catch (e:any) {
    out.details.push({ _state_error: e?.message || String(e) });
  }

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

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const searchQuery: SearchObject = { since };
    // IMPORTANTE: No filtramos por "from" aquí. Filtramos luego del parse.
    const uidsRes = await client.search(searchQuery);
    const allUids = Array.isArray(uidsRes) ? uidsRes.map(Number) : [];
    // Filtrar por incremental UID > lastUid
    const newUids = allUids.filter(u => u > lastUid);
    if (newUids.length === 0) {
      out.details.push({ _summary: { ...debug, info: 'no new uids above last_uid', last_uid: lastUid } });
      return res.status(200).json(out);
    }

    // Recorrer de más reciente a más antiguo (UID mayor = más nuevo)
    const take = Math.min(Number(limit), newUids.length);
    const rev = [...newUids].sort((a,b) => b - a); // highest UID first
    let maxSeenUid = lastUid;

    for (const uid of rev) {
      if (uid > maxSeenUid) maxSeenUid = uid;
      if (out.attempted >= take) break
      try {
        debug.scanned++
        const msg: any = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        if (!msg || !msg.source) continue

        const parsed = await simpleParser(msg.source as any)
        // Gmail message id (if available in this provider)
        const gmailMsgIdRaw = (msg as any)?.gmailMessageId ?? (msg as any)?.['x-gm-msgid'] ?? null;
        const gmail_msgid = gmailMsgIdRaw != null ? String(gmailMsgIdRaw) : null;
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

        // --- Parse VISA body to extract merchant/amount/currency/last4 ---
        const textPart = (parsed.text || '').toString();
        const htmlPart = (parsed.html ? stripHtml(String(parsed.html)) : '');
        const bodyText = `${textPart} ${htmlPart}`.replace(/\s+/g, ' ').trim();

        // Helper to parse amounts like 1.971.000,00 or 1649.00
        const parseAmount = (raw: string | null | undefined): number | null => {
          if (!raw) return null;
          let s = String(raw).trim();
          // Trim after first parenthesis or any non-amount annotation (e.g., "8400.00(puede...")
          s = s.replace(/\(.*/, '');
          // Keep only digits, dot, comma, minus
          s = s.replace(/[^\d.,-]/g, '');
          // Guard: strip leading/trailing dots/commas
          s = s.replace(/^[.,]+/, '').replace(/[.,]+$/, '');
          // If both separators are present, assume dot thousands + comma decimal
          if (/,/.test(s) && /\./.test(s)) {
            s = s.replace(/\./g, '').replace(/,/g, '.');
          } else if (/,/.test(s) && !/\./.test(s)) {
            // Only comma present, treat as decimal separator
            s = s.replace(/,/g, '.');
          }
          const n = Number(s);
          if (!Number.isFinite(n)) return null;
          return n;
        };

        // Extract merchant, currency, amount and card last4
        let parsedMerchant: string | null = null;
        let parsedCurrency: string | null = null;
        let parsedAmount: number | null = null;
        let parsedLast4: string | null = null;

        // Comercio (capture only the merchant name before the next metadata key)
        // Try a strict pattern first
        let mMerch = bodyText.match(
          /(?:Comercio|Comerciante|Comercio\/Merchant)\s*:\s*([^\n\r]+?)(?=\s+(?:Pa[ií]s|Ciudad|Tarjeta|Autorizaci[oó]n|Referencia|Tipo de transacci[oó]n|Moneda|Monto)\s*:|$)/i
        );

        if (mMerch && mMerch[1]) {
          parsedMerchant = cleanMerchant(mMerch[1]);
        } else {
          // Fallback #1: a lo largo de la línea hasta que aparezca un marcador conocido
          const m2 = bodyText.match(
            /Comercio\s*:\s*([A-Za-z0-9 .,'*º°\-&_/]+?)(?=\s+(?:Pa[ií]s|Ciudad|Tarjeta|Autorizaci[oó]n|Referencia|Tipo de transacci[oó]n|Moneda|Monto)\s*:|$)/i
          );
          if (m2 && m2[1]) {
            parsedMerchant = cleanMerchant(m2[1]);
          } else {
            // Fallback #2: tomar un tramo corto después de "Comercio:" y luego limpiar
            const m3 = bodyText.match(/Comercio\s*:\s*([^\n\r]{2,120})/i);
            if (m3 && m3[1]) {
              parsedMerchant = cleanMerchant(m3[1]);
            }
          }
        }

        // Final tiny safeguard: if still empty or suspiciously generic, null out
        if (parsedMerchant) {
          // avoid clearly non-merchant content leaking in
          const low = parsedMerchant.toLowerCase();
          if (/alerta de compras visa|anular la suscrip|este correo electr|llame de inmediato/.test(low)) {
            parsedMerchant = null;
          }
        }

        // Moneda
        const mCurr = bodyText.match(/Moneda:\s*([A-Z]{3})/i);
        if (mCurr) {
          parsedCurrency = mCurr[1].toUpperCase();
        }

        // Monto
        // Matches "Monto: 1649.00", "Monto: $ 1.971.000,00", etc.
        const mAmt = bodyText.match(/Monto:\s*\$?\s*([0-9][\d.,]*)(?=\s*(?:\(|$))/i);
        if (mAmt) {
          parsedAmount = parseAmount(mAmt[1]);
        }

        // Últimos 4 de tarjeta (aparece como "Tarjeta: 1368" o "terminación 1368")
        const mLastTarj = bodyText.match(/Tarjeta:\s*(\d{4})/i) || bodyText.match(/terminaci[oó]n\s*(\d{4})/i);
        if (mLastTarj) parsedLast4 = mLastTarj[1];

        // Build a content-based hash to dedupe the same alert even if IMAP UID changes
        const buildContentHash = (
          userId: string,
          dateLocal: string,
          merchant: string | null,
          amount: number | null,
          currency: string | null,
          subject?: string | null
        ) => {
          // Do NOT include card last4 in the hash (can be missing/inconsistent across copies)
          const baseMerchant = (merchant || '').toUpperCase().trim();
          const baseAmount = amount != null ? String(amount) : '';
          const baseCurrency = (currency || '').toUpperCase().trim();
          // Include a normalized subject fallback to stabilize when merchant/amount parsing fails
          const normSubject = (subject || '')
            .normalize('NFKD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);
          const key = [
            userId || '',
            dateLocal || '',
            baseMerchant || '(unknown-merchant)',
            baseAmount || '(unknown-amount)',
            baseCurrency || '(unknown-currency)',
            normSubject || '(no-subject)'
          ].join('|');
          return createHash('sha256').update(key).digest('hex');
        }

        // Always use a stable content hash (never UID-based), using subject as fallback
        let hash_mode: 'content' = 'content';
        const effectiveCurrency = (parsedCurrency || defaultCurrency || 'ARS');
        const hash = buildContentHash(
          user_id,
          date_local,
          parsedMerchant,
          parsedAmount,
          effectiveCurrency,
          subject
        );

        // Guard against duplicates even if hash changes in the future: check by (user_id, date_local, merchant, amount, currency)
        if (parsedMerchant && parsedAmount != null) {
          const { data: existsRows, error: existsErr } = await admin
            .from('email_transactions')
            .select('id')
            .eq('user_id', user_id)
            .eq('date_local', date_local)
            .eq('merchant', parsedMerchant)
            .eq('amount', parsedAmount)
            .eq('currency', effectiveCurrency.toUpperCase())
            .limit(1);

          if (!existsErr && Array.isArray(existsRows) && existsRows.length > 0) {
            // Already captured — record as duplicate and skip insert
            out.attempted++;
            if (debugFlag) {
              out.details.push({
                _result: {
                  uid,
                  status: 'duplicate-exists',
                  by: 'content-check',
                  existing_id: existsRows[0].id,
                  merchant: parsedMerchant,
                  amount: parsedAmount,
                  currency: effectiveCurrency,
                  date_local
                }
              });
            }
            continue;
          }
        }

        // Upsert deduping by (user_id, hash) — index: email_tx_user_hash_key
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

            from_name: fromName || null,
            from_address: fromAddr || null,

            merchant: parsedMerchant,
            amount: parsedAmount,
            currency: effectiveCurrency.toUpperCase(),
            card_last4: parsedLast4,
            processed: false,

            gmail_msgid: gmail_msgid,
            hash,
          }], { onConflict: 'user_id,hash', ignoreDuplicates: false })
          .select()

        out.attempted++

        if (debugFlag) {
          out.details.push({
            _attempt: {
              uid,
              subject,
              conflictTarget: 'user_id,hash',
              hash_mode: 'content',
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

    // Persist incremental pointer if we advanced
    try {
      if (typeof maxSeenUid !== 'undefined' && maxSeenUid > lastUid) {
        await admin
          .from('email_sync_state')
          .upsert([{ user_id, mailbox: mailboxKey, last_uid: maxSeenUid }], { onConflict: 'user_id,mailbox', ignoreDuplicates: false });
        out.details.push({ _state_updated: { mailbox: mailboxKey, from: lastUid, to: maxSeenUid } });
      }
    } catch (e:any) {
      out.details.push({ _state_update_error: e?.message || String(e) });
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