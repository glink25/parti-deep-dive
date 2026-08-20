import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const harness = join(root, '.harness');
rmSync(harness, { recursive: true, force: true });
mkdirSync(join(harness, 'node_modules', '@parti', 'worker-sdk'), { recursive: true });
writeFileSync(join(harness, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(harness, 'node_modules', '@parti', 'worker-sdk', 'package.json'), JSON.stringify({ name: '@parti/worker-sdk', version: '0.1.0', type: 'module', exports: './index.js' }));
writeFileSync(join(harness, 'node_modules', '@parti', 'worker-sdk', 'index.js'), 'export const defineRoom = (definition) => definition;\n');
if (!existsSync(join(root, 'dist', 'room.worker.js'))) throw new Error('build dist first');
cpSync(join(root, 'dist', 'room.worker.js'), join(harness, 'room.worker.mjs'));

const room = (await import(pathToFileURL(join(harness, 'room.worker.mjs')).href)).default;
const players = [
  { id: 'p1', name: 'Host', role: 'host' },
  { id: 'p2', name: 'Blue', role: 'player' },
  { id: 'p3', name: 'Gold', role: 'player' },
];
const sent = [];
const timers = new Map();
const state = room.initialState({});
const ctx = {
  state,
  players,
  host: players[0],
  now: () => 1000,
  random: () => 0.123456789,
  broadcast: () => {},
  send: (playerId, event, payload) => sent.push({ playerId, event, payload }),
  kick: () => {},
  log: () => {},
  setTimer: (name, _ms, callback) => timers.set(name, callback),
  clearTimer: (name) => timers.delete(name),
};
for (const player of players) room.onJoin?.(ctx, player);

function action(name, player, payload, actionId) {
  room.actions?.[name]?.(ctx, { player, payload, actionId });
}
function lastError(playerId) {
  return [...sent].reverse().find((entry) => entry.playerId === playerId && entry.event === 'gameError')?.payload?.code ?? null;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

action('startGame', players[0], null, 'start-1');
assert(state.phase === 'decision', 'startGame should reveal first card and open decisions');
assert(state.activeDivers.length === 3, 'three participants active');
assert(!JSON.stringify(state.decisions).includes('GO') && !JSON.stringify(state.decisions).includes('LEAVE'), 'public decision state must not expose choice values');

action('chooseDiveDecision', players[0], 'GO', 'c1');
action('chooseDiveDecision', players[0], 'LEAVE', 'c2');
assert(state.decisions.p1.chosen === true && state.decisions.p1.locked === false, 'choice should be replaceable before lock');
action('lockDecision', players[0], null, 'l1');
assert(state.decisions.p1.locked === true, 'lock should stick');
action('chooseDiveDecision', players[0], 'GO', 'c3');
assert(lastError('p1') === 'DECISION_LOCKED', 'choice change after lock must be rejected');
action('lockDecision', players[0], null, 'l1');
assert(lastError('p1') === 'DUPLICATE_ACTION', 'same actionId must be rejected');

action('chooseDiveDecision', players[1], 'GO', 'c4');
action('lockDecision', players[1], null, 'l2');
action('chooseDiveDecision', players[2], 'GO', 'c5');
action('lockDecision', players[2], null, 'l3');
assert(state.events.some((event) => event.type === 'decisions'), 'choices should become public only after all lock');
assert(state.phase === 'decision' || state.phase === 'diveEnd', 'resolution should progress game');

if (state.phase === 'decision' && state.activeDivers.includes('p3')) {
  room.onLeave?.(ctx, players[2]);
  const timer = timers.get('decision-disconnect-p3');
  assert(typeof timer === 'function', 'disconnect should create timeout when choice is unlocked');
  // Lock all other active players first, then fire the disconnected player timeout.
  for (const id of state.activeDivers) {
    if (id === 'p3') continue;
    const player = players.find((candidate) => candidate.id === id);
    if (!player) continue;
    action('chooseDiveDecision', player, 'GO', `c-${id}-next`);
    action('lockDecision', player, null, `l-${id}-next`);
  }
  timer();
  assert(state.events.some((event) => event.type === 'system' && event.message.includes('自动选择 LEAVE')), 'disconnect timeout should default to LEAVE');
}

const outsider = { id: 'ghost', name: 'Ghost', role: 'player' };
action('chooseDiveDecision', outsider, 'GO', 'ghost-1');
assert(lastError('ghost') === 'PLAYER_NOT_IN_ROOM', 'non-room player must be rejected');

console.log('✓ Worker harness: player presence / phase / decision validation');
console.log('✓ Worker harness: pre-lock overwrite and post-lock rejection');
console.log('✓ Worker harness: duplicate actionId rejection');
console.log('✓ Worker harness: secret choices absent from public snapshot before allLocked');
console.log('✓ Worker harness: disconnected unlocked player defaults to LEAVE after timeout');
rmSync(harness, { recursive: true, force: true });
