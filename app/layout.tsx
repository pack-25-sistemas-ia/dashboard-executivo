import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';

// Fontes hospedadas no próprio build (sem requisições a terceiros em tempo de execução).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Pack 25 Sistemas IA', template: '%s · Pack 25 Sistemas IA' },
  description: 'Sistema empresarial do Pack 25 Sistemas IA.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A CSP usa nonce por requisição (proxy.ts): toda página precisa ser renderizada dinamicamente.
  await connection();
  return (
    <html lang="pt-BR" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
