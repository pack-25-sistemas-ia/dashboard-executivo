# ARCHITECTURE

```
Navegador ── Server Components/Actions (Next.js 16) ──► Supabase (Auth + PostgreSQL com RLS)
   │  gráficos (Recharts) e editor (react-grid-layout) só no cliente        ▲
   └── envia ARQUIVO e CONFIGURAÇÃO (nunca SQL)                              │
Servidor: lê/tipa o arquivo (PapaParse, leitor XLSX próprio), compila indicadores, combina medidas com decimal.js
Banco: revalida tudo, executa a consulta declarativa e guarda versões
```

Camadas: **Apresentação** (`app/`, `components/bi`), **Aplicação** (`lib/bi/actions`, `lib/bi/{data,run,compile,dashboard-view}.ts`), **Domínio** (`lib/bi/engine/*`: tipos, leitura, métricas, períodos, metas, regras de gráfico — TypeScript puro e testado), **Infraestrutura** (Supabase, funções `bi_*`).

Decisões-chave em `docs/DECISIONS.md` (D-B1…). O motor de métricas é separado da apresentação: um indicador alimenta vários gráficos e a fórmula vive só nele.

Segurança: CSP com nonce (sem `unsafe-inline`), cabeçalhos do Core, MFA do administrador no banco, sem `service_role`, limitador de taxa nas ações e nas exportações, arquivos nunca executados.
