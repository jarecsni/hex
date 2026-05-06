import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitSourceError';
  }
}

export type GitResolveResult = {
  /** Filesystem path to the working tree (stable as long as the cache exists). */
  localPath: string;
  /** Original URL, verbatim from config. */
  url: string;
  /** Resolved ref — the input ref or `HEAD` when not specified. */
  ref: string;
  /** Commit SHA at the resolved ref. */
  sha: string;
  /** When the cache was last refreshed (ISO 8601). */
  fetchedAt: string;
};

export type ResolveOpts = {
  /** Override the cache root. Defaults to HEX_CACHE_DIR or ~/.hex/cache. */
  cacheDir?: string;
  /** Force a re-fetch even when a cache hit would otherwise satisfy the call. */
  refresh?: boolean;
};

const META_FILENAME = '.hex-meta.json';
const REPO_SUBDIR = 'repo';

export function getDefaultCacheDir(): string {
  const env = process.env.HEX_CACHE_DIR;
  if (env && env.length > 0) return env;
  return join(homedir(), '.hex', 'cache');
}

function shortHash(input: string, len: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len);
}

function refSlug(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Canonical cache directory for a `(url, ref)` pair. Each ref caches in
 * its own subdir so switching ref does not trash the other's checkout.
 *
 * Layout: `<base>/git/<urlHash16>/<refSlug>-<refHash8>/`
 */
export function cacheDirFor(url: string, ref: string | undefined, baseDir: string): string {
  const refKey = ref ?? '_head';
  return join(baseDir, 'git', shortHash(url, 16), `${refSlug(refKey)}-${shortHash(refKey, 8)}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertGitAvailable(): Promise<void> {
  try {
    await execFileAsync('git', ['--version']);
  } catch (err) {
    throw new GitSourceError(
      `git executable not found on PATH — install git to use git source roots (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

async function runGit(args: string[], cwd: string): Promise<void> {
  try {
    await execFileAsync('git', args, { cwd, env: process.env });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr?.trim() || e.message || String(err);
    throw new GitSourceError(`git ${args.join(' ')} failed: ${detail}`);
  }
}

async function revParseHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function clone(url: string, ref: string | undefined, repoDir: string): Promise<string> {
  await mkdir(repoDir, { recursive: true });
  await runGit(['init', '-q'], repoDir);
  await runGit(['remote', 'add', 'origin', url], repoDir);
  await runGit(['fetch', '--depth', '1', 'origin', ref ?? 'HEAD'], repoDir);
  await runGit(['checkout', '-q', 'FETCH_HEAD'], repoDir);
  return revParseHead(repoDir);
}

async function refetch(url: string, ref: string | undefined, repoDir: string): Promise<string> {
  // Make sure origin still points at the configured URL — it could have been
  // edited under us, or the cache could be partial from a failed previous run.
  await runGit(['remote', 'set-url', 'origin', url], repoDir);
  await runGit(['fetch', '--depth', '1', 'origin', ref ?? 'HEAD'], repoDir);
  await runGit(['reset', '--hard', 'FETCH_HEAD'], repoDir);
  return revParseHead(repoDir);
}

type Meta = {
  url: string;
  ref: string;
  sha: string;
  fetchedAt: string;
};

async function readMeta(metaPath: string): Promise<Meta | null> {
  try {
    const raw = await readFile(metaPath, 'utf8');
    return JSON.parse(raw) as Meta;
  } catch {
    return null;
  }
}

async function writeMeta(metaPath: string, meta: Meta): Promise<void> {
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Resolve a git source root into a local working tree, fetching on cache
 * miss and reusing the cache on hit. Set `opts.refresh` to force a
 * re-fetch even when the cache is warm.
 *
 * Authentication is delegated to the system `git` — SSH agent, credential
 * helpers, and `~/.gitconfig` all work transparently.
 */
export async function resolveGitSource(
  entry: { url: string; ref?: string },
  opts: ResolveOpts = {},
): Promise<GitResolveResult> {
  await assertGitAvailable();

  const baseDir = opts.cacheDir ?? getDefaultCacheDir();
  const cacheRoot = cacheDirFor(entry.url, entry.ref, baseDir);
  const repoDir = join(cacheRoot, REPO_SUBDIR);
  const metaPath = join(cacheRoot, META_FILENAME);

  const cached = await readMeta(metaPath);
  const repoExists = await pathExists(join(repoDir, '.git'));

  if (cached && repoExists && !opts.refresh) {
    return {
      localPath: repoDir,
      url: cached.url,
      ref: cached.ref,
      sha: cached.sha,
      fetchedAt: cached.fetchedAt,
    };
  }

  await mkdir(cacheRoot, { recursive: true });

  let sha: string;
  if (repoExists) {
    sha = await refetch(entry.url, entry.ref, repoDir);
  } else {
    // Cold cache or partial state — start fresh.
    if (await pathExists(repoDir)) await rm(repoDir, { recursive: true, force: true });
    sha = await clone(entry.url, entry.ref, repoDir);
  }

  const meta: Meta = {
    url: entry.url,
    ref: entry.ref ?? 'HEAD',
    sha,
    fetchedAt: new Date().toISOString(),
  };
  await writeMeta(metaPath, meta);

  return {
    localPath: repoDir,
    url: meta.url,
    ref: meta.ref,
    sha: meta.sha,
    fetchedAt: meta.fetchedAt,
  };
}
