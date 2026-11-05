// The central command dispatcher (06 §4): native menu clicks and in-app shortcuts run the same commands.
// Screens register the commands they implement while mounted; a command with no handler does nothing.
import type { MenuCommand } from '@shared/shell-api';

export type CommandId = MenuCommand | `dev.${string}`;
type Handler = () => void | Promise<void>;

export class CommandDispatcher {
  private readonly handlers = new Map<CommandId, Handler[]>();

  /** Registers a handler; the latest registration wins until it's removed. */
  register(id: CommandId, handler: Handler): () => void {
    const list = this.handlers.get(id) ?? [];
    list.push(handler);
    this.handlers.set(id, list);
    return () => {
      const i = list.indexOf(handler);
      if (i !== -1) list.splice(i, 1);
    };
  }

  has(id: CommandId): boolean {
    return (this.handlers.get(id)?.length ?? 0) > 0;
  }

  async run(id: CommandId): Promise<boolean> {
    const handler = this.handlers.get(id)?.at(-1);
    if (!handler) return false;
    await handler();
    return true;
  }
}

export const commands = new CommandDispatcher();
