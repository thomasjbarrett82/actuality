// The API host (utility process, 02 §1). Main spawns it with `{userData}` in the environment, talks to it
// over parentPort (the control channel, 02 §4.1), and hands it the renderer's MessagePort (02 §4).
// It is the host's composition root: the logging aspects are woven here (02 §8.5).
import { isDebug, setDebug } from '@shared/aspects/level';
import { describeError, type LogEntry } from '@shared/aspects/log-entry';
import { weaveSteps } from '@shared/aspects/steps';
import { advise, announce, weave } from '@shared/aspects/weave';
import {
  RENDERER_PORT_MESSAGE,
  type MainToHostEvents,
  type MainToHostRequests,
  type SessionRestore,
} from '@shared/rpc/control-api';
import { RpcEndpoint, type Transport } from '@shared/rpc/endpoint';
import type { HostEvents } from '@shared/rpc/host-api';
import type { RpcMessage } from '@shared/rpc/protocol';
import type { MessagePortMain } from 'electron';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRealActual } from './actual';
import {
  apiAspect,
  controlAspect,
  dataWarningAspect,
  httpAspect,
  httpEventAspect,
  lateSettleAspect,
  queueAspect,
  rpcAspect,
  stateAspect,
  stepAspect,
} from './aspects/logging';
import { currentCallId, runWithCallId } from './call-context';
import { Connection, type ControlPort } from './connection';
import { probe } from './diagnose';
import { createHandlers, dispatch } from './dispatch';
import { requestFacts } from './fetch-timeout';
import { setLogSink, write } from './log';
import { startLoopback } from './openid';
import { JobQueue } from './queue';
import {
  loginWithPassword,
  probeLoginMethods,
  requestOpenIdLogin,
  serverVersion,
  validateToken,
} from './server-api';
import { AccountsService } from './services/accounts';
import { BudgetService } from './services/budget';
import { BudgetFileService } from './services/budget-file';
import { CategoriesService } from './services/categories';
import { ExportService } from './services/export';
import { ImportService } from './services/import';
import { MetadataRepository } from './services/metadata';
import { NotesService } from './services/notes';
import { PayeesService } from './services/payees';
import { ReadService } from './services/read';
import { ReconcileService } from './services/reconcile';
import { ReportsService } from './services/reports';
import { RulesService } from './services/rules';
import { SchedulesService } from './services/schedules';
import { SlateWipeService } from './services/slate-wipe';
import { TagsService } from './services/tags';
import { TransactionsService } from './services/transactions';

const userData = process.env['ACTUAL_DESKTOP_USER_DATA'];
if (!userData) throw new Error('ACTUAL_DESKTOP_USER_DATA is not set');
const dataDir = join(userData, 'actual-cache');
mkdirSync(dataDir, { recursive: true });

// Control channel to main. Messages with a port attached carry the renderer's MessagePort instead.
const controlListeners = new Set<(m: unknown) => void>();
/** A renderer port that arrived before the host was ready; attached once it is. */
let earlyPort: MessagePortMain | null = null;
let attachRenderer: (port: MessagePortMain) => void = (port) => {
  earlyPort = port;
};
process.parentPort.on('message', (e) => {
  const port = e.ports[0];
  if (port && (e.data as { event?: string } | null)?.event === RENDERER_PORT_MESSAGE)
    attachRenderer(port);
  else for (const l of controlListeners) l(e.data);
});
const controlTransport: Transport = {
  send: (m: RpcMessage) => {
    process.parentPort.postMessage(m);
  },
  listen: (h) => {
    controlListeners.add(h);
    return () => controlListeners.delete(h);
  },
};
const controlEndpoint = new RpcEndpoint(controlTransport);
setLogSink((entry: LogEntry) => {
  controlEndpoint.emit('log', entry);
});
weaveSteps('host', [stepAspect], currentCallId);
// The debug logging preference (02 §8.3): main sends it after every start and on each change.
controlEndpoint.onEvent((event, payload) => {
  if (event === ('log:level' satisfies keyof MainToHostEvents))
    setDebug((payload as MainToHostEvents['log:level']).debug);
});
const control: ControlPort = {
  call: (method, params) => controlEndpoint.call(method, params) as never,
  notify: (event, payload) => {
    controlEndpoint.emit(event, payload);
  },
};

// Renderer channel. A new port arrives after every host restart or renderer reload.
let renderer: RpcEndpoint | null = null;
const emit = <E extends keyof HostEvents>(event: E, payload: HostEvents[E]): void => {
  renderer?.emit(event, payload);
};

/**
 * The error boundary: logs, then exits so main restarts the host (03 §3, §6.5). Gives the entry a moment
 * to reach main.
 */
function exitForRestart(message: string, data?: Record<string, unknown>): void {
  write('error', message, data);
  setTimeout(() => process.exit(70), 200);
}

process.on('uncaughtException', (e) => {
  exitForRestart('host.uncaughtException', describeError(e, isDebug()));
});
process.on('unhandledRejection', (e) => {
  exitForRestart('host.unhandledRejection', describeError(e, isDebug()));
});

const httpEvent = (
  name: string,
): ((facts: { method: string; path: string; ms?: number }) => void) =>
  announce(name, 'host', [httpEventAspect], currentCallId);

