// src/lib/visaParser.ts
export type ParsedTx = {
  amount: number;
  currency: string;               // ARS / USD
  merchant: string;               // p.ej. RAPPI
  payment_type: 'credit' | 'debit';
  last4?: string;                 // últimos 4 dígitos (opcional)
  raw: string;
};

/**
 * Mapeá tus últimas 4 cifras -> tipo de tarjeta.
 * Ejemplo: 1368 = crédito, 9745 = débito
 * ⚠️ Cambialo por tus números reales.
 */
const LAST4_MAP: Record<string, 'credit' | 'debit'> = {
  // '1368': 'credit',
  // '9745': 'debit',
};

function numFrom(str: string): number | null {
  // admite 1.234,56 | 1234,56 | 1,234.56
  const cleaned = str.replace(/\s/g, '').replace(/[A-Z$]/gi, '').replace(/\./g, '').replace(/,/g, '.');
  const val = Number(cleaned);
  return Number.isFinite(val) ? Number(val.toFixed(2)) : null;
}

export function parseVisaEmail(plain: string): ParsedTx | null {
  const text = plain.replace(/\r/g, '');

  // Comercio
  const merchant = text.match(/Comercio:\s*([^\n\r]+)/i)?.[1]?.trim();
  if (!merchant) return null;

  // Monto (puede venir con aclaración a la derecha)
  const amountRaw = text.match(/Monto:\s*([0-9\.\,]+)/i)?.[1];
  const amount = amountRaw ? numFrom(amountRaw) : null;
  if (!amount || amount <= 0) return null;

  // Moneda
  const currency = text.match(/Moneda:\s*([A-Z]+)/i)?.[1]?.toUpperCase() || 'ARS';

  // Últimos 4
  const last4 = text.match(/Tarjeta:\s*(\d{4})/i)?.[1];

  // Tipo (debit/credit): según LAST4_MAP, si no está mapeado asumimos 'credit'
  const payment_type = (last4 && LAST4_MAP[last4]) ? LAST4_MAP[last4] : 'credit';

  return {
    amount,
    currency,
    merchant: merchant.toUpperCase(),
    payment_type,
    last4,
    raw: text,
  };
}