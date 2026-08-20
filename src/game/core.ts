export const TOTAL_DIVES = 5;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export type Decision = 'GO' | 'LEAVE';
export type HazardType = 'PRESSURE' | 'CURRENT' | 'FRACTURE' | 'DARKNESS' | 'PREDATOR';
export type GamePhase = 'lobby' | 'decision' | 'diveEnd' | 'gameEnd';

export type TreasureCard = { id: string; kind: 'treasure'; value: number };
export type HazardCard = { id: string; kind: 'hazard'; hazard: HazardType };
export type RelicCard = { id: string; kind: 'relic' };
export type ExploreCard = TreasureCard | HazardCard | RelicCard;

export type PlayerState = {
  id: string;
  name: string;
  connected: boolean;
  banked: number;
  relicPoints: number;
  unbanked: number;
  relicsRecovered: number;
};

export type DecisionStatus = { chosen: boolean; locked: boolean };

export type PublicEvent =
  | { seq: number; type: 'seed'; seed: number }
  | { seq: number; type: 'shuffle'; diveIndex: number; cardCount: number; rngState: number }
  | { seq: number; type: 'draw'; diveIndex: number; cardId: string; cardKind: ExploreCard['kind'] }
  | { seq: number; type: 'treasure'; value: number; each: number; remainder: number }
  | { seq: number; type: 'hazard'; hazard: HazardType; count: number; crash: boolean }
  | { seq: number; type: 'relic'; cardId: string }
  | { seq: number; type: 'decisions'; choices: Record<string, Decision> }
  | { seq: number; type: 'leave'; playerIds: string[]; pathShare: number; relicCount: number }
  | { seq: number; type: 'crash'; hazard: HazardType; removedCardId: string }
  | { seq: number; type: 'diveEnd'; diveIndex: number; reason: 'allLeft' | 'crash' | 'deckEmpty' }
  | { seq: number; type: 'gameEnd'; winners: string[]; highScore: number }
  | { seq: number; type: 'system'; message: string };

export type GameState = {
  phase: GamePhase;
  diveIndex: number;
  players: Record<string, PlayerState>;
  participantIds: string[];
  deck: ExploreCard[];
  discard: ExploreCard[];
  removedHazards: string[];
  revealedHazards: Record<HazardType, number>;
  pathTreasure: number;
  pathRelics: RelicCard[];
  activeDivers: string[];
  decisions: Record<string, DecisionStatus>;
  revealedCard: ExploreCard | null;
  lastDiveEndReason: 'allLeft' | 'crash' | 'deckEmpty' | null;
  recoveredRelicCount: number;
  rngSeed: number | null;
  rngState: number;
  eventSeq: number;
  events: PublicEvent[];
  winners: string[];
};

// The source spec fixes the card counts but not the 15 treasure values.
// These are original, deliberately simple values and can be rebalanced without changing rules.
export const TREASURE_VALUES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
export const HAZARD_TYPES: HazardType[] = ['PRESSURE', 'CURRENT', 'FRACTURE', 'DARKNESS', 'PREDATOR'];

export function emptyHazards(): Record<HazardType, number> {
  return { PRESSURE: 0, CURRENT: 0, FRACTURE: 0, DARKNESS: 0, PREDATOR: 0 };
}

export function createState(): GameState {
  return {
    phase: 'lobby',
    diveIndex: -1,
    players: {},
    participantIds: [],
    deck: [],
    discard: [],
    removedHazards: [],
    revealedHazards: emptyHazards(),
    pathTreasure: 0,
    pathRelics: [],
    activeDivers: [],
    decisions: {},
    revealedCard: null,
    lastDiveEndReason: null,
    recoveredRelicCount: 0,
    rngSeed: null,
    rngState: 0,
    eventSeq: 0,
    events: [],
    winners: [],
  };
}

type PublicEventInput = PublicEvent extends infer E ? E extends { seq: number } ? Omit<E, 'seq'> : never : never;

export function addEvent(state: GameState, event: PublicEventInput): void {
  state.eventSeq += 1;
  state.events.push({ ...event, seq: state.eventSeq } as PublicEvent);
  if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
}

