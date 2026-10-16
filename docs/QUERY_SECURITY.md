# QUERY_SECURITY — consultas seguras

**Regra de ouro:** o navegador nunca envia SQL. Ele envia (ou o banco já guarda no widget) uma *especificação declarativa* em JSON; o banco a revalida e só então a converte em SQL.

## Especificação
`{ dataset_id, measures[{alias,agg,field?,filters?}], dimensions[{field,grain?}], filters[], period{field,from,to}, order[], limit }`.

## O que impede injeção e abuso (todas as camadas repetem a validação)
1. **Identificadores = chaves internas** `c1…cn` (`^c[1-9][0-9]{0,2}$`) **e presentes no catálogo da versão** (`private.bi_key`). O nome vindo do arquivo é só rótulo e nunca vira identificador (D-B4).
2. **Listas fechadas**: agregações (`sum,count,count_distinct,avg,min,max`), operadores (`eq,neq,contains,in,gt,gte,lt,lte,between,empty,not_empty`), granularidades, direção de ordenação, apelidos `^m[0-9]{1,2}$`.
3. **Valores tipados**: números `^-?\d{1,15}(\.\d{1,6})?$` com `::numeric`; datas por `bi_try_date`; booleanos só JSON booleano; texto por `quote_literal`. Aspas, `;` e `--` viram texto.
4. **Compatibilidade de tipo** (soma/média só numérico, min/max numérico ou data, «contém» só texto, granularidade só data).
5. **Limites**: 12 medidas, 2 dimensões, 20 filtros por consulta/medida, 50 valores em «em lista», 1.000 linhas de resultado (com `truncated`), páginas de 100 (5.000 na exportação), `statement_timeout` de 10 s (5 s nas listas de valores).
6. **Autorização no banco**: `bi_run_query` (analista+, dataset visível), `bi_widget_query` (a especificação vem do **widget salvo**; o chamador só troca período e valores dos filtros que o dashboard declara), `bi_dataset_rows` (analista+; exportação bruta gestor+). `dataset_rows` não tem `SELECT` para ninguém; `bi_exec_query` e `bi_cols` não são executáveis por usuários.
7. **Dataset restrito** vale em cada consulta (revogação com efeito imediato). Dashboard compartilhado não abre o dataset: quem só visualiza consulta **apenas widgets**.
8. **Isolamento**: toda consulta filtra `organization_id` e `dataset_version_id`; ids manipulados caem em «sem permissão».
9. **Sem cache compartilhado** entre empresas (nenhum cache de resultados no servidor); rotas de exportação respondem `Cache-Control: no-store`.
10. **Erros** devolvem mensagens nossas em português; detalhes do Postgres não chegam ao navegador.

## Fórmulas
Árvore `ref | num | add | sub | mul | div` validada no TypeScript e no banco (formato, profundidade ≤ 6, ≤ 40 nós, ≤ 20 referências, mesmo dataset, sem ciclo). Não existe avaliação de texto, `eval` nem função definida pelo usuário. A combinação das medidas-base ocorre no servidor com `decimal.js` (precisão 40, meio-para-cima só na exibição).

## Testes
SQL 90 (≈50 tentativas de injeção/consulta inválida e limites), SQL 92–93 (matriz por papel), E2E `bi-security` (3, 4, 10, 13), mutações de `bi_key`, `bi_lit`, limites, operadores e permissões.
