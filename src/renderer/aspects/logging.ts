// The renderer's logging aspects (02 §8.2), on the renderer sink. renderer/main.ts weaves them.
import { rpcLogging } from '@shared/aspects/logging';
import { write } from '../log';

/** The host client's calls: `rpc.call` on exit (debug only; the host logs the error, 02 §8.2). */
export const rpcClientAspect = rpcLogging(write, { host: false });
