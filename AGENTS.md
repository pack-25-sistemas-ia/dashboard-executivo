# AGENTS — Dashboard Executivo

Sistema 09 do Pack 25 Sistemas IA (dashboard-executivo). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor e chama função `bi_*` do banco.
- Nunca commitar segredos; o app não usa service-role; jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII nem valores de planilha em logs, auditoria ou avisos; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:concurrency · pnpm test:mutation (sem outra carga) · pnpm test:e2e (Supabase local + app **recompilado**, porta 3123, um arquivo por vez, **depois de `supabase db reset`**) · node scripts/seed-check.mjs

## Regras do sistema
- **Nunca SQL ou JavaScript do usuário.** Tudo é spec JSON declarativa (`QuerySpec`) validada no TS (`lib/bi/engine/query.ts`) **e** no banco (`private.bi_exec_query`: chaves por `bi_key`, listas fechadas de operadores/agregações/granularidades, literais tipados por `bi_lit`, limites 12 medidas/2 dimensões/20 filtros/1000 linhas, `statement_timeout`). Mudou a spec: mude TS e SQL e os testes dos dois lados.
- Widget guarda a spec; a consulta de widget só aceita **período e filtros do dashboard** como sobrescrita. Visualizador só vê dados **por dashboard**; `dataset_rows` não tem SELECT; escrita só por `bi_*` (SECURITY DEFINER com `private.bi_guard`: sessão + MFA + papel).
- Colunas têm chave interna `c1..cn`; o nome de exibição é só rótulo. Valores são texto canônico por tipo em `values_json`; nunca converter dinheiro para `number`.
- Dinheiro/medidas: `decimal.js` (precisão 40). Fórmula é AST (`ref|num|add|sub|mul|div`); divisão por zero → estado `div_zero`; soma de nada → `no_data`; contagem → 0. Razões **não** somam entre grupos (`additive=false`). Nunca coalescer ausência para 0.
- Métricas e versões de dashboard são **imutáveis**; widget fixa a versão da métrica; atualizar é explícito. Dashboard salva com `expected row_version` (conflito = `40001`, nada sobrescrito).
- Importação: staging → publicação atômica; uma `processing` por dataset; hash repetido recusado; XLSX só valor em cache, macros recusadas, limite do zip conferido **antes** de inflar. Linhas só são apagadas pela retenção (`bi.allow_row_delete`).
- Exportação CSV neutraliza fórmulas (`safeCell`) e é auditada (relatório e nº de linhas, nunca valores).
- CSP estrita (sem estilo em linha): react-grid-layout e gráficos só no cliente (`dynamic ssr:false`); visualização usa classes Tailwind literais (`grid-classes.ts`). Não passar render-prop de servidor para cliente.
- Tabela que referencia `organization_members` **não** referencia `organizations` (PGRST201).
- Mudou regra crítica: rode `pnpm test:mutation` **sem outra carga** (todas devem morrer; crie mutação nova para regra nova) e `pnpm test:concurrency`.
- Cuidados: `String.replace` com `$$` corrompe SQL; heredoc/`node -e` perdem barras invertidas (use Write/Edit); `raise` dentro de função desfaz o próprio `bi_begin_import` (teste falhas parciais com chamadas RPC separadas); login repetido nos E2E esbarra no limitador (reaproveite cookies; reinicie o app entre arquivos); seletores Playwright ambíguos quebram o modo estrito (use ids); não pare containers Supabase de outros projetos.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, concorrência real, mutação, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
