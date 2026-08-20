import { defineRoom, type RoomContext, type RoomPlayer } from '@parti/worker-sdk';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Decision,
  type GameState,
  addEvent,
  advanceToNextDive,
  allActiveLocked,
  createState,
  revealNextCard,
  resolveDecisionBatch,
  setDecisionStatus,
  startGame,
} from '../game/core';

const secretDecisions = new Map<string, Decision>();
const processedActionIds = new Set<string>();

function isParticipant(state: GameState, playerId: string): boolean {
  return state.participantIds.includes(playerId);
}

function assertPlayerPresent(ctx: RoomContext<GameState>, player: RoomPlayer): void {
  if (!ctx.players.some((candidate) => candidate.id === player.id)) throw new Error('PLAYER_NOT_IN_ROOM');
}

function assertHost(ctx: RoomContext<GameState>, player: RoomPlayer): void {
  if (ctx.host.id !== player.id) throw new Error('HOST_ONLY');
}

function assertActionFresh(actionId: string): void {
  if (processedActionIds.has(actionId)) throw new Error('DUPLICATE_ACTION');
  processedActionIds.add(actionId);
  if (processedActionIds.size > 500) {
    const first = processedActionIds.values().next().value as string | undefined;
    if (first) processedActionIds.delete(first);
  }
}

function sendError(ctx: RoomContext<GameState>, playerId: string, code: string, message: string): void {
  ctx.send(playerId, 'gameError', { code, message });
}

