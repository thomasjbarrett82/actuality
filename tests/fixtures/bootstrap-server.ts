/**
 * A fresh CI server has no password yet: set it. Asks first, because newer servers count a refused
 * bootstrap as a failed sign-in, and after 5 of those in 15 minutes they refuse every sign-in.
 */
export async function bootstrapServer(server: string, password: string): Promise<void> {
  if (process.env['ACTUAL_TEST_BOOTSTRAP'] !== '1') return;
  const status = await fetch(`${server}/account/needs-bootstrap`);
  const { data } = (await status.json()) as { data?: { bootstrapped?: boolean } };
  if (data?.bootstrapped) return;
  await fetch(`${server}/account/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}
