import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gerente',
  member: 'Membro',
  viewer: 'Leitor',
};

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(120, 'Nome muito longo.'),
});

export const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.');

export const updateSettingsSchema = z.object({
  display_name: z.string().trim().min(2, 'Informe ao menos 2 caracteres.').max(120, 'Nome muito longo.'),
  primary_color: hexColorSchema,
});

export const changeRoleSchema = z.object({
  user_id: z.uuid('Usuário inválido.'),
  role: z.enum(ORG_ROLES, 'Papel inválido.'),
});

export const removeMemberSchema = z.object({ user_id: z.uuid('Usuário inválido.') });

export const uuidSchema = z.uuid();

export function isAdminRole(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function isPrivacyRole(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}