function withAction(
  handler: (ctx: RoomContext<GameState>, player: RoomPlayer, payload: unknown) => void,
): (ctx: RoomContext<GameState>, event: { player: RoomPlayer; payload: unknown; actionId: string }) => void {
  return (ctx, event) => {
    try {
      assertPlayerPresent(ctx, event.player);
      assertActionFresh(event.actionId);
      handler(ctx, event.player, event.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      sendError(ctx, event.player.id, message, message);
    }
  };
}

function resetSecretDecisionRound(state: GameState): void {
  for (const id of [...secretDecisions.keys()]) {
    if (!state.activeDivers.includes(id)) secretDecisions.delete(id);
  }
  for (const id of state.activeDivers) secretDecisions.delete(id);
}

function revealForDecision(ctx: RoomContext<GameState>): void {
  if (ctx.state.phase !== 'decision' || ctx.state.activeDivers.length === 0) return;
  resetSecretDecisionRound(ctx.state);
  const result = revealNextCard(ctx.state);
  if (result.ended) secretDecisions.clear();
}

function resolveIfReady(ctx: RoomContext<GameState>): void {
  if (!allActiveLocked(ctx.state)) return;
  const choices: Record<string, Decision> = {};
  for (const id of ctx.state.activeDivers) {
    const choice = secretDecisions.get(id);
    if (!choice) throw new Error(`SECRET_DECISION_MISSING:${id}`);
    choices[id] = choice;
  }
  resolveDecisionBatch(ctx.state, choices);
  secretDecisions.clear();
  if (ctx.state.phase === 'decision' && ctx.state.activeDivers.length > 0) revealForDecision(ctx);
}

function addLobbyPlayer(state: GameState, player: RoomPlayer): void {
  if (player.role === 'spectator') return;
  const existing = state.players[player.id];
  if (existing) {
    existing.connected = true;
    existing.name = player.name;
    return;
  }
  state.players[player.id] = {
    id: player.id,
    name: player.name,
    connected: true,
    banked: 0,
    relicPoints: 0,
    unbanked: 0,
    relicsRecovered: 0,
  };
}

function disconnectedTimerName(playerId: string): string {
  return `decision-disconnect-${playerId}`;
}

export default defineRoom<GameState>({
  meta: {
    name: 'Deep Dive: Sunken Signal',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  },

  initialState() {
    return createState();
  },

  onJoin(ctx, player) {
    if (ctx.state.phase === 'lobby') addLobbyPlayer(ctx.state, player);
    else if (ctx.state.players[player.id]) ctx.state.players[player.id]!.connected = true;
  },

  onLeave(ctx, player) {
    const tracked = ctx.state.players[player.id];
    if (!tracked) return;
    tracked.connected = false;

    if (
      ctx.state.phase === 'decision' &&
      ctx.state.activeDivers.includes(player.id) &&
      ctx.state.decisions[player.id]?.locked !== true
    ) {
      ctx.setTimer(disconnectedTimerName(player.id), 15_000, () => {
        if (
          ctx.state.phase !== 'decision' ||
          !ctx.state.activeDivers.includes(player.id) ||
          ctx.state.decisions[player.id]?.locked === true ||
          ctx.state.players[player.id]?.connected === true
        ) return;
        secretDecisions.set(player.id, 'LEAVE');
        setDecisionStatus(ctx.state, player.id, 'chosen', true);
        setDecisionStatus(ctx.state, player.id, 'locked', true);
        addEvent(ctx.state, { type: 'system', message: `${tracked.name} 断线超时，自动选择 LEAVE。` });
        resolveIfReady(ctx);
      });
    }
  },

  onReconnect(ctx, player) {
    const tracked = ctx.state.players[player.id];
    if (!tracked) return;
    tracked.connected = true;
    tracked.name = player.name;
    ctx.clearTimer(disconnectedTimerName(player.id));
    const choice = secretDecisions.get(player.id);
    if (choice) ctx.send(player.id, 'decisionSelected', { choice });
  },

  onRestore(ctx) {
    secretDecisions.clear();
    processedActionIds.clear();
    if (ctx.state.phase === 'decision') {
      for (const id of ctx.state.activeDivers) ctx.state.decisions[id] = { chosen: false, locked: false };
      addEvent(ctx.state, { type: 'system', message: '房间从快照恢复：当前未公开选择已安全清空，请重新选择。' });
    }
  },

  actions: {
    startGame: withAction((ctx, player) => {
      assertHost(ctx, player);
      if (ctx.state.phase !== 'lobby') throw new Error('INVALID_PHASE');
      const participants = Object.values(ctx.state.players).filter((entry) => entry.connected).map((entry) => entry.id);
      if (participants.length < MIN_PLAYERS || participants.length > MAX_PLAYERS) throw new Error('INVALID_PLAYER_COUNT');
      const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
      secretDecisions.clear();
      startGame(ctx.state, participants, seed);
      revealForDecision(ctx);
    }),

    chooseDiveDecision: withAction((ctx, player, payload) => {
      if (ctx.state.phase !== 'decision') throw new Error('INVALID_PHASE');
      if (!isParticipant(ctx.state, player.id) || !ctx.state.activeDivers.includes(player.id)) throw new Error('NOT_ACTIVE_DIVER');
      const status = ctx.state.decisions[player.id];
      if (!status) throw new Error('DECISION_NOT_OPEN');
      if (status.locked) throw new Error('DECISION_LOCKED');
      const choice = typeof payload === 'string' ? payload : (payload as { choice?: unknown } | null)?.choice;
      if (choice !== 'GO' && choice !== 'LEAVE') throw new Error('INVALID_DECISION');
      secretDecisions.set(player.id, choice);
      setDecisionStatus(ctx.state, player.id, 'chosen', true);
      ctx.send(player.id, 'decisionSelected', { choice });
    }),

    lockDecision: withAction((ctx, player) => {
      if (ctx.state.phase !== 'decision') throw new Error('INVALID_PHASE');
      if (!ctx.state.activeDivers.includes(player.id)) throw new Error('NOT_ACTIVE_DIVER');
      const status = ctx.state.decisions[player.id];
      if (!status?.chosen || !secretDecisions.has(player.id)) throw new Error('CHOOSE_FIRST');
      if (status.locked) throw new Error('DECISION_LOCKED');
      setDecisionStatus(ctx.state, player.id, 'locked', true);
      resolveIfReady(ctx);
    }),

    beginNextDive: withAction((ctx, player) => {
      assertHost(ctx, player);
      if (ctx.state.phase !== 'diveEnd') throw new Error('INVALID_PHASE');
      advanceToNextDive(ctx.state);
      revealForDecision(ctx);
    }),

    rematch: withAction((ctx, player) => {
      assertHost(ctx, player);
      if (ctx.state.phase !== 'gameEnd') throw new Error('INVALID_PHASE');
      const participants = ctx.state.participantIds.filter((id) => ctx.state.players[id]?.connected === true);
      if (participants.length < MIN_PLAYERS) throw new Error('INVALID_PLAYER_COUNT');
      const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
      secretDecisions.clear();
      startGame(ctx.state, participants, seed);
      revealForDecision(ctx);
    }),
  },
});
