type PartiClient = {
  playerId: string | null;
  getState<T = unknown>(): T | null;
  onState<T = unknown>(handler: (state: T) => void): () => void;
  onEvent<T = unknown>(event: string, handler: (payload: T) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  exposeToAgent(fn: (state: unknown) => unknown): void;
  log(...args: unknown[]): void;
};

interface Window {
  parti: PartiClient;
}
