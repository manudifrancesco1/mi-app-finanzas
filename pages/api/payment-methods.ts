// src/pages/api/payment-methods.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabaseClient'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1) Obtener usuario autenticado
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  switch (req.method) {
    // 2) Listar métodos de pago
    case 'GET': {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('user_id', user.id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json(data)
    }

    // 3) Crear un nuevo método de pago
    case 'POST': {
      const { type, label, details } = req.body
      const { data, error } = await supabase
        .from('payment_methods')
        .insert({ user_id: user.id, type, label, details })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json(data)
    }

    // 4) Métodos no permitidos
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      return res.status(405).json({ error: 'Method not allowed' })
  }
}
