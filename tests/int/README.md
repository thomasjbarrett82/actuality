# Integration tests

`npm run test:int` runs the API host's services against a real Actual server (`21` §1). The suite creates a throwaway budget on the server, uses it, and deletes it at the end.
Without a server configured, the tests are skipped. `npm run test:e2e` uses the same settings and server, except that its smoke tests need no server.

## Configuration

Set these in the environment, or copy `.env.test.example` (in the repo root) to the git-ignored
`.env.test.local`:

| Variable                 | Meaning                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ACTUAL_TEST_SERVER_URL` | The server, e.g. `https://actual.example.lan:5006`                                                                           |
| `ACTUAL_TEST_PASSWORD`   | Its password. Never commit it.                                                                                               |
| `ACTUAL_TEST_CA_CERT`    | Optional: a PEM file with the CA of a self-signed server certificate. It becomes `NODE_EXTRA_CA_CERTS` for the test workers. |
| `ACTUAL_TEST_BOOTSTRAP`  | `1` sets the password on a fresh server first (CI).                                                                          |

## In CI

`tests/int/docker-compose.yml` starts `actualbudget/actual-server` (the version in `ACTUAL_SERVER_VERSION`:
the minimum supported `26.2.0`, or `latest`) on `http://localhost:5006` before the tests, so they use it
as it is, and the job bootstraps it.

## Running it locally

With `ACTUAL_TEST_SERVER_URL=http://localhost:5006` and `ACTUAL_TEST_BOOTSTRAP=1` in `.env.test.local`,
`npm run test:int` runs against the same server as CI and starts it for you (`test-server.ts`):

- If nothing answers on that URL, it starts the container, first starting Docker Desktop if the Docker engine
  isn't running. It removes the container at the end of the run and leaves Docker running.
- If something already answers there, it uses that and leaves it running. To keep a server between runs,
  start it yourself with `docker compose -f tests/int/docker-compose.yml up -d --wait`.
- Any other URL is yours to run: Docker isn't touched.

Set `ACTUAL_SERVER_VERSION` (in the environment or in `.env.test.local`) to test another image, such as
`latest`. It only applies when the run starts the container itself.

## The server's rate limits

The server allows each client 500 requests per fixed 60 s window, on every route, and answers 429 past
that. The whole suite can make more, so `rate-limit.ts` makes a test file wait for the next window when the
current one has too little left. Setting `NODE_ENV=development` on the server turns this limit off, but the
images can't start that way: it imports a proxy package they don't include.

Newer servers (26.11.0 has it, 26.2.0 doesn't) also allow only 5 failed `/account/login` and
`/account/bootstrap` requests per 15 minutes, and then refuse sign-ins with `too-many-requests`. That's why
`bootstrapServer` asks `/account/needs-bootstrap` before it posts. The count lives in the server's memory:
restart the container to clear it.

## How "server down" is simulated

`network.ts` replaces `globalThis.fetch` before the API loads, so it sits beneath the fetch timeout
wrapper, and switches the `/info` probe with it. While "down", every request fails like a refused
connection. A TCP proxy in front of the server wouldn't work: a proxy changes the host name the
client connects to, and TLS hostname verification then fails for a server with its own certificate.

## NODE_ENV

Vitest sets `NODE_ENV=test`, and `@actual-app/api` behaves differently then: its `scheduleFullSync` runs a
full sync inline inside each mutation instead of 1 s later, and a budget write straight after
`batchBudgetUpdates` never returns. The app's host never runs in that mode, so
`vitest.int.config.ts` sets `NODE_ENV=production` for the test workers.
