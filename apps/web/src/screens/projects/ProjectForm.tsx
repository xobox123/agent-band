import type {
  AgentDto,
  CreateProjectBody,
  ProjectDto,
  ReviewerTarget,
  UpdateProjectBody,
} from '@agent-band/contracts';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Field, FormDialog } from '../../components/FormDialog.tsx';

interface Props {
  project?: ProjectDto | undefined;
  pending: boolean;
  error: unknown;
  onCreate: (body: CreateProjectBody) => void;
  onUpdate: (id: string, body: UpdateProjectBody) => void;
  onCancel: () => void;
}

type Repo =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; defaultBranch: string }
  | { state: 'bad'; message: string };

export const parseChecks = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

type ReviewerKind = 'none' | 'label' | 'agent';

function reviewerOf(project: ProjectDto | undefined): { kind: ReviewerKind; value: string } {
  const target = project?.reviewerTarget;
  if (!target) return { kind: 'none', value: '' };
  return 'agentId' in target
    ? { kind: 'agent', value: target.agentId }
    : { kind: 'label', value: target.label };
}

export function ProjectForm({ project, pending, error, onCreate, onUpdate, onCancel }: Props) {
  const api = useApi();
  const editing = project !== undefined;
  const initialReviewer = reviewerOf(project);
  const [reviewerKind, setReviewerKind] = useState<ReviewerKind>(initialReviewer.kind);
  const [reviewerValue, setReviewerValue] = useState(initialReviewer.value);
  const [autoMerge, setAutoMerge] = useState(project?.autoMergeOnApprove ?? false);
  const [agents, setAgents] = useState<AgentDto[]>([]);

  useEffect(() => {
    if (reviewerKind !== 'agent') return;
    let live = true;
    api.agents.list().then(
      (page) => {
        if (live) setAgents(page.items);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, reviewerKind]);

  const reviewerTarget = (): ReviewerTarget | null => {
    const value = reviewerValue.trim();
    if (reviewerKind === 'none' || value === '') return null;
    return reviewerKind === 'agent' ? { agentId: value } : { label: value };
  };
  const [name, setName] = useState(project?.name ?? '');
  const [repoPath, setRepoPath] = useState(project?.repoPath ?? '');
  const [worktreesRoot, setWorktreesRoot] = useState('');
  const [checks, setChecks] = useState((project?.checks ?? []).join('\n'));
  const [docsEnabled, setDocsEnabled] = useState(project?.docsOnlyChecks != null);
  const [docPaths, setDocPaths] = useState(
    (project?.docsOnlyChecks?.paths ?? ['**/*.md', 'docs/**', 'handoff/**']).join('\n'),
  );
  const [docChecks, setDocChecks] = useState(
    (project?.docsOnlyChecks?.checks ?? ['npx prettier --check <changed files>']).join('\n'),
  );
  const [keep, setKeep] = useState(project?.keepWorktrees ?? false);
  const [repo, setRepo] = useState<Repo>({ state: 'idle' });
  const seq = useRef(0);

  useEffect(() => {
    if (editing) return;
    const path = repoPath.trim();
    const id = ++seq.current;
    if (path === '') {
      setRepo({ state: 'idle' });
      return;
    }
    if (!path.startsWith('/')) {
      setRepo({ state: 'bad', message: 'Enter an absolute path.' });
      return;
    }
    setRepo({ state: 'checking' });
    const timer = setTimeout(() => {
      api.projects.validate(path).then(
        (result) => {
          if (id !== seq.current) return;
          setRepo(
            result.valid
              ? { state: 'ok', defaultBranch: result.defaultBranch ?? '' }
              : { state: 'bad', message: result.reason ?? 'Not a git repository.' },
          );
        },
        (e: unknown) => {
          if (id === seq.current) setRepo({ state: 'bad', message: errorMessage(e) });
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [api, editing, repoPath]);

  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (docsEnabled && parseChecks(docPaths).length === 0) {
    errors['docPaths'] = 'Add at least one path pattern.';
  }
  if (docsEnabled && parseChecks(docChecks).length === 0) {
    errors['docChecks'] = 'Add at least one check.';
  }
  if (!editing) {
    if (repoPath.trim() === '') errors['repoPath'] = 'Repository path is required.';
    else if (repo.state === 'bad') errors['repoPath'] = repo.message;
    if (worktreesRoot.trim() !== '' && !worktreesRoot.trim().startsWith('/'))
      errors['worktreesRoot'] = 'Worktrees folder must be an absolute path.';
  }

  const docsOnlyChecks = docsEnabled
    ? { paths: parseChecks(docPaths), checks: parseChecks(docChecks) }
    : null;

  return (
    <FormDialog
      title={project ? `Edit ${project.name}` : 'Create project'}
      submitLabel={project ? 'Save changes' : 'Create project'}
      pending={pending || repo.state === 'checking'}
      error={error}
      errors={errors}
      onCancel={onCancel}
      onSubmit={() => {
        if (project) {
          onUpdate(project.id, {
            name: name.trim(),
            checks: parseChecks(checks),
            ...(docsEnabled || project.docsOnlyChecks ? { docsOnlyChecks } : {}),
            keepWorktrees: keep,
            reviewerTarget: reviewerTarget(),
            autoMergeOnApprove: autoMerge,
          });
          return;
        }
        const target = reviewerTarget();
        onCreate({
          name: name.trim(),
          repoPath: repoPath.trim(),
          ...(worktreesRoot.trim() ? { worktreesRoot: worktreesRoot.trim() } : {}),
          checks: parseChecks(checks),
          ...(docsEnabled ? { docsOnlyChecks } : {}),
          keepWorktrees: keep,
          ...(target ? { reviewerTarget: target } : {}),
          ...(autoMerge ? { autoMergeOnApprove: true } : {}),
        });
      }}
    >
      <Field label="Name" name="name" required>
        <input
          className="field"
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      {editing ? (
        <Field label="Repository">
          <span className="mono">{project.repoPath}</span>
        </Field>
      ) : (
        <Field
          label="Repository path"
          name="repoPath"
          required
          help={
            repo.state === 'checking'
              ? 'Checking the repository.'
              : repo.state === 'ok'
                ? `Git repository found. Default branch: ${repo.defaultBranch}.`
                : repo.state === 'bad'
                  ? repo.message
                  : 'Absolute path of the git repository on this machine.'
          }
        >
          <input
            className="field mono"
            value={repoPath}
            placeholder="/path/to/repo"
            onChange={(e) => {
              setRepoPath(e.target.value);
            }}
          />
        </Field>
      )}
      <div className="wide form-field">
        <Field
          label="Checks"
          help="One shell command per line, run in the worktree after an agent finishes (15 minutes each)."
        >
          <textarea
            className="field mono"
            rows={4}
            value={checks}
            placeholder={'npm run lint\nnpm test'}
            onChange={(e) => {
              setChecks(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="wide form-field form-check">
        <label className="check-row">
          <input
            type="checkbox"
            checked={docsEnabled}
            onChange={(e) => {
              setDocsEnabled(e.target.checked);
            }}
          />
          Run reduced checks for documentation-only changes
        </label>
      </div>
      {docsEnabled ? (
        <>
          <div className="wide form-field">
            <Field
              label="Documentation paths"
              name="docPaths"
              help="One glob per line. All changed files must match."
            >
              <textarea
                className="field mono"
                rows={3}
                value={docPaths}
                onChange={(e) => {
                  setDocPaths(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="wide form-field">
            <Field
              label="Documentation checks"
              name="docChecks"
              help="One command per line. <changed files> is replaced with quoted filenames."
            >
              <textarea
                className="field mono"
                rows={2}
                value={docChecks}
                onChange={(e) => {
                  setDocChecks(e.target.value);
                }}
              />
            </Field>
          </div>
        </>
      ) : null}
      <Field
        label="Reviewer"
        help="Reviews a finished task automatically when its checks pass. The reviewer works read-only in the same worktree."
      >
        <select
          className="field"
          value={reviewerKind}
          onChange={(e) => {
            setReviewerKind(e.target.value as ReviewerKind);
            setReviewerValue('');
          }}
        >
          <option value="none">No automatic review</option>
          <option value="label">Agents with a label</option>
          <option value="agent">One agent</option>
        </select>
      </Field>
      {reviewerKind === 'label' ? (
        <Field label="Reviewer label">
          <input
            className="field mono"
            value={reviewerValue}
            maxLength={100}
            placeholder="ab-review"
            onChange={(e) => {
              setReviewerValue(e.target.value);
            }}
          />
        </Field>
      ) : null}
      {reviewerKind === 'agent' ? (
        <Field label="Reviewer agent">
          <select
            className="field"
            value={reviewerValue}
            onChange={(e) => {
              setReviewerValue(e.target.value);
            }}
          >
            <option value="">Choose an agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {reviewerValue !== '' && !agents.some((a) => a.id === reviewerValue) ? (
              <option value={reviewerValue}>{reviewerValue}</option>
            ) : null}
          </select>
        </Field>
      ) : null}
      {editing ? null : (
        <details className="advanced wide" open={worktreesRoot !== ''}>
          <summary>Advanced: worktrees folder</summary>
          <Field
            label="Worktrees folder"
            name="worktreesRoot"
            help="Leave blank to use the workspace root. A folder outside it must be allowed by the agent's policy."
          >
            <input
              className="field mono"
              value={worktreesRoot}
              placeholder="/path/to/worktrees"
              onChange={(e) => {
                setWorktreesRoot(e.target.value);
              }}
            />
          </Field>
        </details>
      )}
      <div className="form-field form-check">
        <label className="check-row">
          <input
            type="checkbox"
            checked={keep}
            onChange={(e) => {
              setKeep(e.target.checked);
            }}
          />
          Keep worktrees and branches after a merge or cancel
        </label>
      </div>
      <div className="form-field form-check">
        <label className="check-row">
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => {
              setAutoMerge(e.target.checked);
            }}
          />
          Merge automatically when the reviewer approves and the checks passed
        </label>
      </div>
    </FormDialog>
  );
}
