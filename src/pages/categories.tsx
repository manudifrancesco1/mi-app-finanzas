// src/pages/categories.tsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useRouter } from 'next/router'

type Category = {
  id: number
  name: string
  type: 'income' | 'expense'
  is_fixed: boolean
}

export default function CategoriesPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState({
    id: null as number | null,
    name: '',
    type: 'expense' as 'income' | 'expense',
    is_fixed: false
  })
  const [error, setError] = useState<string | null>(null)

  // 1) Cargar categorías
  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('id,name,type,is_fixed')
      .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
      .order('name')
    if (error) setError(error.message)
    else setCategories(data || [])
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  // 2) Cambio en inputs
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({
      ...f,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  // 3) Crear o actualizar
  const handleSubmit = async () => {
    setError(null)
    const userId = (await supabase.auth.getUser()).data.user!.id
    const payload = {
      user_id: userId,
      name: form.name,
      type: form.type,
      is_fixed: form.is_fixed
    }
    let err
    if (form.id) {
      ;({ error: err } = await supabase
        .from('categories')
        .update(payload)
        .eq('id', form.id))
    } else {
      ;({ error: err } = await supabase
        .from('categories')
        .insert(payload))
    }
    if (err) setError(err.message)
    else {
      setForm({ id: null, name: '', type: 'expense', is_fixed: false })
      fetchCategories()
    }
  }

  // 4) Editar fila
  const startEdit = (cat: Category) => {
    setForm({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      is_fixed: cat.is_fixed
    })
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <button onClick={() => router.push('/')} className="mb-4 text-blue-600 hover:underline">
        ← Dashboard
      </button>

      <h1 className="text-2xl font-semibold mb-4">Categorías</h1>
      {error && <p className="text-red-500 mb-2">{error}</p>}

      {/* Formulario */}
      <div className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          name="name"
          type="text"
          placeholder="Nombre"
          value={form.name}
          onChange={handleChange}
          className="border p-2 rounded md:col-span-2"
        />
        <select
          name="type"
          value={form.type}
          onChange={handleChange}
          className="border p-2 rounded"
        >
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
        </select>
        <label className="flex items-center gap-2">
          <input
            name="is_fixed"
            type="checkbox"
            checked={form.is_fixed}
            onChange={handleChange}
            className="h-5 w-5"
          />
          <span>Fijo</span>
        </label>
        <button
          onClick={handleSubmit}
          className="bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition md:col-span-1"
        >
          {form.id ? 'Actualizar' : 'Agregar'}
        </button>
      </div>

      {/* Listado */}
      <ul className="space-y-2">
        {categories.map((cat) => (
          <li
            key={cat.id}
            className="bg-white p-4 rounded shadow flex justify-between items-center"
          >
            <div>
              <div className="font-medium">{cat.name}</div>
              <div className="text-sm text-gray-600">
                {cat.type} {cat.is_fixed && '· Fijo'}
              </div>
            </div>
            <button
              onClick={() => startEdit(cat)}
              className="text-blue-500 hover:underline text-sm"
            >
              Editar
            </button>
          </li>
        ))}
        {categories.length === 0 && <p className="text-gray-500">Sin categorías aún.</p>}
      </ul>
    </div>
  )
}
