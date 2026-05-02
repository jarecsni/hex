import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PKG_NAME = '{{ project_name }}';
const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 2000;

const VERSION = readVersion();

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
};

export async function maybeUpdate(): Promise<void> {
  if (!shouldCheck()) return;

  const latest = await fetchLatestVersion();
  if (!latest || compareVersions(latest, VERSION) <= 0) return;

  console.log(
    `${ANSI.yellow}▲${ANSI.reset} ${PKG_NAME} ${ANSI.bold}${latest}${ANSI.reset} is available — you have ${ANSI.dim}${VERSION}${ANSI.reset}.`,
  );
  const yes = await confirm('Update now?');
  if (!yes) return;

  const ok = await runInstall();
  if (!ok) {
    console.error(`${ANSI.red}Update failed. Continuing with current version.${ANSI.reset}`);
    return;
  }

  // After a successful global install npm has put `${PKG_NAME}` somewhere
  // on PATH. If the user's shell hasn't picked up the new bin yet, the
  // spawn errors out — we surface that rather than silently exiting.
  await relaunch();
}

function shouldCheck(): boolean {
  if (process.env.NO_UPDATE_CHECK === '1') return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string };
      return pkg.version ?? '0.0.0';
    }
    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${REGISTRY}/${PKG_NAME}/latest`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': `${PKG_NAME}/${VERSION}`, accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveQ) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolveQ(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function runInstall(): Promise<boolean> {
  return new Promise((resolveR) => {
    const child = spawn('npm', ['i', '-g', `${PKG_NAME}@latest`], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => resolveR(code === 0));
    child.on('error', () => resolveR(false));
  });
}

function relaunch(): Promise<never> {
  const args = process.argv.slice(2);
  return new Promise<never>((_, reject) => {
    const child = spawn(PKG_NAME, args, { stdio: 'inherit', shell: false });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', reject);
  });
}
