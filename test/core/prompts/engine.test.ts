import { describe, expect, it } from 'vitest';
import type { Prompt } from '../../../src/core/manifest/types.js';
import { runPrompts } from '../../../src/core/prompts/engine.js';
import type {
  ConfirmOpts,
  MultiSelectOpts,
  PasswordOpts,
  Prompter,
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
