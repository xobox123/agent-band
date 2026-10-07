export { createProjects, type Projects, type ProjectsDeps } from './app/projects.ts';
export { createReview, type Review, type ReviewDeps, type TaskDiff } from './app/review.ts';
export { createProjectRuns, type ProjectRuns, type ProjectRunsDeps } from './app/run-hooks.ts';
export type { Project } from './infra/schema.ts';
export { inspectRepo, type RepoInspection } from './infra/git.ts';
