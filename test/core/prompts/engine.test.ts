import { describe, expect, it } from 'vitest';
import type { Prompt, Section } from '../../../src/core/manifest/types.js';
import { runPrompts } from '../../../src/core/prompts/engine.js';
import type {
  ConfirmOpts,
  MultiSelectOpts,
  OutlineEntry,
  PasswordOpts,
  ProgressInfo,
  Prompter,
  SectionInfo,
  SelectOpts,
  TextOpts,
} from '../../../src/core/prompts/types.js';

type ScriptedAnswer =
  | { kind: 'text'; value: string }
  | { kind: 'confirm'; value: boolean }
  | { kind: 'select'; value: string }
  | { kind: 'multi'; value: string[] }
  | { kind: 'password'; value: string };

type ScriptedCall = {
  kind: ScriptedAnswer['kind'];
  opts: TextOpts | ConfirmOpts | SelectOpts | MultiSelectOpts | PasswordOpts;
};

function scriptedPrompter(answers: ScriptedAnswer[]): {
  prompter: Prompter;
  calls: ScriptedCall[];
} {
  let i = 0;
  const calls: ScriptedCall[] = [];

  const expectKind = (kind: ScriptedAnswer['kind']): ScriptedAnswer => {
    const a = answers[i++];
    if (!a) throw new Error(`scripted prompter ran out of answers at index ${i - 1}`);
    if (a.kind !== kind) {
      throw new Error(`scripted prompter: expected ${kind} at index ${i - 1}, got ${a.kind}`);
    }
    return a;
  };

  const prompter: Prompter = {
    async text(opts) {
      calls.push({ kind: 'text', opts });
      const a = expectKind('text');
      const value = a.value as string;
      if (opts.validate) {
        const msg = opts.validate(value);
        if (msg !== undefined) throw new Error(`validation failed: ${msg}`);
      }
      return value;
    },
    async confirm(opts) {
      calls.push({ kind: 'confirm', opts });
      return expectKind('confirm').value as boolean;
    },
    async select(opts) {
      calls.push({ kind: 'select', opts });
      return expectKind('select').value as string;
    },
    async multiselect(opts) {
      calls.push({ kind: 'multi', opts });
      return expectKind('multi').value as string[];
    },
    async password(opts) {
      calls.push({ kind: 'password', opts });
      return expectKind('password').value as string;
    },
  };

  return { prompter, calls };
}

