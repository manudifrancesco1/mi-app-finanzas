// src/pages/categories.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Category = {
  id: number
  name: string
  is_fixed: boolean
}

const Categories: NextPage = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState<{ name: string; is_fixed: boolean }>({
    name: '',
    is_fixed: false
  })
  const [error, setError] = useState<string | null>(null)

  // 1) Cargar categorías
  useEffect(() => {
    ;(async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_fixed')
        .eq('user_id', user.id)
        .eq('type', 'expense')
        .order('name', { ascending: true })

      if (error) {
        setError(error.message)
      } else {
        setCategories(data || [])
      }
    })()
  }, [])

  // 2) Cambio en inputs
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const target = e.target as HTMLInputElement
    const { name, value, type, checked } = target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  // 3) Guardar categoría
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      setError('Debes iniciar sesión')
      return
    }

    const payload = {
      name: form.name,
      is_fixed: form.is_fixed,
      type: 'expense',
      user_id: user.id
    }

    const { error: insErr } = await supabase.from('categories').insert(payload)
    if (insErr) {
      setError(insErr.message)
    } else {
      // recargar
      const { data } = await supabase
        .from('categories')
        .select('id, name, is_fixed')
        .eq('user_id', user.id)
        .eq('type', 'expense')
        .order('name', { ascending: true })
      setCategories(data || [])
      setForm({ name: '', is_fixed: false })
    }
  }

  // 4) Eliminar categoría
  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar categoría?')) return
    const { error: delErr } = await supabase.from('categories').delete().eq('id', id)
    if (delErr) {
      setError(delErr.message)
    } else {
      setCategories(categories.filter((c) => c.id !== id))
    }
  }

  return (
    <main className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Categorías</h1>
      {error && <p className="text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1">Nombre</label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            className="w-full border rounded p-2"
            required
          />
        </div>

        <div className="flex items-center space-x-2">
          <input
            id="is_fixed"
            name="is_fixed"
            type="checkbox"
            checked={form.is_fixed}
            onChange={handleChange}
            className="h-4 w-4"
          />
          <label htmlFor="is_fixed">Gasto fijo</label>
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Guardar
        </button>
      </form>

      <section>
        <h2 className="text-xl font-semibold mb-2">Lista de categorías</h2>
        <ul className="space-y-2">
          {categories.map((cat) => (
            <li
              key={cat.id}
              className="flex justify-between items-center bg-white p-3 rounded shadow-sm"
            >
              <span>
                {cat.name} {cat.is_fixed && <em>(Fijo)</em>}
              </span>
              <button
                onClick={() => handleDelete(cat.id)}
                className="text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default Categories
