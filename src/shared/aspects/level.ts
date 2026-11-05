// The log level of this process (02 §8.3): one module-level flag the aspects read. Off (the default)
// means `info` and above; on means `debug` too. Each process has its own copy of this module.

let debug = false;

export function isDebug(): boolean {
  return debug;
}

export function setDebug(on: boolean): void {
  debug = on;
}
