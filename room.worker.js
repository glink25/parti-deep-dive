import { defineRoom } from '@parti/worker-sdk';
const TOTAL_DIVES = 5;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
// The source spec fixes the card counts but not the 15 treasure values.
// These are original, deliberately simple values and can be rebalanced without changing rules.
const TREASURE_VALUES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const HAZARD_TYPES = ['PRESSURE', 'CURRENT', 'FRACTURE', 'DARKNESS', 'PREDATOR'];
function emptyHazards() {
    return { PRESSURE: 0, CURRENT: 0, FRACTURE: 0, DARKNESS: 0, PREDATOR: 0 };
}
function createState() {
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
function addEvent(state, event) {
    state.eventSeq += 1;
    state.events.push({ ...event, seq: state.eventSeq });
    if (state.events.length > 120)
        state.events.splice(0, state.events.length - 120);
}
function makeFullDeck() {
    const cards = [];
    TREASURE_VALUES.forEach((value, index) => cards.push({ id: `T${index + 1}`, kind: 'treasure', value }));
    HAZARD_TYPES.forEach((hazard) => {
        for (let i = 1; i <= 3; i += 1)
            cards.push({ id: `H-${hazard}-${i}`, kind: 'hazard', hazard });
    });
    for (let i = 1; i <= 5; i += 1)
        cards.push({ id: `R${i}`, kind: 'relic' });
    return cards;
}
function nextRandom(state) {
    let t = (state.rngState += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function seedGame(state, seed) {
    const normalized = seed >>> 0;
    state.rngSeed = normalized;
    state.rngState = normalized;
    addEvent(state, { type: 'seed', seed: normalized });
}
function shuffle(state, input) {
    const items = [...input];
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(nextRandom(state) * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
    return items;
}
function splitTreasure(value, count) {
    if (!Number.isInteger(value) || value < 0)
        throw new Error('treasure value must be a non-negative integer');
    if (!Number.isInteger(count) || count <= 0)
        throw new Error('count must be positive');
    const each = Math.floor(value / count);
    return { each, remainder: value - each * count };
}
function startGame(state, participantIds, seed) {
    if (state.phase !== 'lobby' && state.phase !== 'gameEnd')
        throw new Error('game cannot start in current phase');
    if (participantIds.length < MIN_PLAYERS || participantIds.length > MAX_PLAYERS)
        throw new Error('invalid player count');
    state.participantIds = [...participantIds];
    state.removedHazards = [];
    state.recoveredRelicCount = 0;
    state.winners = [];
    for (const id of participantIds) {
        const player = state.players[id];
        if (!player)
            throw new Error(`missing player ${id}`);
        player.banked = 0;
        player.relicPoints = 0;
        player.unbanked = 0;
        player.relicsRecovered = 0;
    }
    seedGame(state, seed);
    beginDive(state, 0);
}
function beginDive(state, diveIndex) {
    if (diveIndex < 0 || diveIndex >= TOTAL_DIVES)
        throw new Error('invalid dive index');
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
        if (player)
            player.unbanked = 0;
    }
    const removed = new Set(state.removedHazards);
    state.deck = shuffle(state, makeFullDeck().filter((card) => !removed.has(card.id)));
    state.discard = [];
    state.phase = 'decision';
    addEvent(state, { type: 'shuffle', diveIndex, cardCount: state.deck.length, rngState: state.rngState >>> 0 });
}
function revealNextCard(state) {
    if (state.phase !== 'decision')
        throw new Error('not in revealable phase');
    if (state.activeDivers.length === 0)
        throw new Error('no active divers');
    state.decisions = {};
    for (const id of state.activeDivers)
        state.decisions[id] = { chosen: false, locked: false };
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
            if (player)
                player.unbanked += each;
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
    if (!crash)
        return { crashed: false, ended: false };
    for (const id of state.activeDivers) {
        const player = state.players[id];
        if (player)
            player.unbanked = 0;
    }
    state.removedHazards.push(card.id);
    state.pathTreasure = 0;
    state.pathRelics = [];
    addEvent(state, { type: 'crash', hazard: card.hazard, removedCardId: card.id });
    endDive(state, 'crash');
    return { crashed: true, ended: true };
}
function setDecisionStatus(state, playerId, field, value) {
    if (state.phase !== 'decision')
        throw new Error('decisions are not open');
    if (!state.activeDivers.includes(playerId))
        throw new Error('player is not active');
    const status = state.decisions[playerId];
    if (!status)
        throw new Error('decision status missing');
    status[field] = value;
}
function allActiveLocked(state) {
    return state.activeDivers.length > 0 && state.activeDivers.every((id) => state.decisions[id]?.locked === true);
}
function resolveDecisionBatch(state, choices) {
    if (state.phase !== 'decision')
        throw new Error('decisions are not open');
    if (!allActiveLocked(state))
        throw new Error('not all players are locked');
    for (const id of state.activeDivers) {
        const choice = choices[id];
        if (choice !== 'GO' && choice !== 'LEAVE')
            throw new Error(`missing or invalid choice for ${id}`);
    }
    addEvent(state, { type: 'decisions', choices: Object.fromEntries(state.activeDivers.map((id) => [id, choices[id]])) });
    const leaving = state.activeDivers.filter((id) => choices[id] === 'LEAVE');
    if (leaving.length > 0) {
        const { each: pathShare, remainder } = splitTreasure(state.pathTreasure, leaving.length);
        state.pathTreasure = remainder;
        const relics = leaving.length === 1 ? [...state.pathRelics] : [];
        const singleLeaver = leaving.length === 1 ? leaving[0] : null;
        for (const id of leaving) {
            const player = state.players[id];
            if (!player)
                continue;
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
    }
    else {
        state.decisions = {};
    }
}
function endDive(state, reason) {
    state.lastDiveEndReason = reason;
    state.decisions = {};
    addEvent(state, { type: 'diveEnd', diveIndex: state.diveIndex, reason });
    if (state.diveIndex >= TOTAL_DIVES - 1)
        finishGame(state);
    else
        state.phase = 'diveEnd';
}
function advanceToNextDive(state) {
    if (state.phase !== 'diveEnd')
        throw new Error('not between dives');
    beginDive(state, state.diveIndex + 1);
}
function scoreOf(player) {
    return player.banked + player.relicPoints;
}
function finishGame(state) {
    let highScore = -1;
    const winners = [];
    for (const id of state.participantIds) {
        const player = state.players[id];
        if (!player)
            continue;
        const score = scoreOf(player);
        if (score > highScore) {
            highScore = score;
            winners.splice(0, winners.length, id);
        }
        else if (score === highScore) {
            winners.push(id);
        }
    }
    state.phase = 'gameEnd';
    state.winners = winners;
    addEvent(state, { type: 'gameEnd', winners: [...winners], highScore: Math.max(0, highScore) });
}


const secretDecisions = new Map();
const processedActionIds = new Set();
function isParticipant(state, playerId) {
    return state.participantIds.includes(playerId);
}
function assertPlayerPresent(ctx, player) {
    if (!ctx.players.some((candidate) => candidate.id === player.id))
        throw new Error('PLAYER_NOT_IN_ROOM');
}
function assertHost(ctx, player) {
    if (ctx.host.id !== player.id)
        throw new Error('HOST_ONLY');
}
function assertActionFresh(actionId) {
    if (processedActionIds.has(actionId))
        throw new Error('DUPLICATE_ACTION');
    processedActionIds.add(actionId);
    if (processedActionIds.size > 500) {
        const first = processedActionIds.values().next().value;
        if (first)
            processedActionIds.delete(first);
    }
}
function sendError(ctx, playerId, code, message) {
    ctx.send(playerId, 'gameError', { code, message });
}
function withAction(handler) {
    return (ctx, event) => {
        try {
            assertPlayerPresent(ctx, event.player);
            assertActionFresh(event.actionId);
            handler(ctx, event.player, event.payload);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            sendError(ctx, event.player.id, message, message);
        }
    };
}
function resetSecretDecisionRound(state) {
    for (const id of [...secretDecisions.keys()]) {
        if (!state.activeDivers.includes(id))
            secretDecisions.delete(id);
    }
    for (const id of state.activeDivers)
        secretDecisions.delete(id);
}
function revealForDecision(ctx) {
    if (ctx.state.phase !== 'decision' || ctx.state.activeDivers.length === 0)
        return;
    resetSecretDecisionRound(ctx.state);
    const result = revealNextCard(ctx.state);
    if (result.ended)
        secretDecisions.clear();
}
function resolveIfReady(ctx) {
    if (!allActiveLocked(ctx.state))
        return;
    const choices = {};
    for (const id of ctx.state.activeDivers) {
        const choice = secretDecisions.get(id);
        if (!choice)
            throw new Error(`SECRET_DECISION_MISSING:${id}`);
        choices[id] = choice;
    }
    resolveDecisionBatch(ctx.state, choices);
    secretDecisions.clear();
    if (ctx.state.phase === 'decision' && ctx.state.activeDivers.length > 0)
        revealForDecision(ctx);
}
function addLobbyPlayer(state, player) {
    if (player.role === 'spectator')
        return;
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
function disconnectedTimerName(playerId) {
    return `decision-disconnect-${playerId}`;
}
export default defineRoom({
    meta: {
        name: 'Deep Dive: Sunken Signal',
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
    },
    initialState() {
        return createState();
    },
    onJoin(ctx, player) {
        if (ctx.state.phase === 'lobby')
            addLobbyPlayer(ctx.state, player);
        else if (ctx.state.players[player.id])
            ctx.state.players[player.id].connected = true;
    },
    onLeave(ctx, player) {
        const tracked = ctx.state.players[player.id];
        if (!tracked)
            return;
        tracked.connected = false;
        if (ctx.state.phase === 'decision' &&
            ctx.state.activeDivers.includes(player.id) &&
            ctx.state.decisions[player.id]?.locked !== true) {
            ctx.setTimer(disconnectedTimerName(player.id), 15_000, () => {
                if (ctx.state.phase !== 'decision' ||
                    !ctx.state.activeDivers.includes(player.id) ||
                    ctx.state.decisions[player.id]?.locked === true ||
                    ctx.state.players[player.id]?.connected === true)
                    return;
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
        if (!tracked)
            return;
        tracked.connected = true;
        tracked.name = player.name;
        ctx.clearTimer(disconnectedTimerName(player.id));
        const choice = secretDecisions.get(player.id);
        if (choice)
            ctx.send(player.id, 'decisionSelected', { choice });
    },
    onRestore(ctx) {
        secretDecisions.clear();
        processedActionIds.clear();
        if (ctx.state.phase === 'decision') {
            for (const id of ctx.state.activeDivers)
                ctx.state.decisions[id] = { chosen: false, locked: false };
            addEvent(ctx.state, { type: 'system', message: '房间从快照恢复：当前未公开选择已安全清空，请重新选择。' });
        }
    },
    actions: {
        startGame: withAction((ctx, player) => {
            assertHost(ctx, player);
            if (ctx.state.phase !== 'lobby')
                throw new Error('INVALID_PHASE');
            const participants = Object.values(ctx.state.players).filter((entry) => entry.connected).map((entry) => entry.id);
            if (participants.length < MIN_PLAYERS || participants.length > MAX_PLAYERS)
                throw new Error('INVALID_PLAYER_COUNT');
            const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
            secretDecisions.clear();
            startGame(ctx.state, participants, seed);
            revealForDecision(ctx);
        }),
        chooseDiveDecision: withAction((ctx, player, payload) => {
            if (ctx.state.phase !== 'decision')
                throw new Error('INVALID_PHASE');
            if (!isParticipant(ctx.state, player.id) || !ctx.state.activeDivers.includes(player.id))
                throw new Error('NOT_ACTIVE_DIVER');
            const status = ctx.state.decisions[player.id];
            if (!status)
                throw new Error('DECISION_NOT_OPEN');
            if (status.locked)
                throw new Error('DECISION_LOCKED');
            const choice = typeof payload === 'string' ? payload : payload?.choice;
            if (choice !== 'GO' && choice !== 'LEAVE')
                throw new Error('INVALID_DECISION');
            secretDecisions.set(player.id, choice);
            setDecisionStatus(ctx.state, player.id, 'chosen', true);
            ctx.send(player.id, 'decisionSelected', { choice });
        }),
        lockDecision: withAction((ctx, player) => {
            if (ctx.state.phase !== 'decision')
                throw new Error('INVALID_PHASE');
            if (!ctx.state.activeDivers.includes(player.id))
                throw new Error('NOT_ACTIVE_DIVER');
            const status = ctx.state.decisions[player.id];
            if (!status?.chosen || !secretDecisions.has(player.id))
                throw new Error('CHOOSE_FIRST');
            if (status.locked)
                throw new Error('DECISION_LOCKED');
            setDecisionStatus(ctx.state, player.id, 'locked', true);
            resolveIfReady(ctx);
        }),
        beginNextDive: withAction((ctx, player) => {
            assertHost(ctx, player);
            if (ctx.state.phase !== 'diveEnd')
                throw new Error('INVALID_PHASE');
            advanceToNextDive(ctx.state);
            revealForDecision(ctx);
        }),
        rematch: withAction((ctx, player) => {
            assertHost(ctx, player);
            if (ctx.state.phase !== 'gameEnd')
                throw new Error('INVALID_PHASE');
            const participants = ctx.state.participantIds.filter((id) => ctx.state.players[id]?.connected === true);
            if (participants.length < MIN_PLAYERS)
                throw new Error('INVALID_PLAYER_COUNT');
            const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
            secretDecisions.clear();
            startGame(ctx.state, participants, seed);
            revealForDecision(ctx);
        }),
    },
});
