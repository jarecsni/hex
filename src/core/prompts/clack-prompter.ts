import * as clack from '@clack/prompts';
import {
  type ConfirmOpts,
  type MultiSelectOpts,
  type PasswordOpts,
  PromptCancelledError,
  type Prompter,
  type SelectOpts,
  type TextOpts,
} from './types.js';

function ensureNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new PromptCancelledError();
  return value as T;
}

export function createClackPrompter(): Prompter {
  return {
    async text(opts: TextOpts): Promise<string> {
      const validator = opts.validate;
      const result = await clack.text({
        message: opts.message,
        initialValue: opts.default,
        validate: validator ? (v) => validator(v ?? '') : undefined,
      });
      return ensureNotCancelled(result);
    },

    async confirm(opts: ConfirmOpts): Promise<boolean> {
      const result = await clack.confirm({
        message: opts.message,
        initialValue: opts.default,
      });
      return ensureNotCancelled(result);
    },

    async select(opts: SelectOpts): Promise<string> {
      const result = await clack.select({
        message: opts.message,
        options: opts.choices.map((c) => ({ value: c, label: c })),
        initialValue: opts.default,
      });
      return ensureNotCancelled(result);
    },

    async multiselect(opts: MultiSelectOpts): Promise<string[]> {
      const result = await clack.multiselect({
        message: opts.message,
        options: opts.choices.map((c) => ({ value: c, label: c })),
        initialValues: opts.default,
        required: false,
      });
      return ensureNotCancelled(result);
    },

    async password(opts: PasswordOpts): Promise<string> {
      const result = await clack.password({ message: opts.message });
      return ensureNotCancelled(result);
    },
  };
}
