// `npm run secrets:scan [base] [head]` (02 §5.1): scans the commits from base to head for secrets (API keys,
// tokens, passwords, private keys) with gitleaks. Defaults: origin/main and HEAD. The pre-push hook runs it
// with the defaults. gitleaks is a standalone binary, not an npm package, so it must be on the PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const exists = (ref: string): boolean => {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** True when origin answers and has no main: the repo's first push, so every commit is new. */
function originHasNoMain(): boolean {
  try {
    return git('ls-remote', 'origin', 'refs/heads/main') === '';
  } catch {
    return false;
  }
}

if (spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).error) {
  console.error(
    "secrets:scan: gitleaks isn't installed. Install it (Windows: `winget install Gitleaks.Gitleaks`; " +
      'macOS: `brew install gitleaks`; or a release from https://github.com/gitleaks/gitleaks/releases), ' +
      'then open a new terminal so it is on the PATH.',
  );
  process.exit(1);
}

if (!exists(head)) {
  console.error(`secrets:scan: can't find ${head}.`);
  process.exit(1);
}
let range: string;
if (exists(base)) {
  range = `${base}..${head}`;
} else if (base === 'origin/main' && originHasNoMain()) {
  range = head;
} else {
  console.error(
    `secrets:scan: can't find ${base}. Run \`git fetch\`, or pass the base: npm run secrets:scan -- <base>.`,
  );
  process.exit(1);
}

// --verbose names the commit, file, line and rule of each finding; --redact keeps the secret itself out of
// the terminal and any log that captures it.
const scan = spawnSync(
  'gitleaks',
  ['git', '--no-banner', '--verbose', '--redact', `--log-opts=${range}`, root],
  { stdio: 'inherit' },
);
if (scan.status !== 0) {
  console.error(
    `secrets:scan found possible secrets in ${range} (or gitleaks failed). Remove them from the commits ` +
      'before pushing, and rotate any real credential: it is compromised once committed.',
  );
  process.exit(scan.status ?? 1);
}
console.log(`secrets:scan: ${range} OK.`);
