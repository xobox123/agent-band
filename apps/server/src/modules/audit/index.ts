import type { AuditLog } from '../../ports/index.ts';
import { appendAudit } from './app/append.ts';

export { appendAudit } from './app/append.ts';
export {
  createAudit,
  type AuditEventDto,
  type AuditExportFilter,
  type AuditFilter,
  type AuditRange,
  type VerifyResult,
} from './app/queries.ts';

export const auditLog: AuditLog = { append: appendAudit };
