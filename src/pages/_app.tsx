// src/pages/_app.tsx
import Layout from '../components/Layout'
import Script from 'next/script'
import type { AppProps } from 'next/app'

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
