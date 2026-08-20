import {
  HAZARD_TYPES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_DIVES,
  advanceToNextDive,
  allActiveLocked,
  beginDive,
  createState,
  finishGame,
  makeFullDeck,
  resolveDecisionBatch,
  revealNextCard,
  seedGame,
  setDecisionStatus,
  splitTreasure,
  startGame,
  type Decision,
  type GameState,
} from '../src/game/core.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addPlayers(state: GameState, count: number): string[] {
  const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  for (const id of ids) {
    state.players[id] = { id, name: id, connected: true, banked: 0, relicPoints: 0, unbanked: 0, relicsRecovered: 0 };
  }
  return ids;
}

function lockAll(state: GameState, choices: Record<string, Decision>): void {
  for (const id of state.activeDivers) {
    setDecisionStatus(state, id, 'chosen', true);
    setDecisionStatus(state, id, 'locked', true);
  }
  assert(allActiveLocked(state), 'expected all active divers locked');
  resolveDecisionBatch(state, choices);
}

function forceFirstCard(state: GameState, cardId: string): void {
  const index = state.deck.findIndex((card) => card.id === cardId);
  assert(index >= 0, `missing card ${cardId}`);
  const [card] = state.deck.splice(index, 1);
  state.deck.push(card!);
}

function simulateFiveDives(count: number): void {
  const state = createState();
  const ids = addPlayers(state, count);
  startGame(state, ids, 123456);
  for (let dive = 0; dive < TOTAL_DIVES; dive += 1) {
    forceFirstCard(state, 'T8');
    revealNextCard(state);
    lockAll(state, Object.fromEntries(ids.map((id) => [id, 'LEAVE'])) as Record<string, Decision>);
    if (dive < TOTAL_DIVES - 1) advanceToNextDive(state);
  }
  assert(state.phase === 'gameEnd', `${count}-player game should reach gameEnd`);
  assert(state.winners.length === count, 'equal play should produce shared victory');
}

const tests: Array<[string, () => void]> = [
  ['deck has 15 treasure, 15 hazard, 5 relic', () => {
    const deck = makeFullDeck();
    assert(deck.length === 35, 'deck length');
    assert(deck.filter((c) => c.kind === 'treasure').length === 15, 'treasure count');
    assert(deck.filter((c) => c.kind === 'hazard').length === 15, 'hazard count');
    assert(deck.filter((c) => c.kind === 'relic').length === 5, 'relic count');
  }],
  ['11 treasure / 3 = +3 each and path +2', () => {
    const result = splitTreasure(11, 3);
    assert(result.each === 3 && result.remainder === 2, JSON.stringify(result));
  }],
  ['two simultaneous leavers split path but do not take relic', () => {
    const state = createState();
    const ids = addPlayers(state, 3);
    startGame(state, ids, 1);
    state.pathTreasure = 7;
    state.pathRelics = [{ id: 'R1', kind: 'relic' }];
    state.decisions = Object.fromEntries(ids.map((id) => [id, { chosen: true, locked: true }]));
    resolveDecisionBatch(state, { p1: 'LEAVE', p2: 'LEAVE', p3: 'GO' });
    assert(state.players.p1!.banked === 3 && state.players.p2!.banked === 3, 'path split');
    assert(state.pathTreasure === 1, 'remainder should stay');
    assert(state.pathRelics.length === 1, 'relic should remain');
  }],
  ['one leaver can collect multiple relics and global values become 5/10', () => {
    const state = createState();
    const ids = addPlayers(state, 3);
    startGame(state, ids, 2);
    state.recoveredRelicCount = 2;
    state.pathRelics = [{ id: 'R1', kind: 'relic' }, { id: 'R2', kind: 'relic' }, { id: 'R3', kind: 'relic' }];
    state.decisions = Object.fromEntries(ids.map((id) => [id, { chosen: true, locked: true }]));
    resolveDecisionBatch(state, { p1: 'LEAVE', p2: 'GO', p3: 'GO' });
    assert(state.players.p1!.relicPoints === 25, `expected 5+10+10, got ${state.players.p1!.relicPoints}`);
    assert(state.pathRelics.length === 0, 'relics cleared');
  }],
  ['second same hazard crashes before decisions and is permanently removed', () => {
    const state = createState();
    const ids = addPlayers(state, 3);
    startGame(state, ids, 3);
    const type = HAZARD_TYPES[0]!;
    forceFirstCard(state, `H-${type}-1`);
    const first = revealNextCard(state);
    assert(!first.crashed && state.revealedHazards[type] === 1, 'first hazard safe');
    state.decisions = Object.fromEntries(ids.map((id) => [id, { chosen: true, locked: true }]));
    resolveDecisionBatch(state, { p1: 'GO', p2: 'GO', p3: 'GO' });
    forceFirstCard(state, `H-${type}-2`);
    const second = revealNextCard(state);
    assert(second.crashed && state.phase === 'diveEnd', 'second hazard should crash immediately');
    assert(state.removedHazards.includes(`H-${type}-2`), 'triggering hazard removed');
    advanceToNextDive(state);
    assert(!state.deck.some((c) => c.id === `H-${type}-2`), 'removed hazard must not return next dive');
  }],
  ['resolved decision batch cannot resolve twice', () => {
    const state = createState();
    const ids = addPlayers(state, 3);
    startGame(state, ids, 4);
    forceFirstCard(state, 'T1');
    revealNextCard(state);
    lockAll(state, { p1: 'LEAVE', p2: 'LEAVE', p3: 'LEAVE' });
    let threw = false;
    try { resolveDecisionBatch(state, { p1: 'LEAVE', p2: 'LEAVE', p3: 'LEAVE' }); } catch { threw = true; }
    assert(threw, 'duplicate resolution must be rejected');
  }],
  ['tie winners are shared with no hidden tie-break', () => {
    const state = createState();
    const ids = addPlayers(state, 3);
    state.participantIds = ids;
    state.players.p1!.banked = 20;
    state.players.p2!.banked = 20;
    state.players.p3!.banked = 19;
    finishGame(state);
    assert(state.winners.join(',') === 'p1,p2', state.winners.join(','));
  }],
  ['minimum players can finish a game', () => simulateFiveDives(MIN_PLAYERS)],
  ['maximum players can finish a game', () => simulateFiveDives(MAX_PLAYERS)],
  ['seeded shuffle is reproducible', () => {
    const a = createState(); const b = createState();
    addPlayers(a, 3); addPlayers(b, 3);
    seedGame(a, 99); seedGame(b, 99);
    beginDive(a, 0); beginDive(b, 0);
    assert(a.deck.map((c) => c.id).join('|') === b.deck.map((c) => c.id).join('|'), 'same seed should match');
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} core tests passed.`);
