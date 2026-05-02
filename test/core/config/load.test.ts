import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../src/core/config/load.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hex-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns empty sources when the config file is absent', async () => {
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg).toEqual({ sources: [] });
  });

  it('returns empty sources when the config file is empty', async () => {
    await writeFile(join(dir, 'config.yaml'), '', 'utf8');
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg).toEqual({ sources: [] });
  });

  it('parses a config with multiple absolute source roots', async () => {
    await writeFile(
      join(dir, 'config.yaml'),
      'sources:\n  - path: /opt/templates\n  - path: /tmp/templates\n',
      'utf8',
    );
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.sources).toEqual([{ path: '/opt/templates' }, { path: '/tmp/templates' }]);
  });

  it('resolves relative source paths against the config directory', async () => {
    await mkdir(join(dir, 'templates'), { recursive: true });
    await writeFile(join(dir, 'config.yaml'), 'sources:\n  - path: templates\n', 'utf8');
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.sources[0]?.path).toBe(join(dir, 'templates'));
  });

  it('expands ~ in source paths to the home directory', async () => {
    await writeFile(join(dir, 'config.yaml'), 'sources:\n  - path: ~/dev/templates\n', 'utf8');
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.sources[0]?.path).toMatch(/dev\/templates$/);
    expect(cfg.sources[0]?.path).not.toContain('~');
  });

  it('honours HEX_CONFIG_DIR over default ~/.hex', async () => {
    await writeFile(join(dir, 'config.yaml'), 'sources:\n  - path: /x\n', 'utf8');
    const before = process.env.HEX_CONFIG_DIR;
    process.env.HEX_CONFIG_DIR = dir;
    try {
      const cfg = await loadConfig();
      expect(cfg.sources).toEqual([{ path: '/x' }]);
    } finally {
      if (before === undefined) Reflect.deleteProperty(process.env, 'HEX_CONFIG_DIR');
      else process.env.HEX_CONFIG_DIR = before;
    }
  });

  it('throws ConfigError on malformed YAML', async () => {
    await writeFile(join(dir, 'config.yaml'), 'sources: [\n  not-a-mapping\n', 'utf8');
    await expect(loadConfig({ configDir: dir })).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError on schema violation', async () => {
    await writeFile(join(dir, 'config.yaml'), 'sources:\n  - { wrong_field: value }\n', 'utf8');
    await expect(loadConfig({ configDir: dir })).rejects.toThrow(ConfigError);
  });
});