export function makeFullDeck(): ExploreCard[] {
  const cards: ExploreCard[] = [];
  TREASURE_VALUES.forEach((value, index) => cards.push({ id: `T${index + 1}`, kind: 'treasure', value }));
  HAZARD_TYPES.forEach((hazard) => {
    for (let i = 1; i <= 3; i += 1) cards.push({ id: `H-${hazard}-${i}`, kind: 'hazard', hazard });
  });
  for (let i = 1; i <= 5; i += 1) cards.push({ id: `R${i}`, kind: 'relic' });
  return cards;
}

export function nextRandom(state: GameState): number {
  let t = (state.rngState += 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function seedGame(state: GameState, seed: number): void {
  const normalized = seed >>> 0;
  state.rngSeed = normalized;
  state.rngState = normalized;
  addEvent(state, { type: 'seed', seed: normalized });
}

export function shuffle<T>(state: GameState, input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

export function splitTreasure(value: number, count: number): { each: number; remainder: number } {
  if (!Number.isInteger(value) || value < 0) throw new Error('treasure value must be a non-negative integer');
  if (!Number.isInteger(count) || count <= 0) throw new Error('count must be positive');
  const each = Math.floor(value / count);
  return { each, remainder: value - each * count };
}

export function startGame(state: GameState, participantIds: string[], seed: number): void {
  if (state.phase !== 'lobby' && state.phase !== 'gameEnd') throw new Error('game cannot start in current phase');
  if (participantIds.length < MIN_PLAYERS || participantIds.length > MAX_PLAYERS) throw new Error('invalid player count');
  state.participantIds = [...participantIds];
  state.removedHazards = [];
  state.recoveredRelicCount = 0;
  state.winners = [];
  for (const id of participantIds) {
    const player = state.players[id];
    if (!player) throw new Error(`missing player ${id}`);
    player.banked = 0;
    player.relicPoints = 0;
    player.unbanked = 0;
    player.relicsRecovered = 0;
  }
  seedGame(state, seed);
  beginDive(state, 0);
}

export function beginDive(state: GameState, diveIndex: number): void {
  if (diveIndex < 0 || diveIndex >= TOTAL_DIVES) throw new Error('invalid dive index');
  state.diveIndex = diveIndex;
  state.pathTreasure = 0;
  state.pathRelics = [];
  state.revealedHazards = emptyHazards();
  state.revealedCard = null;
  state.lastDiveEndReason = null;
  state.activeDivers = [...state.participantIds];
  state.decisions = {};
  for (const id of state.participantIds) {
    const player = state.players[id];
    if (player) player.unbanked = 0;
  }
  const removed = new Set(state.removedHazards);
  state.deck = shuffle(state, makeFullDeck().filter((card) => !removed.has(card.id)));
  state.discard = [];
  state.phase = 'decision';
  addEvent(state, { type: 'shuffle', diveIndex, cardCount: state.deck.length, rngState: state.rngState >>> 0 });
}

export function revealNextCard(state: GameState): { crashed: boolean; ended: boolean } {
  if (state.phase !== 'decision') throw new Error('not in revealable phase');
  if (state.activeDivers.length === 0) throw new Error('no active divers');
  state.decisions = {};
  for (const id of state.activeDivers) state.decisions[id] = { chosen: false, locked: false };

  const card = state.deck.pop();
  if (!card) {
    endDive(state, 'deckEmpty');
    return { crashed: false, ended: true };
  }

  state.revealedCard = card;
  state.discard.push(card);
  addEvent(state, { type: 'draw', diveIndex: state.diveIndex, cardId: card.id, cardKind: card.kind });

  if (card.kind === 'treasure') {
    const { each, remainder } = splitTreasure(card.value, state.activeDivers.length);
    for (const id of state.activeDivers) {
      const player = state.players[id];
      if (player) player.unbanked += each;
    }
    state.pathTreasure += remainder;
    addEvent(state, { type: 'treasure', value: card.value, each, remainder });
    return { crashed: false, ended: false };
  }

  if (card.kind === 'relic') {
    state.pathRelics.push(card);
    addEvent(state, { type: 'relic', cardId: card.id });
    return { crashed: false, ended: false };
  }

  state.revealedHazards[card.hazard] += 1;
  const count = state.revealedHazards[card.hazard];
  const crash = count >= 2;
  addEvent(state, { type: 'hazard', hazard: card.hazard, count, crash });
  if (!crash) return { crashed: false, ended: false };

  for (const id of state.activeDivers) {
    const player = state.players[id];
    if (player) player.unbanked = 0;
  }
  state.removedHazards.push(card.id);
  state.pathTreasure = 0;
  state.pathRelics = [];
  addEvent(state, { type: 'crash', hazard: card.hazard, removedCardId: card.id });
  endDive(state, 'crash');
  return { crashed: true, ended: true };
}

export function setDecisionStatus(state: GameState, playerId: string, field: 'chosen' | 'locked', value: boolean): void {
  if (state.phase !== 'decision') throw new Error('decisions are not open');
  if (!state.activeDivers.includes(playerId)) throw new Error('player is not active');
  const status = state.decisions[playerId];
  if (!status) throw new Error('decision status missing');
  status[field] = value;
}

export function allActiveLocked(state: GameState): boolean {
  return state.activeDivers.length > 0 && state.activeDivers.every((id) => state.decisions[id]?.locked === true);
}

export function resolveDecisionBatch(state: GameState, choices: Record<string, Decision>): void {
  if (state.phase !== 'decision') throw new Error('decisions are not open');
  if (!allActiveLocked(state)) throw new Error('not all players are locked');

  for (const id of state.activeDivers) {
    const choice = choices[id];
    if (choice !== 'GO' && choice !== 'LEAVE') throw new Error(`missing or invalid choice for ${id}`);
  }
  addEvent(state, { type: 'decisions', choices: Object.fromEntries(state.activeDivers.map((id) => [id, choices[id]!])) });

  const leaving = state.activeDivers.filter((id) => choices[id] === 'LEAVE');
  if (leaving.length > 0) {
    const { each: pathShare, remainder } = splitTreasure(state.pathTreasure, leaving.length);
    state.pathTreasure = remainder;
    const relics = leaving.length === 1 ? [...state.pathRelics] : [];
    const singleLeaver = leaving.length === 1 ? leaving[0]! : null;

    for (const id of leaving) {
      const player = state.players[id];
      if (!player) continue;
      player.banked += player.unbanked + pathShare;
      player.unbanked = 0;
    }

    if (singleLeaver && relics.length > 0) {
      const player = state.players[singleLeaver];
      if (player) {
        for (const _relic of relics) {
          const points = state.recoveredRelicCount < 3 ? 5 : 10;
          player.relicPoints += points;
          player.relicsRecovered += 1;
          state.recoveredRelicCount += 1;
        }
      }
      state.pathRelics = [];
    }

    state.activeDivers = state.activeDivers.filter((id) => !leaving.includes(id));
    addEvent(state, { type: 'leave', playerIds: leaving, pathShare, relicCount: relics.length });
  }

  if (state.activeDivers.length === 0) {
    endDive(state, 'allLeft');
  } else {
    state.decisions = {};
  }
}

export function endDive(state: GameState, reason: 'allLeft' | 'crash' | 'deckEmpty'): void {
  state.lastDiveEndReason = reason;
  state.decisions = {};
  addEvent(state, { type: 'diveEnd', diveIndex: state.diveIndex, reason });
  if (state.diveIndex >= TOTAL_DIVES - 1) finishGame(state);
  else state.phase = 'diveEnd';
}

export function advanceToNextDive(state: GameState): void {
  if (state.phase !== 'diveEnd') throw new Error('not between dives');
  beginDive(state, state.diveIndex + 1);
}

export function scoreOf(player: PlayerState): number {
  return player.banked + player.relicPoints;
}

export function finishGame(state: GameState): void {
  let highScore = -1;
  const winners: string[] = [];
  for (const id of state.participantIds) {
    const player = state.players[id];
    if (!player) continue;
    const score = scoreOf(player);
    if (score > highScore) {
      highScore = score;
      winners.splice(0, winners.length, id);
    } else if (score === highScore) {
      winners.push(id);
    }
  }
  state.phase = 'gameEnd';
  state.winners = winners;
  addEvent(state, { type: 'gameEnd', winners: [...winners], highScore: Math.max(0, highScore) });
}