describe('runPrompts', () => {
  it('asks each prompt in order and collects answers', async () => {
    const prompts: Prompt[] = [
      { name: 'project_name', def: { type: 'string', required: true } },
      { name: 'port', def: { type: 'integer', default: 3000 } },
      { name: 'containerize', def: { type: 'boolean', default: true } },
    ];
    const { prompter, calls } = scriptedPrompter([
      { kind: 'text', value: 'demo' },
      { kind: 'text', value: '4000' },
      { kind: 'confirm', value: false },
    ]);
    const answers = await runPrompts(prompts, prompter);
    expect(answers).toEqual({ project_name: 'demo', port: 4000, containerize: false });
    expect(calls).toHaveLength(3);
  });

  it('skips a prompt whose when: evaluates false', async () => {
    const prompts: Prompt[] = [
      { name: 'containerize', def: { type: 'boolean', default: true } },
      { name: 'image_tag', def: { type: 'string', default: 'latest', when: 'containerize' } },
    ];
    const { prompter } = scriptedPrompter([{ kind: 'confirm', value: false }]);
    const answers = await runPrompts(prompts, prompter);
    expect(answers).toEqual({ containerize: false });
    expect(answers.image_tag).toBeUndefined();
  });

  it('asks a when:-gated prompt when the condition is true', async () => {
    const prompts: Prompt[] = [
      { name: 'containerize', def: { type: 'boolean', default: true } },
      { name: 'image_tag', def: { type: 'string', default: 'latest', when: 'containerize' } },
    ];
    const { prompter } = scriptedPrompter([
      { kind: 'confirm', value: true },
      { kind: 'text', value: 'v1.2.3' },
    ]);
    const answers = await runPrompts(prompts, prompter);
    expect(answers).toEqual({ containerize: true, image_tag: 'v1.2.3' });
  });

  it('hands the right options to each widget', async () => {
    const prompts: Prompt[] = [
      {
        name: 'license',
        def: {
          type: 'enum',
          choices: ['MIT', 'Apache-2.0'],
          default: 'MIT',
          description: 'License?',
        },
      },
      { name: 'features', def: { type: 'multi', choices: ['a', 'b', 'c'], default: ['a'] } },
      { name: 'token', def: { type: 'password' } },
    ];
    const { prompter, calls } = scriptedPrompter([
      { kind: 'select', value: 'Apache-2.0' },
      { kind: 'multi', value: ['a', 'b'] },
      { kind: 'password', value: 's3cret' },
    ]);
    const answers = await runPrompts(prompts, prompter);
    expect(answers).toEqual({
      license: 'Apache-2.0',
      features: ['a', 'b'],
      token: 's3cret',
    });
    expect(calls[0]?.opts.message).toBe('License?');
    expect((calls[0]?.opts as SelectOpts).choices).toEqual(['MIT', 'Apache-2.0']);
    expect((calls[1]?.opts as MultiSelectOpts).default).toEqual(['a']);
  });

  it('runs validators against text input — required string fails when empty', async () => {
    const prompts: Prompt[] = [{ name: 'project_name', def: { type: 'string', required: true } }];
    const { prompter } = scriptedPrompter([{ kind: 'text', value: '' }]);
    await expect(runPrompts(prompts, prompter)).rejects.toThrow(/value is required/);
  });

  it('runs validators against text input — pattern enforced', async () => {
    const prompts: Prompt[] = [
      { name: 'slug', def: { type: 'string', pattern: '^[a-z]+$', default: 'demo' } },
    ];
    const { prompter } = scriptedPrompter([{ kind: 'text', value: 'NOT-OK' }]);
    await expect(runPrompts(prompts, prompter)).rejects.toThrow(/must match pattern/);
  });

  it('integer prompt — rejects non-integer text', async () => {
    const prompts: Prompt[] = [{ name: 'port', def: { type: 'integer', default: 3000 } }];
    const { prompter } = scriptedPrompter([{ kind: 'text', value: 'abc' }]);
    await expect(runPrompts(prompts, prompter)).rejects.toThrow(/must be an integer/);
  });

  it('integer prompt — enforces min/max', async () => {
    const prompts: Prompt[] = [
      { name: 'port', def: { type: 'integer', default: 3000, min: 1, max: 65535 } },
    ];
    const { prompter } = scriptedPrompter([{ kind: 'text', value: '0' }]);
    await expect(runPrompts(prompts, prompter)).rejects.toThrow(/must be >= 1/);
  });
});

type RecordedEvent =
  | { kind: 'outline'; entries: OutlineEntry[] }
  | { kind: 'sectionStart'; info: SectionInfo }
  | { kind: 'sectionEnd'; info: SectionInfo }
  | { kind: 'progress'; info: ProgressInfo }
  | { kind: 'ask'; name: string };

function recordingPrompter(scripted: ScriptedAnswer[]): {
  prompter: Prompter;
  events: RecordedEvent[];
} {
  const events: RecordedEvent[] = [];
  let cursor = 0;
  const next = (kind: ScriptedAnswer['kind']): ScriptedAnswer => {
    const a = scripted[cursor++];
    if (!a) throw new Error('recording prompter ran out of answers');
    if (a.kind !== kind) throw new Error(`expected ${kind}, got ${a.kind}`);
    return a;
  };
  const prompter: Prompter = {
    async text(opts) {
      events.push({ kind: 'ask', name: opts.message });
      return (next('text') as { kind: 'text'; value: string }).value;
    },
    async confirm(opts) {
      events.push({ kind: 'ask', name: opts.message });
      return (next('confirm') as { kind: 'confirm'; value: boolean }).value;
    },
    async select(opts) {
      events.push({ kind: 'ask', name: opts.message });
      return (next('select') as { kind: 'select'; value: string }).value;
    },
    async multiselect(opts) {
      events.push({ kind: 'ask', name: opts.message });
      return (next('multi') as { kind: 'multi'; value: string[] }).value;
    },
    async password(opts) {
      events.push({ kind: 'ask', name: opts.message });
      return (next('password') as { kind: 'password'; value: string }).value;
    },
    outline(entries) {
      events.push({ kind: 'outline', entries });
    },
    sectionStart(info) {
      events.push({ kind: 'sectionStart', info });
    },
    sectionEnd(info) {
      events.push({ kind: 'sectionEnd', info });
    },
    progress(info) {
      events.push({ kind: 'progress', info });
    },
  };
  return { prompter, events };
}

