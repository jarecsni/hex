import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTemplates } from '../../../src/core/discovery/index.js';

let workspace: string;

async function makeTemplate(root: string, name: string, manifestBody: string): Promise<string> {
  const templateDir = join(root, name);
  const hexDir = join(templateDir, '.hex');
  await mkdir(hexDir, { recursive: true });
  await writeFile(join(hexDir, 'manifest.yaml'), manifestBody, 'utf8');
  return templateDir;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'hex-discovery-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('discoverTemplates', () => {
  it('returns templates found across configured roots', async () => {
    const r1 = join(workspace, 'r1');
    const r2 = join(workspace, 'r2');
    await mkdir(r1);
    await mkdir(r2);

    await makeTemplate(r1, 'alpha', 'type: component\nname: alpha\nversion: 1.0.0\nkind: cli\n');
    await makeTemplate(r2, 'beta', 'type: recipe\nname: beta\nversion: 0.2.0\n');

    const result = await discoverTemplates({
      sources: [
        { kind: 'path' as const, path: r1 },
        { kind: 'path' as const, path: r2 },
      ],
    });

    expect(result.warnings).toEqual([]);
    expect(result.templates).toHaveLength(2);
    expect(result.templates.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
    expect(result.templates.find((t) => t.name === 'alpha')?.kind).toBe('cli');
  });

  it('skips a malformed manifest with a warning, not an error', async () => {
    const r = join(workspace, 'r');
    await mkdir(r);
    await makeTemplate(r, 'good', 'type: component\nname: good\nversion: 1.0.0\n');
    await makeTemplate(r, 'bad', 'type: component\nname: bad\n'); // missing version

    const result = await discoverTemplates({ sources: [{ kind: 'path', path: r }] });

    expect(result.templates.map((t) => t.name)).toEqual(['good']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/skipped/);
  });

  it('first-root-wins on a name clash, with a warning', async () => {
    const r1 = join(workspace, 'r1');
    const r2 = join(workspace, 'r2');
    await mkdir(r1);
    await mkdir(r2);
    const winner = await makeTemplate(
      r1,
      'shared',
      'type: component\nname: shared\nversion: 1.0.0\n',
    );
    const loser = await makeTemplate(
      r2,
      'shared',
      'type: component\nname: shared\nversion: 2.0.0\n',
    );

    const result = await discoverTemplates({
      sources: [
        { kind: 'path' as const, path: r1 },
        { kind: 'path' as const, path: r2 },
      ],
    });

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.rootPath).toBe(winner);
    expect(result.templates[0]?.version).toBe('1.0.0');
    expect(result.warnings.some((w) => w.includes('duplicate template "shared"'))).toBe(true);
    expect(result.warnings.some((w) => w.includes(loser))).toBe(true);
  });

  it('warns when a configured root does not exist, but keeps going', async () => {
    const r = join(workspace, 'present');
    await mkdir(r);
    await makeTemplate(r, 'a', 'type: component\nname: a\nversion: 0.1.0\n');

    const result = await discoverTemplates({
      sources: [
        { kind: 'path', path: join(workspace, 'missing') },
        { kind: 'path', path: r },
      ],
    });

    expect(result.templates.map((t) => t.name)).toEqual(['a']);
    expect(result.warnings.some((w) => w.includes('source root not found'))).toBe(true);
  });

  it('ignores entries that are not directories or have no .hex/manifest', async () => {
    const r = join(workspace, 'r');
    await mkdir(r);
    await writeFile(join(r, 'README.md'), '# not a template', 'utf8');
    await mkdir(join(r, 'plain-dir'));
    await makeTemplate(r, 'real', 'type: component\nname: real\nversion: 0.1.0\n');

    const result = await discoverTemplates({ sources: [{ kind: 'path', path: r }] });
    expect(result.templates.map((t) => t.name)).toEqual(['real']);
    expect(result.warnings).toEqual([]);
  });

  it('returns an empty result for an empty config', async () => {
    const result = await discoverTemplates({ sources: [] });
    expect(result).toEqual({ templates: [], warnings: [] });
  });
});
