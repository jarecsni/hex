export type Answers = Record<string, unknown>;

export type TextOpts = {
  message: string;
  default?: string;
  validate?: (value: string) => string | undefined;
};

export type ConfirmOpts = {
  message: string;
  default?: boolean;
};

export type SelectOpts = {
  message: string;
  choices: string[];
  default?: string;
};

export type MultiSelectOpts = {
  message: string;
  choices: string[];
  default?: string[];
};

export type PasswordOpts = {
  message: string;
};

export type OutlineEntry = { title: string; promptCount: number };

export type SectionInfo = {
  index: number; // 1-based
  total: number;
  title: string;
  promptCount: number; // total prompts in the section, including when:-skipped
};

export type ProgressInfo = {
  sectionIndex: number; // 1-based
  sectionTotal: number;
  promptIndex: number; // 1-based, counts position within section (skipped prompts retain their slot)
  promptTotal: number;
};

/**
 * Abstraction over the interactive prompt library, so the engine can be
 * tested without a real TTY. Production wires this up to @clack/prompts;
 * tests inject a scripted implementation.
 *
 * Widgets must throw if the user cancels (e.g. ctrl-C) — the engine does
 * not deal with library-specific cancel sentinels.
 *
 * The optional UI hooks (outline / sectionStart / progress / sectionEnd)
 * carry sectioning information for prompters that want to render headers
 * and progress indicators. Implementations can omit them — scripted test
 * prompters do, and the engine treats omitted hooks as no-ops.
 */
export interface Prompter {
  text(opts: TextOpts): Promise<string>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  select(opts: SelectOpts): Promise<string>;
  multiselect(opts: MultiSelectOpts): Promise<string[]>;
  password(opts: PasswordOpts): Promise<string>;
  outline?(entries: OutlineEntry[]): void;
  sectionStart?(info: SectionInfo): void;
  sectionEnd?(info: SectionInfo): void;
  progress?(info: ProgressInfo): void;
  /**
   * Render a free-form note to the user (e.g. a task title + detail block
   * before a follow-up `select`). Optional — implementations may omit it,
   * scripted prompters typically do.
   */
  note?(body: string, title?: string): void;
}

export class PromptCancelledError extends Error {
  constructor() {
    super('prompt cancelled');
    this.name = 'PromptCancelledError';
  }
}
