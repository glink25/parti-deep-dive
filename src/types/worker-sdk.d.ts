declare module '@parti/worker-sdk' {
  export interface RoomPlayer {
    id: string;
    name: string;
    role: 'host' | 'player' | 'spectator';
  }

  export interface InitialContext {
    meta?: { name?: string; minPlayers?: number; maxPlayers?: number };
    manifest?: unknown;
  }

  export interface RoomContext<State = unknown> {
    state: State;
    players: RoomPlayer[];
    host: RoomPlayer;
    now(): number;
    random(): number;
    broadcast(event: string, payload?: unknown): void;
    send(playerId: string, event: string, payload?: unknown): void;
    kick(playerId: string, reason?: string): void;
    log(...args: unknown[]): void;
    setTimer(name: string, ms: number, callback: () => void): void;
    clearTimer(name: string): void;
  }

  export type ActionHandler<State = unknown> = (
    ctx: RoomContext<State>,
    event: { player: RoomPlayer; payload: unknown; actionId: string },
  ) => void;

  export interface RoomDefinition<State = unknown> {
    meta?: { name?: string; minPlayers?: number; maxPlayers?: number };
    initialState(ctx: InitialContext): State;
    onCreate?(ctx: RoomContext<State>): void;
    onRestore?(ctx: RoomContext<State>): void;
    onJoin?(ctx: RoomContext<State>, player: RoomPlayer): void;
    onLeave?(ctx: RoomContext<State>, player: RoomPlayer): void;
    onReady?(ctx: RoomContext<State>, player: RoomPlayer): void;
    onReconnect?(ctx: RoomContext<State>, player: RoomPlayer): void;
    actions?: Record<string, ActionHandler<State>>;
  }

  export function defineRoom<State>(definition: RoomDefinition<State>): RoomDefinition<State>;
}
