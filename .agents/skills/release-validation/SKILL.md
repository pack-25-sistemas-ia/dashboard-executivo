---
name: release-validation
description: Use antes de declarar o sistema pronto: validação completa, instalação isolada, CI e repositório.
---

# Validação de entrega

- Na ordem: lint, typecheck, unit, build, `pnpm test:db`, `pnpm test:concurrency`, `pnpm test:mutation` (sem outra carga), E2E um arquivo por vez após `supabase db reset` e reinício do app.
- Exportar com `scripts/export-system.mjs`, instalar em pasta isolada e repetir lint/tipos/unit/build. Rodar `check-no-secrets` e `validate-catalog`.
- Nunca dizer «passou» sem rodar: escrever NÃO EXECUTADO.
