# DASHBOARD_BUILDER — editor e modelo de widgets

## Persistência
- `dashboards` (nome, período/comparação padrão, status, visibilidade, **`row_version`**), `dashboard_widgets` (posição no PostgreSQL), `dashboard_filters`, `dashboard_versions` (instantâneos imutáveis ao publicar), `dashboard_permissions`.
- O widget guarda **`query_json`** (consulta declarativa já validada executando-a de verdade no salvamento) e **`display_json`** (apresentação + expressão de cada indicador na versão usada + a configuração do construtor, para reabrir e editar).

## Edição
`react-grid-layout` 2.x (12 colunas; arrastar, redimensionar; bloqueio de layout; posição/tamanho por campos numéricos como alternativa de teclado; desfazer; descartar). Salvar chama `bi_save_dashboard(expected = row_version)`: se outra pessoa salvou antes, a função falha com `40001` e **nada é sobrescrito**; o editor mostra o motivo. Título e posição preservam o travamento de versão do indicador; mudar o conteúdo do widget recompila a partir dos indicadores atuais.

## Visualização
Servidor renderiza; gráficos (Recharts) só no navegador (CSP sem `unsafe-inline`) e **todo gráfico traz «Ver dados em tabela»**. Desktop 12 colunas, tablet 2, celular 1, na ordem de leitura. Período, comparação e filtros globais na URL (compartilháveis). Fonte, versão e data de atualização do dataset no rodapé de cada widget; «Origem» abre o indicador.

## Tipos de widget
KPI e comparativo (variação com a base declarada), gráfico, tabela, texto (somente texto), meta (alvo × realizado respeitando a direção), última atualização, avisos (dataset desatualizado/indicador inválido).

## Modelos
Comercial, Financeiro gerencial (aviso: não é contabilidade oficial), Marketing, Operações e Gestão executiva. Cada modelo declara os papéis de coluna de que precisa; sem eles é «incompatível»; indicadores já existentes com o mesmo nome são reaproveitados.

## Responsivo e restauração
Restaurar versão publicada substitui widgets e filtros do rascunho pelo instantâneo (com checagem de conflito). Layouts distintos por ponto de corte (`md`, `sm`) são aceitos pelo banco; a visualização do MVP reorganiza automaticamente (limite documentado).
