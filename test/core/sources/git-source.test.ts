import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type GitResolveResult,
  GitSourceError,
  cacheDirFor,
  resolveGitSource,
} from '../../../src/core/sources/git-source.js';

const execFileAsync = promisify(execFile);

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-git-source-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  return stdout.trim();
}

async function makeUpstreamRepo(): Promise<string> {
  const upstream = join(work, 'upstream');
  await mkdir(upstream, { recursive: true });
  await git(upstream, 'init', '-q', '-b', 'main');
  await writeFile(join(upstream, 'README.md'), 'hello\n', 'utf8');
  await git(upstream, 'add', '.');
  await git(upstream, 'commit', '-q', '-m', 'initial');
  // Local URL form acceptable to `git fetch origin`.
  return upstream;
}

function fileUrl(path: string): string {
  return `file://${path}`;
}

describe('resolveGitSource', () => {
  it('clones into the cache and returns the working-tree path on cold start', async () => {
    const upstream = await makeUpstreamRepo();
    const cacheDir = join(work, 'cache');

    const result = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });

    expect(result.localPath).toContain('cache');
    expect(result.url).toBe(fileUrl(upstream));
    expect(result.ref).toBe('HEAD');
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);

    const readme = await readFile(join(result.localPath, 'README.md'), 'utf8');
    expect(readme).toBe('hello\n');
  });

  it('reuses the cache on subsequent calls without refetching', async () => {
    const upstream = await makeUpstreamRepo();
    const cacheDir = join(work, 'cache');

    const first = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });

    // Delete the upstream — a real fetch would now fail. The cache hit must
    // not reach for the network/disk, so this call still has to succeed.
    await rm(upstream, { recursive: true, force: true });

    const second = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });

    expect(second.localPath).toBe(first.localPath);
    expect(second.sha).toBe(first.sha);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('refresh: true picks up a new upstream commit', async () => {
    const upstream = await makeUpstreamRepo();
    const cacheDir = join(work, 'cache');

    const first = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });

    // Add a second commit upstream.
    await writeFile(join(upstream, 'NEWFILE'), 'second\n', 'utf8');
    await git(upstream, 'add', '.');
    await git(upstream, 'commit', '-q', '-m', 'second');

    const second = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir, refresh: true });

    expect(second.sha).not.toBe(first.sha);
    expect(second.fetchedAt).not.toBe(first.fetchedAt);
    const newFile = await readFile(join(second.localPath, 'NEWFILE'), 'utf8');
    expect(newFile).toBe('second\n');
  });

  it('caches different refs in different directories', async () => {
    const upstream = await makeUpstreamRepo();
    await git(upstream, 'tag', 'v1');

    // Add a second commit so HEAD diverges from v1.
    await writeFile(join(upstream, 'after-tag.txt'), 'x\n', 'utf8');
    await git(upstream, 'add', '.');
    await git(upstream, 'commit', '-q', '-m', 'after-tag');

    const cacheDir = join(work, 'cache');

    const headResult = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });
    const tagResult = await resolveGitSource({ url: fileUrl(upstream), ref: 'v1' }, { cacheDir });

    expect(headResult.localPath).not.toBe(tagResult.localPath);
    expect(headResult.sha).not.toBe(tagResult.sha);
    expect(tagResult.ref).toBe('v1');
  });

  it('writes a meta file beside the working tree with url + ref + sha', async () => {
    const upstream = await makeUpstreamRepo();
    const cacheDir = join(work, 'cache');

    const result: GitResolveResult = await resolveGitSource(
      { url: fileUrl(upstream), ref: 'main' },
      { cacheDir },
    );

    const metaPath = join(cacheDirFor(fileUrl(upstream), 'main', cacheDir), '.hex-meta.json');
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw);
    expect(meta).toEqual({
      url: fileUrl(upstream),
      ref: 'main',
      sha: result.sha,
      fetchedAt: result.fetchedAt,
    });
  });

  it('throws GitSourceError when the URL is unreachable', async () => {
    const cacheDir = join(work, 'cache');
    const bogus = join(work, 'no-such-repo');
    await expect(resolveGitSource({ url: fileUrl(bogus) }, { cacheDir })).rejects.toThrow(
      GitSourceError,
    );
  });

  it('recovers from a partial cache (meta missing) by re-cloning', async () => {
    const upstream = await makeUpstreamRepo();
    const cacheDir = join(work, 'cache');

    const first = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });

    // Wipe the meta file but keep the repo — represents an interrupted run.
    const metaPath = join(cacheDirFor(fileUrl(upstream), undefined, cacheDir), '.hex-meta.json');
    await rm(metaPath, { force: true });

    const second = await resolveGitSource({ url: fileUrl(upstream) }, { cacheDir });
    expect(second.localPath).toBe(first.localPath);
    expect(second.sha).toBe(first.sha);
  });
});

describe('cacheDirFor', () => {
  it('produces stable, distinct paths for distinct (url, ref) pairs', () => {
    const base = '/tmp/cache';
    const a = cacheDirFor('https://example.com/a', 'main', base);
    const b = cacheDirFor('https://example.com/a', 'main', base);
    const c = cacheDirFor('https://example.com/a', 'v1', base);
    const d = cacheDirFor('https://example.com/b', 'main', base);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('slugifies refs containing slashes for filesystem safety', () => {
    const base = '/tmp/cache';
    const dir = cacheDirFor('https://example.com/a', 'feat/foo', base);
    expect(dir).not.toContain('feat/foo');
    expect(dir).toContain('feat_foo');
  });
});
