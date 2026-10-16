# DEPLOYMENT — Dashboard Executivo

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local e para `pnpm test:db`), conta Supabase (região **São Paulo**) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |

O app **não usa** `service_role`. Não a coloque em variável alguma.

## Banco
1. **Local**: `supabase start` e `supabase db reset` (migrações + `seed.sql` fictício). Portas 586xx (`project_id = pack25-dashboard-executivo`). Com pouca memória: `supabase start -x realtime,imgproxy,studio,edge-runtime,logflare,vector,postgres-meta,supavisor`.
2. **Produção**: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` (cria usuários de demonstração e dados fictícios).
3. **Autenticação** no painel do Supabase: confirmação de e-mail ligada, senha mínima de 12, **TOTP (MFA) habilitado** (administradores precisam da 2ª etapa, também no banco), **SMTP próprio** e a URL do app em Redirect URLs.
4. **Backup e restauração**: backups diários do Supabase (e *Point-in-Time Recovery* em plano pago). Os arquivos importados **não são guardados**: os dados vivem nas versões do dataset (retenção configurável); guarde os arquivos de origem onde sua política mandar.
5. **Reversão**: migrações só para frente; para voltar, restaure o backup anterior. Versões de métrica e de dashboard são imutáveis; corrigir é publicar nova versão.

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`. Importações de até 20 MB passam por Server Actions (`next.config.ts`: 24 MB de ação e 26 MB no proxy); em hospedagem com limite de corpo menor, reduza o arquivo ou o limite em Configurações do BI.

**E2E**: `pnpm test:e2e` usa o Supabase local e o app **compilado** (`pnpm build && pnpm start -p 3123`). Copie URLs/chaves de `supabase status` para `.env.e2e` (ignorado pelo git) com `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL` e `E2E_MAILPIT_URL`. Rode **um arquivo por vez**, reiniciando o app entre eles (limitador de login em memória) e **depois de `supabase db reset`** (`bi-flow` e `bi-security` alteram dados).

## Dados de demonstração
Senha local única `DemoLocal#2026`, todos `@demo.exemplo`, empresa «Horizonte Distribuidora (dados fictícios)»: `dono@` (administrador), `gestor@`, `analista@`, `analista2@`, `consulta@` (visualizador). `node scripts/seed-check.mjs` valida o seed num Postgres descartável.

## Checklist de produção
- [ ] Região Brasil; backups ligados; MFA ligado; SMTP próprio; Redirect URLs.
- [ ] `seed.sql` **não** aplicado; nenhuma chave `service_role` em variável de ambiente.
- [ ] Em Configurações do BI: fuso da empresa, limites, dias para «desatualizado» e retenção de versões.
- [ ] Marcar como **restritos** os datasets com dados pessoais ou sensíveis e conceder acesso só a quem precisa.
- [ ] Importar o primeiro dataset real, conferir a prévia (tipos e erros) e só então criar indicadores.
- [ ] Revisar o texto de privacidade com seu jurídico (controlador = quem implanta).
