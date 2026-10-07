import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

export const OrganizationDto = z.object({
  id: Id,
  name: z.string(),
  taskKeyPrefix: z.string(),
  timezone: z.string(),
  policyId: Id.nullable(),
  paused: z.boolean(),
  /** Absolute folder under which tasks get their own working folder by default. */
  workspaceRoot: z.string(),
  createdAt: IsoDate,
});
export type OrganizationDto = z.infer<typeof OrganizationDto>;

export const UpdateOrganizationBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    taskKeyPrefix: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/)
      .optional(),
    timezone: z.string().min(1).max(100).optional(),
    workspaceRoot: z.string().startsWith('/').max(4096).optional(),
  })
  .strict();
export type UpdateOrganizationBody = z.infer<typeof UpdateOrganizationBody>;

export const SetPausedBody = z.object({ paused: z.boolean() }).strict();
export type SetPausedBody = z.infer<typeof SetPausedBody>;

export const SetOrgPolicyBody = z.object({ policyId: Id.nullable() }).strict();
export type SetOrgPolicyBody = z.infer<typeof SetOrgPolicyBody>;

export const UserDto = z.object({
  id: Id,
  handle: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['active', 'disabled']),
});
export type UserDto = z.infer<typeof UserDto>;
export const UserList = listOf(UserDto);

export const TeamDto = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  memberIds: z.array(Id),
});
export type TeamDto = z.infer<typeof TeamDto>;
export const TeamList = listOf(TeamDto);

export const CreateTeamBody = z
  .object({ name: z.string().min(1).max(100), description: z.string().max(1000).default('') })
  .strict();
export type CreateTeamBody = z.input<typeof CreateTeamBody>;

export const TeamParams = z.object({ teamId: Id });
export const AddTeamMemberBody = z.object({ userId: Id }).strict();
export type AddTeamMemberBody = z.infer<typeof AddTeamMemberBody>;

export const Role = z.enum(['owner', 'admin', 'operator', 'viewer']);
export type Role = z.infer<typeof Role>;
export const RoleSubject = z.union([z.object({ userId: Id }).strict(), z.object({ teamId: Id }).strict()]);
export const RoleScope = z.union([
  z.object({ org: z.literal(true) }).strict(),
  z.object({ agentGroupId: Id }).strict(),
  z.object({ agentId: Id }).strict(),
]);

export const RoleBindingDto = z.object({
  id: Id,
  subject: RoleSubject,
  role: Role,
  scope: RoleScope,
  createdAt: IsoDate,
});
export type RoleBindingDto = z.infer<typeof RoleBindingDto>;
export const RoleBindingQuery = z.object({ agentGroupId: Id.optional(), agentId: Id.optional() });
export type RoleBindingQuery = z.infer<typeof RoleBindingQuery>;
export const RoleBindingList = listOf(RoleBindingDto);

export const CreateRoleBindingBody = z
  .object({ subject: RoleSubject, role: Role, scope: RoleScope })
  .strict();
export type CreateRoleBindingBody = z.infer<typeof CreateRoleBindingBody>;

export const PrincipalDto = z.object({
  id: Id,
  kind: z.enum(['user', 'agent', 'system']),
  handle: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
  createdAt: IsoDate,
});
export type PrincipalDto = z.infer<typeof PrincipalDto>;
export const PrincipalList = listOf(PrincipalDto);
export const PrincipalQuery = z.object({ kind: z.enum(['user', 'agent', 'system']).optional() });
