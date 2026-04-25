export interface TerminalCapabilities {
  unicode: boolean;
  color: boolean;
  isTTY: boolean;
}

export function detectCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const isTTY = Boolean(process.stdout.isTTY);
  const color = isTTY && env.NO_COLOR === undefined && env.TERM !== 'dumb';
  return {
    unicode: detectUnicode(env),
    color,
    isTTY,
  };
}

function detectUnicode(env: NodeJS.ProcessEnv): boolean {
  if (env.HEX_FORCE_ASCII === '1') return false;
  if (env.HEX_FORCE_UNICODE === '1') return true;

  if (process.platform === 'win32') {
    return Boolean(env.WT_SESSION) || env.TERM_PROGRAM === 'vscode' || env.ConEmuTask !== undefined;
  }

  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return /UTF-?8/i.test(locale);
}
