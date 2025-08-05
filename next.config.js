/** next.config.js **/
/** @type {import('next').NextConfig} **/
const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
  // Solo en producción generamos export estático:
  ...(isProd && { output: 'export' }),

  basePath: '/mi-app-finanzas',
  assetPrefix: '/mi-app-finanzas/',
  reactStrictMode: true
}

module.exports = nextConfig
