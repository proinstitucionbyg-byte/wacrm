import { AsyncLocalStorage } from 'node:async_hooks';
type CommandScope = { accountId: string; conversationId: string; requestId: string };
const scope = new AsyncLocalStorage<Readonly<CommandScope>>();
export function withSessionCommand<T>(value: CommandScope, run: () => T): T { return scope.run(Object.freeze({ ...value }), run); }
export function currentSessionCommand(conversationId: string) { const value = scope.getStore(); return value?.conversationId === conversationId ? value : null; }