describe('runPrompts — sections', () => {
  it('emits outline + section markers + progress when sections are declared', async () => {
    const prompts: Prompt[] = [
      { name: 'name', def: { type: 'string', default: 'demo' } },
      { name: 'port', def: { type: 'integer', default: 3000 } },
      { name: 'license', def: { type: 'enum', choices: ['MIT'], default: 'MIT' } },
    ];
    const sections: Section[] = [
      { title: 'Basics', prompts: ['name', 'port'] },
      { title: 'Licence', prompts: ['license'] },
    ];
    const { prompter, events } = recordingPrompter([
      { kind: 'text', value: 'demo' },
      { kind: 'text', value: '3000' },
      { kind: 'select', value: 'MIT' },
    ]);
    await runPrompts(prompts, prompter, {}, sections);

    const outline = events.find((e) => e.kind === 'outline') as
      | { kind: 'outline'; entries: OutlineEntry[] }
      | undefined;
    expect(outline?.entries).toEqual([
      { title: 'Basics', promptCount: 2 },
      { title: 'Licence', promptCount: 1 },
    ]);

    const starts = events.filter((e) => e.kind === 'sectionStart');
    expect(starts).toHaveLength(2);
    const firstStart = starts[0] as { kind: 'sectionStart'; info: SectionInfo };
    expect(firstStart.info).toMatchObject({ index: 1, total: 2, title: 'Basics' });

    const progress = events.filter((e) => e.kind === 'progress') as Array<{
      kind: 'progress';
      info: ProgressInfo;
    }>;
    expect(progress).toHaveLength(3);
    expect(progress[0]?.info).toMatchObject({
      sectionIndex: 1,
      sectionTotal: 2,
      promptIndex: 1,
      promptTotal: 2,
    });
    expect(progress[2]?.info).toMatchObject({
      sectionIndex: 2,
      sectionTotal: 2,
      promptIndex: 1,
      promptTotal: 1,
    });
  });

  it('skips a section whose every prompt is when:-skipped — no header, no progress', async () => {
    const prompts: Prompt[] = [
      { name: 'enable_db', def: { type: 'boolean', default: false } },
      { name: 'db_host', def: { type: 'string', default: 'localhost', when: 'enable_db' } },
      { name: 'db_port', def: { type: 'integer', default: 5432, when: 'enable_db' } },
    ];
    const sections: Section[] = [
      { title: 'Main', prompts: ['enable_db'] },
      { title: 'Database', prompts: ['db_host', 'db_port'] },
    ];
    const { prompter, events } = recordingPrompter([{ kind: 'confirm', value: false }]);
    await runPrompts(prompts, prompter, {}, sections);

    const starts = events.filter((e) => e.kind === 'sectionStart') as Array<{
      kind: 'sectionStart';
      info: SectionInfo;
    }>;
    expect(starts).toHaveLength(1);
    expect(starts[0]?.info.title).toBe('Main');

    // No progress event for the skipped section
    const progress = events.filter((e) => e.kind === 'progress');
    expect(progress).toHaveLength(1);
  });

  it('promptIndex stays stable when a same-section prompt is when:-skipped', async () => {
    const prompts: Prompt[] = [
      { name: 'use_jwt', def: { type: 'boolean', default: true } },
      { name: 'jwt_secret', def: { type: 'string', default: 'shh', when: 'use_jwt' } },
      { name: 'audience', def: { type: 'string', default: 'web' } },
    ];
    const sections: Section[] = [{ title: 'Auth', prompts: ['use_jwt', 'jwt_secret', 'audience'] }];
    const { prompter, events } = recordingPrompter([
      { kind: 'confirm', value: false },
      { kind: 'text', value: 'web' },
    ]);
    await runPrompts(prompts, prompter, {}, sections);

    const progress = events.filter((e) => e.kind === 'progress') as Array<{
      kind: 'progress';
      info: ProgressInfo;
    }>;
    expect(progress).toHaveLength(2);
    // First fires at slot 1 of 3; jwt_secret skipped; audience fires at slot 3 of 3.
    expect(progress[0]?.info).toMatchObject({ promptIndex: 1, promptTotal: 3 });
    expect(progress[1]?.info).toMatchObject({ promptIndex: 3, promptTotal: 3 });
  });

  it('emits no outline / no section markers for a flat manifest (no sections)', async () => {
    const prompts: Prompt[] = [{ name: 'x', def: { type: 'string', default: 'hi' } }];
    const { prompter, events } = recordingPrompter([{ kind: 'text', value: 'hi' }]);
    await runPrompts(prompts, prompter);
    expect(events.some((e) => e.kind === 'outline')).toBe(false);
    expect(events.some((e) => e.kind === 'sectionStart')).toBe(false);
    expect(events.some((e) => e.kind === 'progress')).toBe(false);
  });
});
