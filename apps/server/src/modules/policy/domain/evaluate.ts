import { isPathAllowed } from './paths.ts';
import { type EffectivePolicy, type Mode, minMode } from './rules.ts';

export interface RunStartRequest {
  agentEnabled: boolean;
  workDir: string;
  requestedMode?: Mode;
  accountId: string;
  skillIds: string[];
  agentTokensToday: number;
}

export interface Decision {
  allow: boolean;
  reasons: string[];
  mode: Mode;
}

export function evaluateRunStart(p: EffectivePolicy, r: RunStartRequest): Decision {
  const reasons: string[] = [];
  if (!r.agentEnabled) reasons.push('agent is disabled');
  if (!isPathAllowed(r.workDir, p.workDirSets)) {
    reasons.push(`workDir ${r.workDir} is outside the allowed directories`);
  }
  if (p.allowedAccountIds && !p.allowedAccountIds.includes(r.accountId)) {
    reasons.push(`account ${r.accountId} is not allowed`);
  }
  if (p.allowedSkillIds) {
    const allowed = new Set(p.allowedSkillIds);
    for (const id of r.skillIds) {
      if (!allowed.has(id)) reasons.push(`skill ${id} is not allowed`);
    }
  }
  if (p.dailyTokenBudget !== undefined && r.agentTokensToday >= p.dailyTokenBudget) {
    reasons.push(`daily token budget exhausted (${r.agentTokensToday} of ${p.dailyTokenBudget} used)`);
  }
  return {
    allow: reasons.length === 0,
    reasons,
    // A request above maxMode is capped, not denied.
    mode: minMode(r.requestedMode ?? p.maxMode, p.maxMode),
  };
}
