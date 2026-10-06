export { bootstrapLocalOrg } from './app/bootstrap.ts';
export { authorize, authorizer } from './app/authorize.ts';
export { createPrincipal, principalRegistry, type NewPrincipal } from './app/principals.ts';
export {
  getOrganization,
  orgSettings,
  setOrgPolicy,
  updateOrganization,
  type OrganizationDto,
} from './app/settings.ts';
export { orgUseCases, type RoleBindingDto, type TeamDto, type UserDto } from './app/use-cases.ts';
export type { Action, Binding, ResourceRef, Role, Scope } from './domain/rbac.ts';
