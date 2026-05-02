import * as clack from '@clack/prompts';
import { brand } from '../../brand/colors.js';
import {
  type ConfirmOpts,
  type MultiSelectOpts,
  type OutlineEntry,
  type PasswordOpts,
  type ProgressInfo,
  PromptCancelledError,
  type Prompter,
  type SectionInfo,
  type SelectOpts,
  type TextOpts,
} from './types.js';

function ensureNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new PromptCancelledError();
  return value as T;
}

export function createClackPrompter(): Prompter {
  // The engine fires `progress` immediately before the next widget call.
  // We stash it here and decorate the next message with `(N/M)` so the
  // counter rides on clack's existing prompt header — no separate render.
  let pendingProgress: ProgressInfo | null = null;

  const decorate = (msg: string): string => {
    if (!pendingProgress) return msg;
    const { promptIndex, promptTotal } = pendingProgress;
    pendingProgress = null;
    return `${brand.dim(`(${promptIndex}/${promptTotal})`)} ${msg}`;
  };

  return {
    async text(opts: TextOpts): Promise<string> {
      const validator = opts.validate;
      const result = await clack.text({
        message: decorate(opts.message),
        initialValue: opts.default,
        validate: validator ? (v) => validator(v ?? '') : undefined,
      });
      return ensureNotCancelled(result);
    },

    async confirm(opts: ConfirmOpts): Promise<boolean> {
      const result = await clack.confirm({
        message: decorate(opts.message),
        initialValue: opts.default,
      });
      return ensureNotCancelled(result);
    },

    async select(opts: SelectOpts): Promise<string> {
      const result = await clack.select({
        message: decorate(opts.message),
        options: opts.choices.map((c) => ({ value: c, label: c })),
        initialValue: opts.default,
      });
      return ensureNotCancelled(result);
    },

    async multiselect(opts: MultiSelectOpts): Promise<string[]> {
      const result = await clack.multiselect({
        message: decorate(opts.message),
        options: opts.choices.map((c) => ({ value: c, label: c })),
        initialValues: opts.default,
        required: false,
      });
      return ensureNotCancelled(result);
    },

    async password(opts: PasswordOpts): Promise<string> {
      const result = await clack.password({ message: decorate(opts.message) });
      return ensureNotCancelled(result);
    },

    outline(entries: OutlineEntry[]): void {
      const lines = entries.map((entry, i) => {
        const n = entry.promptCount;
        const noun = n === 1 ? 'question' : 'questions';
        return `${i + 1}. ${entry.title} ${brand.dim(`(${n} ${noun})`)}`;
      });
      clack.note(lines.join('\n'), `${entries.length} sections`);
    },

    sectionStart(info: SectionInfo): void {
      clack.log.step(brand.honeyBold(`Section ${info.index} of ${info.total} — ${info.title}`));
    },

    progress(info: ProgressInfo): void {
      pendingProgress = info;
    },
  };
}
