// Writes out/THIRD-PARTY-LICENSES.txt, the bundled license file About ▸ View licenses opens (18 §1):
// every package the app ships, which is the production dependency tree plus the libraries the renderer
// and main bundles include (dev dependencies by npm's reckoning), each with its license text.
// Run by `npm run build` after electron-vite; `npm run licenses` runs it alone.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** The package a module specifier belongs to, or null for a relative, alias or built-in import. */
function packageOf(specifier: string): string | null {
  if (/^(\.|@shared\/|@renderer\/|node:)/.test(specifier)) return null;
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]) ?? null;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'testing' ? [] : sourceFiles(path);
    return /\.(ts|vue)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

/** The dev dependencies the app's own (non-test) source imports: electron-vite bundles them into out/. */
export function bundledFrom(
  devDependencies: readonly string[],
  sources: readonly string[],
): string[] {
  const dev = new Set(devDependencies);
  const used = new Set<string>();
  for (const text of sources)
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const name = packageOf(m[1] ?? '');
      if (name && dev.has(name)) used.add(name);
    }
  return [...used].sort();
}

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** The lock entry a dependency of `from` resolves to: nested first, then up the tree. */
export function resolve(
  packages: Record<string, LockPackage>,
  from: string,
  name: string,
): string | null {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const at = base.lastIndexOf('/node_modules/');
    base = at === -1 ? '' : base.slice(0, at);
  }
}

/** The lock paths of every shipped package, sorted. */
export function shipped(
  packages: Record<string, LockPackage>,
  bundled: readonly string[],
): string[] {
  const out = new Set<string>();
  const queue: string[] = [];
  for (const [path, p] of Object.entries(packages))
    if (path && !p.dev && path.startsWith('node_modules/')) queue.push(path);
  for (const name of bundled) {
    const path = resolve(packages, '', name);
    if (path) queue.push(path);
  }
  while (queue.length > 0) {
    const path = queue.pop() ?? '';
    if (out.has(path)) continue;
    out.add(path);
    const p = packages[path];
    const deps = { ...p?.dependencies, ...p?.optionalDependencies };
    for (const name of Object.keys(deps)) {
      const dep = resolve(packages, path, name);
      if (dep && !out.has(dep)) queue.push(dep);
    }
  }
  return [...out].sort();
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('node_modules/') + 13);

function licenseText(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  const bundled = bundledFrom(
    Object.keys(pkg.devDependencies ?? {}),
    sourceFiles(join(root, 'src')).map((f) => readFileSync(f, 'utf8')),
  );
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockPackage>;
  };
  const sections = shipped(lock.packages, bundled).flatMap((path) => {
    const p = lock.packages[path];
    if (!p) return [];
    const text = licenseText(join(root, path));
    const header = `${nameOf(path)} ${p.version ?? ''} — ${p.license ?? 'see package'}`;
    return [
      `${header}\n${'-'.repeat(header.length)}\n${text ?? '(No license file in the package.)'}`,
    ];
  });
  const target = join(root, 'out', 'THIRD-PARTY-LICENSES.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `Third-party software in this application\n\n${sections.join('\n\n\n')}\n`,
    'utf8',
  );
  console.log(`third-party-licenses: ${String(sections.length)} packages → ${target}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
