/ ** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
  // Exporta estático para GitHub Pages
  output: 'export',

  // GH Pages sirve archivos como /carpeta/index.html; con trailingSlash true
  // Next generará enlaces que terminen en "/" y evitará 404.
  trailingSlash: true,

  // Si usás <Image>, desactiva el optimizador (no hay server en GH Pages)
  images: { unoptimized: true },

  // En producción (Pages) servimos desde /mi-app-finanzas
  ...(isProd
    ? { basePath: '/mi-app-finanzas', assetPrefix: '/mi-app-finanzas/' }
    : {}),

  reactStrictMode: true,
}

module.exports = nextConfig