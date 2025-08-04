# Mi-App-Finanzas

> A Next.js dashboard for managing personal finances, built with Supabase Auth and PostgreSQL.

## 🚀 Tecnologías

- **Next.js** — SSR/SSG React framework  
- **Supabase** — Backend (Auth + Postgres)  
- **Tailwind CSS** — Utility-first styling  
- **TypeScript** — Tipado estático  
- **Heroicons** — Iconografía  

## 🎯 Funcionalidades

- **Autenticación** por correo y contraseña (Supabase Auth)  
- Dashboard mensual con:
  - Gastos fijos vs variables  
  - Ingresos por categoría  
  - Saldo neto  
  - Detalle de subcategorías  
- CRUD de ingresos, gastos y transacciones  
- Responsive design  

## 🛠️ Prerrequisitos

- Node.js ≥16  
- npm, yarn o pnpm  
- Cuenta y proyecto en Supabase  

## ⚙️ Variables de entorno

En la raíz del proyecto crea un archivo `.env.local` con:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
