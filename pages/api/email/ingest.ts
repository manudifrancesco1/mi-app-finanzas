import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Utilidades de parsing muy simples para mails de VISA Galicia
function normalizeAmount(raw: string): number | null {
  if (!raw) return null
  let s = raw.trim()
  // Quitar símbolo de peso u otros
  s = s.replace(/[$]/g, '').replace(/\s/g, '')
  // Formatos posibles: "1.234,56" (AR/ES), "1234,56", "1234.56", "81.91"
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // Asumimos miles con punto y decimales con coma => quitar puntos y convertir coma a punto
    s = s.replace(/\./g, '').replace(/,/g, '.')
  } else if (hasComma && !hasDot) {
    // Solo coma => tratar como separador decimal
    s = s.replace(/,/g, '.')
  }
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function extractLast4(text: string): string | null {
  if (!text) return null
  // "terminación 1234" o "****1234" o "*** 1234"
  const m = text.match(/terminaci[oó]n\s*(\d{4})/i) || text.match(/\*{2,}\s*(\d{4})/)
  return m ? (m[1] ?? '').trim() : null
}

function extractMerchant(subject: string, body: string): string | null {
  const blob = `${subject}\n${body}`
  // Prioridad 1: línea "Comercio: XXXX"
  const m1 = blob.match(/Comercio:\s*([^\n]+)/i)
  if (m1) return m1[1].trim()
  // Prioridad 2: "en TIENDA XYZ" en el subject o cuerpo
  const m2 = blob.match(/\ben\s+([^\n\-–—]+?)(?:\s+por|\s+-\s+|[\.;,]|$)/i)
  if (m2) return m2[1].trim()
  return null
}

function extractCurrency(subject: string, body: string): string | null {
  const blob = `${subject}\n${body}`
  // "Moneda: ARS"
  const m1 = blob.match(/Moneda:\s*([A-Z]{3})/i)
  if (m1) return m1[1].toUpperCase()
  // Si aparece un símbolo $
  if (/[\$]/.test(blob)) return 'ARS'
  return null
}

function extractAmount(subject: string, body: string): number | null {
  const blob = `${subject}\n${body}`
  // "Monto: 81.91" o "Monto: 1.234,56"
  const m1 = blob.match(/Monto:\s*([\$]?[\d\.,]+)/i)
  if (m1) return normalizeAmount(m1[1])
  // Buscar monto con símbolo $ en el subject
  const m2 = blob.match(/\$\s*([\d\.,]+)/)
  if (m2) return normalizeAmount(m2[1])
  return null
}

// --- Supabase admin client (server-side) ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseAdmin = (SUPABASE_URL && SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SERVICE_ROLE)
  : null

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Solo permitimos POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  // Autenticación simple por encabezado
  const secret = req.headers['x-email-secret']
  if (secret !== process.env.EMAIL_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  // Tomamos algunos campos típicos de un email
  const { user_id, subject = '', body = '', date } = (req.body ?? {}) as {
    user_id?: string
    subject?: string
    body?: string
    date?: string
  }

  // Parseo básico
  const parsed = {
    amount: extractAmount(subject, body),
    currency: extractCurrency(subject, body) ?? 'ARS',
    merchant: extractMerchant(subject, body),
    card_last4: extractLast4(subject + '\n' + body),
    occurred_at: date ?? new Date().toISOString(),
  }

  // --- Optional: insertar transacción automática en Supabase ---
  let insertResult: any = null
  let insertError: string | null = null

  // Deducción simple del tipo de pago: crédito (default) vs débito si el mail lo indica
  const paymentType = /d[eé]bito/i.test(subject + ' ' + body) ? 'debit' : 'credit'

  // La columna `date` en tu tabla es tipo DATE; guardamos sólo AAAA-MM-DD
  const txDate = new Date(parsed.occurred_at).toISOString().slice(0, 10)

  // ---- Idempotencia: hash de deduplicación (mismo user, monto, fecha, comercio y last4) ----
  const canonicalMerchant = (parsed.merchant || '').trim().toLowerCase();
  const last4 = parsed.card_last4 || '';
  const amountStr = parsed.amount !== null && parsed.amount !== undefined ? parsed.amount.toFixed(2) : '';
  const dedupeKey = [user_id || '', amountStr, txDate, canonicalMerchant, last4].join('|');
  const hash = crypto.createHash('sha256').update(dedupeKey).digest('hex').slice(0, 32);

  // Descripción amigable para la transacción (fallback al subject)
  const description = (() => {
    const last4 = parsed.card_last4 ? ` (VISA ****${parsed.card_last4})` : ''
    if (parsed.merchant) return `Compra ${parsed.merchant}${last4}`
    if (subject) return subject
    return `Compra con tarjeta${last4}`
  })()

  if (supabaseAdmin && user_id && parsed.amount) {
    const tags: string[] = []
    if (parsed.card_last4) tags.push(`visa-${parsed.card_last4}`)

    const row = {
      user_id,                    // uuid del usuario dueño del gasto
      amount: parsed.amount,      // numeric
      currency: parsed.currency,  // text (ej: ARS)
      date: txDate,               // date (AAAA-MM-DD)
      description,                // text
      payment_type: paymentType,  // text: 'credit' | 'debit'
      expense_mode: 'single',     // text: un solo pago

      // Nuevo: guardar el comercio y la fuente del dato
      merchant: parsed.merchant ?? null,
      source: 'email',
      raw_description: subject || null,

      // Campos opcionales que tu esquema permite; dejamos en null si no aplica
      category_id: null,
      subcategory_id: null,
      payment_method_id: null,
      installments_total: null,
      installments_paid: null,
      installments: null,
      recurrence: null,
      tags,
      hash,
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('transactions')
        .upsert(row, { onConflict: 'hash' })
        .select()
        .single()

      if (error) {
        insertError = error.message
      } else {
        insertResult = data
      }
    } catch (e: any) {
      insertError = e?.message || 'unknown insert error'
    }
  }

  // Log útil para depurar en consola del server
  console.log('[EMAIL_INGEST] Parsed =>', parsed)

  return res.status(200).json({
    ok: true,
    received: {
      hasUserId: Boolean(user_id),
      subject: subject || null,
      bodyLength: body ? body.length : 0,
      date: date ?? null,
    },
    parsed,
    db: {
      attempted: Boolean(supabaseAdmin && user_id && parsed.amount),
      error: insertError,
      inserted: insertResult,
    },
  })
}