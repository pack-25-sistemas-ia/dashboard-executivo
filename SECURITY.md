# Segurança

Este repositório é entregue como está, sem canal de suporte próprio. O suporte do curso é feito pela plataforma em que você o adquiriu.

## Como o Pack lida com segurança
RLS em todas as tabelas, verificação em duas etapas, CSP estrita, sem `service_role` no navegador e sem segredos no código. Detalhes em `docs/SECURITY_STANDARD.md`.

## Responsabilidade de quem implanta
A segurança do **seu** ambiente (Supabase, hospedagem, chaves, e-mail, backups) é sua. Antes de entregar a um cliente, revise o checklist de `docs/SECURITY_STANDARD.md` e `docs/LGPD_GUIDE.md`. Em caso de incidente com dados pessoais, siga `docs/LGPD_GUIDE.md` §7; a comunicação à ANPD e aos titulares cabe ao controlador.

## Achou uma falha no código?
Não publique detalhes que exponham instalações de terceiros. Use o recurso «Report a vulnerability» (aba Security) do repositório, se estiver habilitado.
