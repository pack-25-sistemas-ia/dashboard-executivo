// Configuração do Dashboard Executivo. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Papéis do Core → perfis de BI: owner/admin = Administrador; manager = Gestor; member = Analista; viewer = Visualizador
// (ver docs/PERMISSIONS.md). Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
// Itens de menu entram junto com as telas reais de cada módulo (nenhum link para página inexistente).
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Dashboard Executivo',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/inicio', label: 'Início' },
    { href: '/dashboards', label: 'Dashboards' },
    { href: '/metas', label: 'Metas', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/datasets', label: 'Datasets', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/importacoes', label: 'Importações', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/explorador', label: 'Explorador', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/indicadores', label: 'Indicadores', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/compartilhamentos', label: 'Compartilhamentos', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/qualidade', label: 'Qualidade dos dados', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/notificacoes', label: 'Avisos' },
    { href: '/configuracoes', label: 'Config. do BI', roles: ['owner', 'admin'] },
  ],
};
