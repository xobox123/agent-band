# 0003: Agent identity, versioned policy and hash-chained audit log

## Context

The product is a control plane for a fleet of AI coding agents. Users need to know who did what, what each agent is allowed to do, and to trust the history.

## Decision

- Every agent is a principal with a stable id and handle (`agent:<slug>`). Runs, tool calls, git commits and audit entries are attributed to it.
- Permissions are explicit, immutable, versioned policies evaluated by one pure policy engine. Runs record the policy version they ran under. Every decision is audited.
- The audit log is append-only and hash-chained (`hash = sha256(prevHash + canonicalJSON(event))`). A database trigger rejects UPDATE and DELETE. The chain can be verified and exported.
- Stage 1 resolves every request to `user:local` behind a single actor-resolution function.

## Consequences

- Full attribution and a verifiable history from day one.
- Real authentication can replace the actor function in stage 5 without touching callers.
- Writes to the audit log are serialised by the chain, which is acceptable at the expected volume.
- Per-agent signing keys are out of scope for stage 1.
