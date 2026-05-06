import { stat } from 'node:fs/promises';
import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { getDefaultConfigPath, loadConfig } from '../core/config/load.js';
import type { SourceRootEntry } from '../core/config/types.js';
import {
  type GitResolveResult,
  GitSourceError,
  checkUpstreamDrift,
  readGitMeta,
  resolveGitSource,
} from '../core/sources/git-source.js';

type GitStatus = {
  cached: boolean;
  sha?: string;
  fetchedAt?: string;
  drift?: boolean;
  upstreamSha?: string;
  driftError?: string;
};

type SourceStatus =
  | { kind: 'path'; path: string; exists: boolean }
  | { kind: 'git'; url: string; ref?: string; status: GitStatus };

export function registerSources(program: Command): void {
  const sources = program.command('sources').description('manage configured template source roots');

  sources
    .command('list', { isDefault: true })
    .description('list configured sources with cache + drift status')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (opts: { json: boolean }) => {
      await runList(opts.json);
    });

  sources
    .command('refresh')
    .description('force-refresh every git source root, ignoring the cache')
    .action(async () => {
      await runRefresh();
    });
}

async function runList(asJson: boolean): Promise<void> {
  const config = await loadConfig();

  if (config.sources.length === 0) {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ sources: [] }, null, 2)}\n`);
      return;
    }
    const configPath = getDefaultConfigPath();
    process.stdout.write(`${brand.dim('No source roots configured.')}\n`);
    process.stdout.write(`${brand.dim(`(edit ${configPath} to add some)`)}\n`);
    return;
  }

  const statuses = await Promise.all(config.sources.map(describeSource));

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ sources: statuses }, null, 2)}\n`);
    return;
  }

  for (const s of statuses) process.stdout.write(formatStatusLine(s));
}

async function describeSource(source: SourceRootEntry): Promise<SourceStatus> {
  if (source.kind === 'path') {
    return { kind: 'path', path: source.path, exists: await pathExists(source.path) };
  }

  // Informational only — never triggers a clone. `hex sources refresh` is
  // the explicit knob that populates caches; `list` just reports state.
  const status: GitStatus = { cached: false };
  const meta = await readGitMeta({ url: source.url, ref: source.ref });
  if (meta) {
    status.cached = true;
    status.sha = meta.sha;
    status.fetchedAt = meta.fetchedAt;
    try {
      const drift = await checkUpstreamDrift({ url: source.url, ref: source.ref });
      status.drift = drift.drift;
      status.upstreamSha = drift.upstreamSha ?? undefined;
      if (drift.error) status.driftError = drift.error;
    } catch (err) {
      status.driftError = err instanceof Error ? err.message : String(err);
    }
  }
  return { kind: 'git', url: source.url, ref: source.ref, status };
}

function formatStatusLine(s: SourceStatus): string {
  if (s.kind === 'path') {
    const tag = s.exists ? brand.done('exists') : brand.warn('missing');
    return `${brand.bold('path')}  ${s.path}  ${tag}\n`;
  }

  const display = s.ref ? `${s.url}@${s.ref}` : s.url;
  let tail: string;
  if (!s.status.cached) {
    tail = brand.dim('uncached');
  } else {
    const sha = s.status.sha?.slice(0, 7) ?? '?';
    const fetchedAt = s.status.fetchedAt ? ` ${brand.dim(`fetched ${s.status.fetchedAt}`)}` : '';
    const drift = s.status.drift
      ? brand.warn(`drift → upstream ${s.status.upstreamSha?.slice(0, 7) ?? '?'}`)
      : brand.done('fresh');
    tail = `${brand.dim(sha)}${fetchedAt}  ${drift}`;
  }
  const errSuffix = s.status.driftError ? `  ${brand.dim(`(${s.status.driftError})`)}` : '';
  return `${brand.bold('git ')}  ${display}  ${tail}${errSuffix}\n`;
}

async function runRefresh(): Promise<void> {
  const config = await loadConfig();
  const gitSources = config.sources.filter((s) => s.kind === 'git');

  if (gitSources.length === 0) {
    process.stdout.write(`${brand.dim('No git sources to refresh.')}\n`);
    return;
  }

  let failures = 0;
  for (const source of gitSources) {
    const display = source.ref ? `${source.url}@${source.ref}` : source.url;
    process.stdout.write(`${brand.dim('refreshing')} ${display} ... `);
    try {
      const result: GitResolveResult = await resolveGitSource(
        { url: source.url, ref: source.ref },
        { refresh: true },
      );
      process.stdout.write(`${brand.done('ok')} ${brand.dim(result.sha.slice(0, 7))}\n`);
    } catch (err) {
      failures += 1;
      const msg = err instanceof GitSourceError ? err.message : String(err);
      process.stdout.write(`${brand.error('failed')}\n  ${brand.dim(msg)}\n`);
    }
  }

  if (failures > 0) process.exitCode = 1;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
