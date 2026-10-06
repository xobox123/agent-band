import type { Composition } from '../composition.ts';
import { invalid } from '../platform/errors.ts';

/** Policy bindings live in other modules; the HTTP layer checks the policy exists in the org. */
export async function requirePolicy(
  c: Composition,
  orgId: string,
  policyId: string | null | undefined,
): Promise<void> {
  if (policyId === null || policyId === undefined) return;
  if (!(await c.policies.exists(orgId, policyId))) {
    throw invalid([{ path: 'policyId', message: 'policy does not exist' }]);
  }
}
