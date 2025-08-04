// src/pages/_app.tsx
import '../styles/globals.css'
import type { AppProps } from 'next/app'
import Script from 'next/script'
import Layout from '../components/Layout'

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </>
  )
}
