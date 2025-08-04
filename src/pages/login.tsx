// pages/login.tsx
import React, { useState, useEffect } from 'react'
import type { NextPage } from 'next'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

const Login: NextPage = () => {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Si ya hay sesión, vamos al dashboard
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (session) {
        router.replace('/')
      }
    }
    checkSession()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    let res
    if (mode === 'login') {
      // Iniciar sesión
      res = await supabase.auth.signInWithPassword({ email, password })
    } else {
      // Crear cuenta
      res = await supabase.auth.signUp({ email, password })
    }

    if (res.error) {
      setError(res.error.message)
    } else {
      router.push('/')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow">
        <h2 className="text-2xl font-bold mb-6 text-center">
          {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </h2>

        {error && (
          <div className="mb-4 text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading
              ? 'Cargando...'
              : mode === 'login'
              ? 'Ingresar'
              : 'Registrarse'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === 'login' ? (
            <>
              ¿No tenés cuenta?{' '}
              <button
                onClick={() => setMode('signup')}
                className="text-blue-600 hover:underline"
              >
                Crear cuenta
              </button>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta?{' '}
              <button
                onClick={() => setMode('login')}
                className="text-blue-600 hover:underline"
              >
                Iniciar sesión
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Login
