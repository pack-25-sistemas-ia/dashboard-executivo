# Rotas autenticadas

Não crie `loading.tsx` neste nível. Um `loading.tsx` aqui faz a resposta começar a ser enviada (streaming)
antes de a página decidir `notFound()`, e páginas restritas passariam a responder HTTP 200 com a tela de
"não encontrada". Coloque `loading.tsx` apenas em páginas abertas a todos os papéis (ex.: dashboard, members).
Teste: tests/e2e/security.spec.ts ("isolamento entre organizações ... papéis aplicados no servidor").
