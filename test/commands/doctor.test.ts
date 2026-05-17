import { describe, expect, it } from 'vitest';
import { formatLockfileSection, formatSetupSection } from '../../src/commands/doctor.js';
import { checklistFromTasks, markTask } from '../../src/core/checklist/index.js';
import type { LoadedLockfile, Lockfile, LockfileIntegrity } from '../../src/core/lockfile/index.js';

const fakePath = '/work/.hex/checklist.yaml';
const fakeRoot = '/work';

describe('formatSetupSection', () => {
  it('returns null when no checklist was found', () => {
    expect(formatSetupSection(null)).toBeNull();
  });

  it('returns null when every task is already done', () => {
    let checklist = checklistFromTasks([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]);
    checklist = markTask(checklist, 'a', 'done');
    checklist = markTask(checklist, 'b', 'done');
    expect(formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist })).toBeNull();
  });

  it('lists pending tasks, mentions the resume command', () => {
    const checklist = checklistFromTasks([
      { id: 'install-deps', title: 'Install dependencies' },
      { id: 'push-to-github', title: 'Push to GitHub for first deploy' },
    ]);
    const out = formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist });
    expect(out).not.toBeNull();
    expect(out).toContain('install-deps');
    expect(out).toContain('Install dependencies');
    expect(out).toContain('push-to-github');
    expect(out).toContain('hex setup');
  });

  it('omits done tasks from the list, but reflects them in the count', () => {
    let checklist = checklistFromTasks([
      { id: 'a', title: 'Done one' },
      { id: 'b', title: 'Pending one' },
    ]);
    checklist = markTask(checklist, 'a', 'done');
    const out = formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist });
    expect(out).not.toBeNull();
    expect(out).toContain('1 pending, 1 done');
    expect(out).toContain('Pending one');
    expect(out).not.toContain('Done one');
  });
});

/** A recipe lockfile with one component child and one nested-recipe child. */
function fakeRecipeLockfile(): Lockfile {
  return {
    schema_version: 1,
    root: {
      name: 'node-ts-fullstack',
      version: '0.1.0',
      type: 'recipe',
      source: { kind: 'file', path: '/srv/node-ts-fullstack' },
    },
    children: [
      {
        key: 'api',
        name: 'api-fastify',
        version: '0.3.0',
        type: 'component',
        stub: false,
        source: { kind: 'file', path: '/srv/api-fastify' },
      },
      {
        key: 'platform',
        name: 'platform',
        version: '0.2.0',
        type: 'recipe',
        stub: false,
        source: { kind: 'file', path: '/srv/platform' },
        children: [
          {
            key: 'db',
            name: 'db-postgres',
            version: '2.0.0',
            type: 'component',
            stub: true,
            source: { kind: 'file', path: '/srv/db-postgres' },
          },
        ],
      },
    ],
    answers: {},
    files: [],
  };
}

function loaded(lockfile: Lockfile): LoadedLockfile {
  return { path: '/work/.hex/lockfile.yaml', rootDir: '/work', lockfile };
}

const cleanIntegrity: LockfileIntegrity = { ok: true, modified: [], missing: [], added: [] };

describe('formatLockfileSection', () => {
  it('returns null when no lockfile was found', () => {
    expect(formatLockfileSection(null, null)).toBeNull();
  });

  it('lists the root identity and every child with its version', () => {
    const out = formatLockfileSection(loaded(fakeRecipeLockfile()), cleanIntegrity);
    expect(out).not.toBeNull();
    expect(out).toContain('recipe node-ts-fullstack@0.1.0');
    expect(out).toContain('api');
    expect(out).toContain('api-fastify@0.3.0');
    // Nested-recipe child and its grandchild both appear.
    expect(out).toContain('platform@0.2.0');
    expect(out).toContain('db-postgres@2.0.0');
    // A stubbed child is marked.
    expect(out).toContain('(stub)');
  });

  it('shows a clean integrity status', () => {
    const out = formatLockfileSection(loaded(fakeRecipeLockfile()), cleanIntegrity);
    expect(out).toContain('✓');
    expect(out).toContain('integrity clean');
  });

  it('shows the divergence count and breakdown when files have changed', () => {
    const integrity: LockfileIntegrity = {
      ok: false,
      modified: ['src/index.ts', 'package.json'],
      missing: ['README.md'],
      added: ['src/extra.ts'],
    };
    const out = formatLockfileSection(loaded(fakeRecipeLockfile()), integrity);
    expect(out).not.toBeNull();
    expect(out).toContain('4 files diverged');
    expect(out).toContain('2 modified, 1 missing, 1 added');
  });

  it('uses the singular for a lone divergence', () => {
    const integrity: LockfileIntegrity = {
      ok: false,
      modified: ['src/index.ts'],
      missing: [],
      added: [],
    };
    const out = formatLockfileSection(loaded(fakeRecipeLockfile()), integrity);
    expect(out).toContain('1 file diverged');
  });

  it('notes when integrity was not checked', () => {
    const out = formatLockfileSection(loaded(fakeRecipeLockfile()), null);
    expect(out).toContain('not checked');
  });

  it('handles a standalone component (no children)', () => {
    const lockfile: Lockfile = {
      schema_version: 1,
      root: {
        name: 'db-postgres',
        version: '2.0.0',
        type: 'component',
        source: { kind: 'file', path: '/srv/db-postgres' },
      },
      children: [],
      answers: {},
      files: [],
    };
    const out = formatLockfileSection(loaded(lockfile), cleanIntegrity);
    expect(out).toContain('component db-postgres@2.0.0');
  });
});
