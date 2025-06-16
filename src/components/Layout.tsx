// src/components/Layout.tsx
import NavBar from './NavBar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-16 min-h-screen bg-gray-50">
      {/* Puedes añadir aquí un Header global si quieres */}
      <main className="px-4 py-6">{children}</main>
      <NavBar />
    </div>
  )
}
