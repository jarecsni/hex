import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookExecutionError, type HookLog, runJsHooks } from '../../../src/core/hooks/runner.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-hook-runner-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function captureLog(): { log: HookLog; entries: Array<{ level: string; msg: string }> } {
  const entries: Array<{ level: string; msg: string }> = [];
  return {
    entries,
    log: {
      info: (msg) => entries.push({ level: 'info', msg }),
      warn: (msg) => entries.push({ level: 'warn', msg }),
      error: (msg) => entries.push({ level: 'error', msg }),
    },
  };
}

describe('runJsHooks', () => {
  it('is a no-op when there are no hooks', async () => {
    await expect(runJsHooks('pre_render', [], {}, work, {})).resolves.toBeUndefined();
  });

  it('executes a pre_render hook and lets it write into the output dir', async () => {
    const sources = { 'prep.js': "project.write('greeting.txt', 'hello-' + answers.name);" };
    await runJsHooks('pre_render', [{ js: 'prep.js' }], sources, work, { name: 'world' });
    expect(await readFile(join(work, 'greeting.txt'), 'utf8')).toBe('hello-world');
  });

  it('surfaces a thrown hook as HookExecutionError naming lifecycle + filename', async () => {
    const sources = { 'boom.js': "throw new Error('exploded')" };
    let thrown: unknown;
    try {
      await runJsHooks('pre_render', [{ js: 'boom.js' }], sources, work, {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HookExecutionError);
    const err = thrown as HookExecutionError;
    expect(err.lifecycle).toBe('pre_render');
    expect(err.hookFilename).toBe('boom.js');
    expect(err.message).toMatch(/pre_render hook "boom.js" failed/);
    expect(err.message).toMatch(/exploded/);
  });

  it('aborts the lifecycle after the first throwing hook (later hooks do not run)', async () => {
    const sources = {
      'first.js': "throw new Error('halt')",
      'second.js': "project.write('should-not-exist.txt', 'present');",
    };
    await expect(
      runJsHooks('pre_render', [{ js: 'first.js' }, { js: 'second.js' }], sources, work, {}),
    ).rejects.toThrow(HookExecutionError);
    await expect(readFile(join(work, 'should-not-exist.txt'), 'utf8')).rejects.toThrow();
  });

  it('skips hooks whose when: expression is falsy', async () => {
    const sources = { 'guarded.js': "project.write('flag.txt', 'on');" };
    await runJsHooks('post_render', [{ js: 'guarded.js', when: 'enabled' }], sources, work, {
      enabled: false,
    });
    await expect(readFile(join(work, 'flag.txt'), 'utf8')).rejects.toThrow();
  });

  it('runs hooks whose when: expression is truthy', async () => {
    const sources = { 'guarded.js': "project.write('flag.txt', 'on');" };
    await runJsHooks('post_render', [{ js: 'guarded.js', when: 'enabled' }], sources, work, {
      enabled: true,
    });
    expect(await readFile(join(work, 'flag.txt'), 'utf8')).toBe('on');
  });

  it('exposes answers as a deeply-readable global', async () => {
    await mkdir(work, { recursive: true });
    const sources = {
      'inspect.js': `project.write('out.json', JSON.stringify({
        name: answers.name,
        nested: answers.deeply.nested,
      }));`,
    };
    await runJsHooks('pre_render', [{ js: 'inspect.js' }], sources, work, {
      name: 'demo',
      deeply: { nested: 42 },
    });
    expect(JSON.parse(await readFile(join(work, 'out.json'), 'utf8'))).toEqual({
      name: 'demo',
      nested: 42,
    });
  });

  it('exposes recipe metadata when supplied, null otherwise', async () => {
    const sources = {
      'r.js':
        "project.write('r.txt', recipe === null ? 'none' : recipe.name + '@' + recipe.version);",
    };
    await runJsHooks('pre_render', [{ js: 'r.js' }], sources, work, {});
    expect(await readFile(join(work, 'r.txt'), 'utf8')).toBe('none');

    const work2 = await mkdtemp(join(tmpdir(), 'hex-hook-runner-r-'));
    try {
      await runJsHooks(
        'pre_render',
        [{ js: 'r.js' }],
        sources,
        work2,
        {},
        {
          recipe: { name: 'node-ts-monorepo', version: '1.2.3' },
        },
      );
      expect(await readFile(join(work2, 'r.txt'), 'utf8')).toBe('node-ts-monorepo@1.2.3');
    } finally {
      await rm(work2, { recursive: true, force: true });
    }
  });

  it('routes log.{info,warn,error} through the injected sink', async () => {
    const sink = captureLog();
    const sources = {
      'noisy.js': "log.info('hi'); log.warn('uh oh'); log.error('boom');",
    };
    await runJsHooks('pre_render', [{ js: 'noisy.js' }], sources, work, {}, { log: sink.log });
    expect(sink.entries).toEqual([
      { level: 'info', msg: 'hi' },
      { level: 'warn', msg: 'uh oh' },
      { level: 'error', msg: 'boom' },
    ]);
  });

  it('errors clearly if a hook references a filename not present in sources', async () => {
    await expect(runJsHooks('pre_render', [{ js: 'ghost.js' }], {}, work, {})).rejects.toThrow(
      /no source loaded/,
    );
  });

  it('rejects a relative-path escape attempt from inside the hook', async () => {
    const sources = { 'escape.js': "project.write('../escape.txt', 'planted');" };
    let thrown: unknown;
    try {
      await runJsHooks('pre_render', [{ js: 'escape.js' }], sources, work, {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HookExecutionError);
    expect((thrown as HookExecutionError).message).toMatch(/escapes project root/);
  });

  it('runs many hooks in declaration order within a single sandbox', async () => {
    const sources = {
      'a.js':
        "project.write('order.txt', (project.exists('order.txt') ? project.read('order.txt') : '') + 'A');",
      'b.js': "project.write('order.txt', project.read('order.txt') + 'B');",
      'c.js': "project.write('order.txt', project.read('order.txt') + 'C');",
    };
    await mkdir(work, { recursive: true });
    await writeFile(join(work, 'order.txt'), '', 'utf8');
    await runJsHooks(
      'post_render',
      [{ js: 'a.js' }, { js: 'b.js' }, { js: 'c.js' }],
      sources,
      work,
      {},
    );
    expect(await readFile(join(work, 'order.txt'), 'utf8')).toBe('ABC');
  });
});
