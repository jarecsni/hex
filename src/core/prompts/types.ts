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

/**
 * Abstraction over the interactive prompt library, so the engine can be
 * tested without a real TTY. Production wires this up to @clack/prompts;
 * tests inject a scripted implementation.
 *
 * Widgets must throw if the user cancels (e.g. ctrl-C) — the engine does
 * not deal with library-specific cancel sentinels.
 */
export interface Prompter {
  text(opts: TextOpts): Promise<string>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  select(opts: SelectOpts): Promise<string>;
  multiselect(opts: MultiSelectOpts): Promise<string[]>;
  password(opts: PasswordOpts): Promise<string>;
}

export class PromptCancelledError extends Error {
  constructor() {
    super('prompt cancelled');
    this.name = 'PromptCancelledError';
  }
}
