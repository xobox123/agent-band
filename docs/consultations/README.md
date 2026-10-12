# GPT Consultations

These are product and architecture discussions between the product owner and ChatGPT. They are **discovery records**, not approved backlog entries, product requirements or instructions to start building.

## Consultations

| Date | Document | Topics |
| --- | --- | --- |
| 2026-10-12 | [001: Product direction and UX](2026-10-12-gpt-consultation-001.md) | Product origin, account limits, macOS/deployment, BYOK, conversational tasks and voice (GPT + Claude), visual agent/workflow builder, context, permissions, enterprise strategy |
| 2026-10-12 | [002: External Git Agents](2026-10-12-gpt-consultation-002-external-git-agents.md) | ChatGPT text sessions as GitHub-backed external agents, provisioning, short bootstrap prompt, task queue, branches, reports, PR/CI verification, resuming sessions |

## How Claude should use these notes

When discussing product direction, roadmap, architecture changes or new tasks:

1. Read the most relevant consultation(s) and consider the owner's actual intent.
2. Compare suggestions against current source code, specs and backlog. Do not assume an idea has been implemented just because it was discussed.
3. Separate owner-confirmed requirements from hypotheses, proposals and undecided options.
4. Provide a critical assessment: possible tasks, dependencies, effort, acceptance criteria and alternatives. Changing direction is an acceptable recommendation when explained.
5. Ask for a decision before adding new backlog items or executing consultation-derived proposals, unless the owner specifically requests those actions.

For future discussions, create another dated, numbered consultation note and add it to this index. Preserve previous notes; follow-up decisions may reference them rather than rewriting their history.
