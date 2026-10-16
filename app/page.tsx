import { redirect } from 'next/navigation';

export default function Home() {
  // O proxy envia visitantes sem sessão para /login; a página de destino revalida o acesso.
  redirect('/dashboard');
}
