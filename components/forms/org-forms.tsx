'use client';

import { useActionState } from 'react';
import { changeRole, createOrganization, createPrivacyRequest, removeMember, updatePrivacyStatus, updateSettings } from '@/app/(app)/actions';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import type { ActionState } from '@/lib/actions/result';
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from '@/lib/validation/org';
import { PRIVACY_STATUSES, PRIVACY_STATUS_LABELS, PRIVACY_TYPES, PRIVACY_TYPE_LABELS } from '@/lib/validation/privacy';

const initial: ActionState = {};

export function OnboardingForm() {
  const [state, action] = useActionState(createOrganization, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Nome da empresa" name="name" errors={state.fieldErrors?.name}>
        <Input id="name" name="name" required maxLength={120} defaultValue={state.values?.name} aria-invalid={Boolean(state.fieldErrors?.name)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Criando…">Criar organização</SubmitButton>
    </form>
  );
}

export function SettingsForm({ displayName, primaryColor }: { displayName: string; primaryColor: string }) {
  const [state, action] = useActionState(updateSettings, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Nome exibido" name="display_name" errors={state.fieldErrors?.display_name}>
        <Input id="display_name" name="display_name" required maxLength={120} defaultValue={state.values?.display_name ?? displayName} aria-invalid={Boolean(state.fieldErrors?.display_name)} />
      </Field>
      <Field label="Cor primária" name="primary_color" hint="O texto sobre a cor é ajustado automaticamente para manter o contraste." errors={state.fieldErrors?.primary_color}>
        <Input id="primary_color" name="primary_color" type="color" defaultValue={state.values?.primary_color ?? primaryColor} className="h-10 w-24 p-1" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Salvando…">Salvar configurações</SubmitButton>
    </form>
  );
}

export function MemberActions({ userId, role, canEdit, isSelf }: { userId: string; role: OrgRole; canEdit: boolean; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState(changeRole, initial);
  const [removeState, removeAction] = useActionState(removeMember, initial);
  if (!canEdit) return <span className="text-sm text-muted">{ROLE_LABELS[role]}</span>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="user_id" value={userId} />
          <Select name="role" defaultValue={role} aria-label="Papel do membro" className="w-40">
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
          <SubmitButton variant="secondary" pendingText="…">Salvar</SubmitButton>
        </form>
        {!isSelf ? (
          <form action={removeAction}>
            <input type="hidden" name="user_id" value={userId} />
            <SubmitButton variant="danger" pendingText="…">Remover</SubmitButton>
          </form>
        ) : null}
      </div>
      <FormMessage state={roleState.message ? roleState : removeState} />
    </div>
  );
}

export function PrivacyCreateForm() {
  const [state, action] = useActionState(createPrivacyRequest, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Tipo de solicitação" name="request_type" errors={state.fieldErrors?.request_type}>
        <Select id="request_type" name="request_type" defaultValue={state.values?.request_type ?? 'access'}>
          {PRIVACY_TYPES.map((t) => (
            <option key={t} value={t}>{PRIVACY_TYPE_LABELS[t]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Referência do titular" name="subject_reference" hint="Use um identificador interno (ex.: protocolo). Evite digitar CPF ou documentos aqui." errors={state.fieldErrors?.subject_reference}>
        <Input id="subject_reference" name="subject_reference" required maxLength={200} defaultValue={state.values?.subject_reference} aria-invalid={Boolean(state.fieldErrors?.subject_reference)} />
      </Field>
      <Field label="Anotações (opcional)" name="notes" errors={state.fieldErrors?.notes}>
        <Textarea id="notes" name="notes" maxLength={2000} defaultValue={state.values?.notes} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Registrando…">Registrar solicitação</SubmitButton>
    </form>
  );
}

export function PrivacyStatusForm({ id, status }: { id: string; status: (typeof PRIVACY_STATUSES)[number] }) {
  const [state, action] = useActionState(updatePrivacyStatus, initial);
  return (
    <div className="space-y-1">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <Select name="status" defaultValue={status} aria-label="Status da solicitação" className="w-40">
          {PRIVACY_STATUSES.map((s) => (
            <option key={s} value={s}>{PRIVACY_STATUS_LABELS[s]}</option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">Salvar</Button>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
