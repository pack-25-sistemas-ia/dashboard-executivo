# METRIC_ENGINE — motor de métricas

Código: `lib/bi/engine/{metrics,query,periods,goals,chart-rules,format}.ts` (TypeScript puro) e `lib/bi/widgets.ts`. O banco executa **agregações-base**; a combinação (razão, diferença…) é feita no servidor com `decimal.js`.

## Tipos
Soma · Contagem · Contagem distinta · Média · Mínimo · Máximo (agregações) e **fórmulas** encadeadas com `+ − × ÷`. Crescimento percentual é calculado na comparação de períodos (`variation`).

## Regras matemáticas
- Soma de nenhum registro é **«sem dados»** (nulo), nunca zero; contagem de nenhum registro é **0**; a média ignora vazios.
- **Divisão por zero** → «indisponível: denominador zero». Nunca infinito/NaN.
- Percentual não é somado: só soma e contagem são **aditivas** (pizza, empilhado, «Outros» e totais exigem aditividade).
- Variação % = (atual − anterior) ÷ |anterior| × 100; anterior zero → «indisponível» (nunca infinito); os dois zero → «sem variação».
- Arredondamento meio-para-cima **só na exibição**.
- Períodos: datas civis no fuso da empresa, **inclusivos** nas duas pontas. Mês em andamento: compara o **mesmo número de dias** do mês anterior ou o mês anterior **completo** — escolha explícita e sempre escrita na tela.

## Versionamento e propagação
Cada alteração de indicador cria uma versão (`metric_versions`). O widget **guarda a expressão da versão usada**; o editor avisa «há versão mais nova» e só atualiza quando a pessoa salva. Colunas removidas ou com tipo alterado por uma nova carga marcam o indicador como **inválido** (com motivo), avisam a equipe e impedem consultas com dado velho.

## Metas
Mínima (≥), máxima (≤, «menor é melhor»), crescimento mínimo, redução mínima e faixa. Situação: atingida · em andamento · atenção (< limite % do alvo, período aberto) · não atingida · sem dados. Sem projeção de atingimento futuro.

## Conferência
Fixtures à mão em `tests/unit/bi-metrics.test.ts` (R$ 82.000 de R$ 100.000 = 82 %; 0,1 + 0,2 = 0,3) e `supabase/tests/90_bi_import_query.sql` (soma 1.410,74; média ÷ 9; meses 430,50/470,25/499,99/10,00).
