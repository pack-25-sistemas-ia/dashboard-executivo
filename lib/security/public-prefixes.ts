// Prefixos de rota acessíveis SEM sessão, além das rotas de autenticação (ver paths.ts).
// O Core não tem nenhum. Um sistema que expõe páginas públicas (ex.: link de proposta, formulário público)
// lista aqui o prefixo (com a barra final, ex.: '/p/') e declara este arquivo em .core-overrides.
// Cada rota pública DEVE fazer a própria validação (token, limite de taxa) e nunca usar a sessão.
export const PUBLIC_PREFIXES: readonly string[] = [];
