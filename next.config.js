/** next.config.js **/
/** @type {import('next').NextConfig} **/
const nextConfig = {
  // Le decimos a Next que genere estáticos
  output: 'export',

  // Ruta base para todas las páginas
  basePath: '/mi-app-finanzas',
  // Prefijo para assets estáticos
  assetPrefix: '/mi-app-finanzas/',

  reactStrictMode: true,
  // … cualquier otra configuración que ya tuvieras
}

module.exports = nextConfig
