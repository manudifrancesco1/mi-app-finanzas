// src/components/LogoutButton.tsx
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabaseClient'

export default function LogoutButton() {
  const router = useRouter()
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }
  return (
    <button
      onClick={handleLogout}
      className="fixed top-4 right-4 bg-red-600 text-white px-3 py-1 rounded"
    >
      Cerrar sesión
    </button>
  )
}
 