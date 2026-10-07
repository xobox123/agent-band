import type { CreateProjectBody, ProjectDto, UpdateProjectBody } from '@agent-band/contracts';
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

export function ProjectForm({ project, pending, error, onCreate, onUpdate, onCancel }: Props) {
  const api = useApi();
  const editing = project !== undefined;
  const [name, setName] = useState(project?.name ?? '');
  const [repoPath, setRepoPath] = useState(project?.repoPath ?? '');
  const [worktreesRoot, setWorktreesRoot] = useState('');
  const [checks, setChecks] = useState((project?.checks ?? []).join('\n'));
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
  if (!editing) {
    if (repoPath.trim() === '') errors['repoPath'] = 'Repository path is required.';
    else if (repo.state === 'bad') errors['repoPath'] = repo.message;
    if (worktreesRoot.trim() !== '' && !worktreesRoot.trim().startsWith('/'))
      errors['worktreesRoot'] = 'Worktrees folder must be an absolute path.';
  }

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
          onUpdate(project.id, { name: name.trim(), checks: parseChecks(checks), keepWorktrees: keep });
          return;
        }
        onCreate({
          name: name.trim(),
          repoPath: repoPath.trim(),
          ...(worktreesRoot.trim() ? { worktreesRoot: worktreesRoot.trim() } : {}),
          checks: parseChecks(checks),
          keepWorktrees: keep,
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
    </FormDialog>
  );
}