async function start(): Promise<void> {
  const httpSlow = httpEvent('http.slow');
  const httpTimeout = httpEvent('http.timeout');
  const actual = weave(
    await createRealActual({
      fetch: {
        onSlow: ({ timedOut, ...info }) => {
          (timedOut ? httpTimeout : httpSlow)(info);
        },
        onResend: httpEvent('http.resend'),
        outer: (f) =>
          advise(
            f,
            {
              name: 'http.request',
              process: 'host',
              callId: currentCallId,
              facts: ([input, init]) => requestFacts(input, init),
              resultFacts: (r) => ({ status: r.status }),
            },
            [httpAspect],
          ),
      },
    }),
    { process: 'host', callId: currentCallId },
    [apiAspect],
  );
  let connection: Connection | null = null;
  const lateSettle = announce('queue.lateSettle', 'host', [lateSettleAspect]);
  const queue = new JobQueue(
    {
      onTimeout: (_job, fatal) => {
        connection?.onJobTimeout(fatal);
      },
      onLateSettle: (job, ok) => {
        lateSettle({ job: job.label, ok });
      },
      onStuck: (job) => {
        exitForRestart('host.stuck', { job: job.label });
      },
    },
    [queueAspect],
    currentCallId,
  );
  connection = new Connection({
    actual,
    queue,
    control,
    emit,
    dataDir,
    probe,
    login: loginWithPassword,
    probeLogin: probeLoginMethods,
    openIdLogin: requestOpenIdLogin,
    startLoopback: (page) => startLoopback(page),
    validate: validateToken,
    serverVersion,
    // Only after shutdown(): the folder belongs to the API (03 §2).
    removeCache: () => {
      rmSync(dataDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      return Promise.resolve();
    },
    onTransition: announce('conn.state', 'host', [stateAspect], currentCallId),
  });
  const conn = connection;
  const metadata = new MetadataRepository(actual, {
    onInvalidNote: announce('metadata.invalidNote', 'host', [dataWarningAspect]),
  });
  conn.registerStartTask('tag entities', () => metadata.ensureTags());
  const budget = new BudgetService(actual, queue, conn, metadata, undefined, {
    onOtherAdjustments: announce('budget.otherAdjustments', 'host', [dataWarningAspect]),
  });
  conn.registerStartTask('carryover extension', () => budget.extendCarryover(), [
    'zero_budgets',
    'notes',
  ]);
  const accounts = new AccountsService(actual, conn, metadata);
  const read = new ReadService(actual, queue, conn, metadata);
  const budgetFile = new BudgetFileService(actual, queue, conn);
  const handlers = weave(
    createHandlers({
      connection: conn,
      accounts,
      exporter: new ExportService(read, budget, budgetFile),
      reports: new ReportsService(actual, queue, conn),
      reconcile: new ReconcileService(actual, queue, conn),
      importer: new ImportService(actual, queue, conn, metadata),
      budgetFile,
      notes: new NotesService(actual, queue, conn, metadata),
      read,
      transactions: new TransactionsService(actual, queue, conn, metadata),
      payees: new PayeesService(actual, queue, conn, metadata),
      rules: new RulesService(actual, queue, conn),
      categories: new CategoriesService(actual, conn, queue, metadata),
      schedules: new SchedulesService(actual, queue, conn),
      budget,
      slateWipe: new SlateWipeService(actual, queue, conn, accounts),
      tags: new TagsService(actual, queue, conn),
    }),
    { process: 'host', callId: currentCallId, args: ([params]) => params },
    [rpcAspect],
  );

  attachRenderer = (port) => {
    renderer?.close('The renderer reconnected.');
    const listeners = new Set<(m: unknown) => void>();
    port.on('message', (e) => {
      for (const l of listeners) l(e.data);
    });
    port.start();
    const endpoint = new RpcEndpoint({
      send: (m) => {
        port.postMessage(m);
      },
      listen: (h) => {
        listeners.add(h);
        return () => listeners.delete(h);
      },
    });
    endpoint.handle((method, params, id) =>
      runWithCallId(id, () => dispatch(handlers, method, params)),
    );
    renderer = endpoint;
    endpoint.emit('connection:state', conn.state);
  };
  if (earlyPort) attachRenderer(earlyPort);
  earlyPort = null;

  const serveControl = advise(
    async (method: string, params: unknown): Promise<unknown> => {
      switch (method as keyof MainToHostRequests) {
        case 'app:quit':
          await conn.shutdownForQuit();
          return null;
        case 'session:restore':
          await conn.restore(params as SessionRestore);
          return null;
      }
      throw new Error(`Unknown control request ${method}`);
    },
    { name: ([method]) => method, process: 'host' },
    [controlAspect],
  );
  controlEndpoint.handle((method, params) => serveControl(method, params));
  controlEndpoint.onEvent((event) => {
    if (event === ('window:focus' satisfies keyof MainToHostEvents)) conn.onWindowFocus();
  });

  const app = await control.call('settings.getApp', {});
  conn.setServerUrl(app.serverUrl);
  controlEndpoint.emit('host:ready', null);
}

start().catch((e: unknown) => {
  exitForRestart('host.startFailed', describeError(e, isDebug()));
});
