---
description: Instala e roda o Dashboard Executivo neste computador, passo a passo
---

Você vai instalar o **Dashboard Executivo** (https://github.com/pack-25-sistemas-ia/dashboard-executivo) para a pessoa que abriu esta pasta. Ela pode ser iniciante: explique em português simples o que está fazendo, uma etapa por vez, e **pare para perguntar** sempre que precisar de algo dela (conta, chave, decisão). Leia `AGENTS.md` e `MEMORY.md` antes de começar.

## Regras
- Nunca invente nem publique chaves. `.env.local` é só da pessoa e **nunca** vai para o Git.
- Não rode nada destrutivo (apagar pastas, `git reset --hard`, `supabase db reset` em banco que não seja o local) sem pedir.
- Se um passo falhar, leia o erro, corrija a causa e tente de novo; se não souber, mostre o erro à pessoa em linguagem simples.

## Etapas
1. **Pasta.** Se o repositório ainda não foi clonado, clone `https://github.com/pack-25-sistemas-ia/dashboard-executivo` numa pasta nova e entre nela.
2. **Pré-requisitos.** Confira `node -v` (22 ou mais), `pnpm -v` (12), `docker info` (Docker Desktop aberto) e `supabase --version`. Para o que faltar, diga qual é e como instalar para o sistema operacional dela, e espere ela concluir.
3. **Dependências.** `pnpm install --frozen-lockfile`.
4. **Ambiente.** `cp .env.example .env.local` (no Windows: `copy`). Rode `supabase start` e preencha `.env.local` com os valores de `supabase status` (URL e chave pública/anon). Não peça nem use a chave `service_role` no navegador. Não deixe nenhuma variável obrigatória em branco: leia os comentários do `.env.example`.
5. **Banco.** `supabase db reset` (aplica as migrações no Supabase **local**).
6. **Dados de demonstração.** Este sistema não traz seed pronto; explique como criar o primeiro usuário em `docs/MEMBROS.md` ou no README.
7. **Rodar.** `pnpm dev` e abra http://localhost:3000. Entre com o usuário proprietário; no primeiro acesso ele cadastra o segundo fator (aplicativo autenticador). Mostre onde clicar primeiro.
8. **Conferir.** Rode `pnpm lint`, `pnpm typecheck` e `pnpm test`. Se quiser ir além: `pnpm test:db` (precisa do Docker).
9. **Fechar.** Resuma em 5 linhas o que foi instalado, o endereço, o login de demonstração e o próximo passo. Diga que, para publicar de verdade, ela precisa do **próprio** projeto Supabase (região São Paulo), hospedagem e e-mail, e aponte `docs/DEPLOYMENT.md`. Para adaptar a um cliente, sugira criar um repositório **privado** dela e ler `docs/DECISIONS.md` e `docs/FEATURES.md`.

## Privacidade
Os dados de demonstração são fictícios. Antes de usar dados reais de um cliente, siga a seção de privacidade (LGPD) do README e `docs/SECURITY.md`.
