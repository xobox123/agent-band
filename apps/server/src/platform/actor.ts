export interface ActorContext {
  orgId: string;
  principalId: string;
  kind: 'user' | 'agent' | 'system';
  requestId: string;
}
