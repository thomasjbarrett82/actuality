// Starts the throwaway Actual server for the integration and E2E suites (docker-compose.yml) when the
// settings ask for it and nothing answers there yet. A server that already answers, like CI's or your own, is left alone.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const compose = ['compose', '-f', 'tests/int/docker-compose.yml'];

const docker = (...args: string[]): void => {
  execFileSync('docker', args, { cwd: root, stdio: 'inherit' });
};

/** The compose server is plain HTTP on port 5006 and starts with no password, so it needs bootstrapping. */
function isComposeServer(server: string): boolean {
  const { protocol, hostname, port } = new URL(server);
  return (
    process.env['ACTUAL_TEST_BOOTSTRAP'] === '1' &&
    protocol === 'http:' &&
    port === '5006' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  );
}

async function answers(server: string): Promise<boolean> {
  try {
    await fetch(`${server}/info`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

function engineIsRunning(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Returns how to stop the server when this run started it. Docker itself stays running. */
export async function startTestServer(): Promise<(() => void) | undefined> {
  const server = process.env['ACTUAL_TEST_SERVER_URL'];
  if (!server || !process.env['ACTUAL_TEST_PASSWORD']) return undefined;
  if (!isComposeServer(server) || (await answers(server))) return undefined;
  try {
    if (!engineIsRunning()) docker('desktop', 'start', '--timeout', '300');
    docker(...compose, 'up', '-d', '--wait');
  } catch (cause) {
    throw new Error(
      `Couldn't start the Actual test server at ${server} with Docker. Start Docker and try again, or see tests/int/README.md.`,
      { cause },
    );
  }
  return () => {
    docker(...compose, 'down', '-v');
  };
}
