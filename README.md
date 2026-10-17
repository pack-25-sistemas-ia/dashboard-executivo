# Dashboard Executivo

Plataforma de BI **multiempresa** para gestores: importe planilhas (CSV/XLSX), valide e tipe os dados, defina indicadores com fórmulas seguras, monte dashboards arrastando e redimensionando, acompanhe metas, compartilhe internamente e exporte. Next.js + TypeScript + Supabase (Postgres com RLS). O dado do negócio nunca é consultado por SQL livre: o navegador só envia **configuração declarativa**, e o banco a revalida antes de executar.

**Público:** gestores que consolidam indicadores de várias planilhas.
**Problema:** relatórios montados à mão todo mês.

![Dashboard Comercial](docs/screenshots/dashboard-comercial.png)

## O que faz
- **Importação** CSV (PapaParse) e XLSX (leitor próprio sobre `fflate`: só valor em cache, macros recusadas, proteção contra zip bomb), com prévia, mapeamento de colunas, tipos (texto, inteiro, decimal, booleano, data, data/hora, moeda, percentual), formatos brasileiros (`1.234,56`, `DD/MM/AAAA`, `R$`, `%`), erros por linha baixáveis e **publicação atômica** (staging → versão ativa). Mesmo arquivo (hash) não entra duas vezes; modos *substituir* e *acrescentar com chave*.
- **Datasets versionados** com retenção configurável, qualidade dos dados, arquivamento e acesso restrito.
- **Motor de indicadores** em TypeScript com `decimal.js`: agregações (soma, contagem, distintos, média, mín., máx.) e fórmulas em **AST** (`+ − × ÷`, referência a outros indicadores, sem JavaScript nem SQL do usuário). Divisão por zero e «sem dados» são estados explícitos, nunca `0` ou `NaN`. Versões imutáveis; widgets fixam a versão usada.
- **Períodos e comparações** (hoje, mês, trimestre, ano, intervalos, período anterior/ano anterior) no fuso da empresa, com a base declarada (mês parcial: mesmos dias × mês cheio).
- **Gráficos** com regras de adequação (pizza só com soma/contagem e poucas categorias; linha exige tempo etc.), «Outros» agrupado, e **toda visualização com tabela equivalente**.
- **Editor visual** (`react-grid-layout`) persistido no PostgreSQL com **concorrência otimista**: quem salva depois de outra pessoa é avisado, nada é sobrescrito. Alternativa por teclado (campos de posição/tamanho), desfazer, rascunho × publicado com versões e restauração.
- **5 modelos** (Comercial, Financeiro gerencial, Marketing, Operações, Gestão executiva), **metas** (mínima, máxima, faixa, crescimento, redução), **compartilhamento interno** com níveis, favoritos, visões salvas, **notificações**, **exportação CSV** auditada que neutraliza injeção de fórmulas, white-label e LGPD (Core).

## Não faz
Conectores universais (banco de terceiros, ERP, APIs), tempo real/streaming, SQL ou JavaScript do usuário, publicação pública na internet, PDF/PPTX, previsão por IA, contabilidade oficial.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Dashboard Executivo: https://github.com/pack-25-sistemas-ia/dashboard-executivo
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install
supabase start && supabase db reset     # banco local + dados fictícios (seed reproduzível)
cp .env.example .env.local              # preencha com as chaves de «supabase status»
pnpm dev
```
Empresa fictícia «Horizonte Distribuidora». Usuários locais (senha única `DemoLocal#2026`): `dono@demo.exemplo` (administrador), `gestor@demo.exemplo`, `analista@demo.exemplo`, `analista2@demo.exemplo`, `consulta@demo.exemplo` (visualizador). Detalhes em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Qualidade
```bash
pnpm lint && pnpm typecheck && pnpm test    # motor: importação, métricas, widgets
pnpm build
pnpm test:db            # Postgres em Docker: Core + SQL 90–93 (RLS A×B, importação, consulta segura, dashboards, privilégios)
pnpm test:concurrency   # sessões paralelas reais (salvamento otimista, publicação única…)
pnpm test:mutation      # quebra regras críticas de propósito; todas devem reprovar
pnpm test:e2e           # Playwright contra Supabase local e o app compilado (um arquivo por vez)
```
Os resultados reais de cada rodada estão em [MEMORY.md](MEMORY.md); o que não foi executado aparece como NÃO EXECUTADO.

## Documentação
[Funcionalidades](docs/FEATURES.md) · [Importação](docs/IMPORT_ENGINE.md) · [Motor de indicadores](docs/METRIC_ENGINE.md) · [Consulta segura](docs/QUERY_SECURITY.md) · [Datasets](docs/DATASETS.md) · [Editor de dashboards](docs/DASHBOARD_BUILDER.md) · [Indicadores do sistema](docs/METRICS.md) · [Banco de dados](docs/DATABASE.md) · [Permissões](docs/PERMISSIONS.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Decisões](docs/DECISIONS.md) · [Plano](docs/PLANO_IMPLEMENTACAO.md) · [Implantação](docs/DEPLOYMENT.md) · [Auditoria de código aberto](docs/OPEN_SOURCE_AUDIT.md)

## Privacidade (LGPD)
Risco estimado: **médio**. As planilhas importadas podem conter dados pessoais; o sistema aplica minimização (o arquivo original não é guardado, a auditoria registra só contagens e nomes de colunas, sem valores), isolamento por empresa (RLS) e controle de acesso por dataset. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no hub do Pack.
