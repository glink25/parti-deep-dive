import type { Decision, GameState, HazardType, ExploreCard } from '../game/core';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const diveLabel = $('dive-label');
const diveProgress = $('dive-progress');
const phaseKicker = $('phase-kicker');
const revealCard = $('reveal-card');
const cardIcon = $('card-icon');
const cardTitle = $('card-title');
const cardDetail = $('card-detail');
const pathTreasure = $('path-treasure');
const pathRelics = $('path-relics');
const activeCount = $('active-count');
const hazards = $('hazards');
const players = $('players');
const lockCount = $('lock-count');
const myScore = $('my-score');
const myUnbanked = $('my-unbanked');
const statusMessage = $('status-message');
const decisionControls = $('decision-controls');
const hostControls = $('host-controls');
const goBtn = $<HTMLButtonElement>('go-btn');
const leaveBtn = $<HTMLButtonElement>('leave-btn');
const lockBtn = $<HTMLButtonElement>('lock-btn');
const startBtn = $<HTMLButtonElement>('start-btn');
const nextBtn = $<HTMLButtonElement>('next-btn');
const rematchBtn = $<HTMLButtonElement>('rematch-btn');

let state: GameState | null = null;
let selectedDecision: Decision | null = null;
let lastCardId: string | null = null;
let errorText = '';

const hazardLabels: Record<HazardType, string> = {
  PRESSURE: '压力',
  CURRENT: '暗流',
  FRACTURE: '裂谷',
  DARKNESS: '黑障',
  PREDATOR: '猎影',
};

function cardPresentation(card: ExploreCard | null): { icon: string; title: string; detail: string; className: string } {
  if (!card) return { icon: '◌', title: '等待开始', detail: '房主将在 3–8 人到齐后启动本局', className: 'card-empty' };
  if (card.kind === 'treasure') return { icon: '◇', title: `深海晶矿 ${card.value}`, detail: '晶矿会立即按仍在深潜的人数均分', className: 'card-treasure' };
  if (card.kind === 'relic') return { icon: '✦', title: '失落信标', detail: '只有恰好一人撤退时才能带走路径遗物', className: 'card-relic' };
  const count = state?.revealedHazards[card.hazard] ?? 0;
  return {
    icon: count >= 2 ? '⚠' : '△',
    title: `${hazardLabels[card.hazard]} ${count}/2`,
    detail: count >= 2 ? '同类危险再次出现：本次 Dive 立即崩溃' : '同类危险再出现一次就会崩溃',
    className: count >= 2 ? 'card-crash' : 'card-hazard',
  };
}

function phaseText(current: GameState): string {
  if (current.phase === 'lobby') return '等待队伍集结';
  if (current.phase === 'diveEnd') return current.lastDiveEndReason === 'crash' ? 'Dive 崩溃 · 返回母舰' : 'Dive 完成 · 返回母舰';
  if (current.phase === 'gameEnd') return '五次 Dive 已完成';
  return '做出决定，然后锁定';
}

function updateCard(current: GameState): void {
  const presentation = cardPresentation(current.revealedCard);
  revealCard.className = `reveal-card ${presentation.className}`;
  cardIcon.textContent = presentation.icon;
  cardTitle.textContent = presentation.title;
  cardDetail.textContent = presentation.detail;
  if (current.revealedCard?.id && current.revealedCard.id !== lastCardId) {
    revealCard.classList.remove('card-pop');
    void revealCard.offsetWidth;
    revealCard.classList.add('card-pop');
    lastCardId = current.revealedCard.id;
  }
}

function updateHazards(current: GameState): void {
  for (const type of Object.keys(hazardLabels) as HazardType[]) {
    let chip = hazards.querySelector<HTMLElement>(`[data-hazard="${type}"]`);
    if (!chip) {
      chip = document.createElement('span');
      chip.dataset.hazard = type;
      chip.className = 'hazard-chip';
      hazards.append(chip);
    }
    const count = current.revealedHazards[type];
    chip.textContent = `${hazardLabels[type]} ${count}/2`;
    chip.classList.toggle('danger', count >= 1);
  }
}

function updatePlayers(current: GameState): void {
  const wanted = new Set(current.participantIds);
  for (const id of current.participantIds) {
    const player = current.players[id];
    if (!player) continue;
    let row = players.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(id)}"]`);
    if (!row) {
      row = document.createElement('div');
      row.dataset.playerId = id;
      row.className = 'player-row';
      row.innerHTML = '<span class="player-beacon"></span><div class="player-copy"><strong></strong><small></small></div><span class="player-score"></span>';
      players.append(row);
    }
    const active = current.activeDivers.includes(id);
    const decision = current.decisions[id];
    row.classList.toggle('inactive', !active && current.phase === 'decision');
    row.classList.toggle('offline', !player.connected);
    row.querySelector('strong')!.textContent = player.name;
    row.querySelector('small')!.textContent = !player.connected
      ? '断线 · 等待重连'
      : current.phase === 'decision' && active
        ? decision?.locked ? '决定已锁定' : decision?.chosen ? '已选择 · 待锁定' : '正在决定…'
        : active ? '深潜中' : '已返回母舰';
    row.querySelector('.player-score')!.textContent = String(player.banked + player.relicPoints);
  }
  for (const row of [...players.querySelectorAll<HTMLElement>('[data-player-id]')]) {
    if (!wanted.has(row.dataset.playerId ?? '')) row.remove();
  }
}

function updateControls(current: GameState): void {
  const meId = window.parti.playerId;
  const me = meId ? current.players[meId] : undefined;
  const myDecision = meId ? current.decisions[meId] : undefined;
  const isActive = Boolean(meId && current.activeDivers.includes(meId));
  const isHost = Boolean(meId && current.players[meId] && current.participantIds.length >= 0 && current.phase !== 'lobby'
    ? false
    : false);
  // Runtime does not expose host id in the room state; host-only actions are still enforced by Worker.
  // In lobby/intermission we show orchestration buttons to all; non-host clicks get a clear server error.
  const canChoose = current.phase === 'decision' && isActive && !myDecision?.locked;
  decisionControls.classList.toggle('hidden', current.phase !== 'decision' || !isActive);
  goBtn.disabled = !canChoose;
  leaveBtn.disabled = !canChoose;
  lockBtn.disabled = !canChoose || !myDecision?.chosen;
  goBtn.classList.toggle('selected', selectedDecision === 'GO');
  leaveBtn.classList.toggle('selected', selectedDecision === 'LEAVE');
  lockBtn.textContent = myDecision?.locked ? '决定已锁定' : '锁定决定';

  hostControls.classList.toggle('hidden', !['lobby', 'diveEnd', 'gameEnd'].includes(current.phase));
  startBtn.classList.toggle('hidden', current.phase !== 'lobby');
  nextBtn.classList.toggle('hidden', current.phase !== 'diveEnd');
  rematchBtn.classList.toggle('hidden', current.phase !== 'gameEnd');
  startBtn.disabled = Object.values(current.players).filter((p) => p.connected).length < 3;
  void isHost;

  myScore.textContent = String(me ? me.banked + me.relicPoints : 0);
  myUnbanked.textContent = `未入账 ${me?.unbanked ?? 0}${me?.relicPoints ? ` · 遗物分 ${me.relicPoints}` : ''}`;

  if (myDecision?.locked) selectedDecision = null;
}

function updateStatus(current: GameState): void {
  if (errorText) {
    statusMessage.textContent = errorText;
    statusMessage.classList.add('error');
    return;
  }
  statusMessage.classList.remove('error');
  if (current.phase === 'lobby') {
    const ready = Object.values(current.players).filter((p) => p.connected).length;
    statusMessage.textContent = `${ready}/3 最少人数 · 房主可开始`;
  } else if (current.phase === 'decision') {
    const meId = window.parti.playerId;
    const mine = meId ? current.decisions[meId] : undefined;
    statusMessage.textContent = mine?.locked ? '已锁定。等待其他潜水员。' : mine?.chosen ? '选择已保存，可修改；锁定后不可更改。' : '继续深潜，或带着未入账晶矿返回母舰。';
  } else if (current.phase === 'diveEnd') {
    statusMessage.textContent = current.lastDiveEndReason === 'crash' ? '本次 Dive 崩溃。仍在深潜者失去未入账晶矿。' : '本次 Dive 结束。准备下一次下潜。';
  } else {
    const names = current.winners.map((id) => current.players[id]?.name ?? id).join('、');
    statusMessage.textContent = `胜者：${names || '—'}${current.winners.length > 1 ? '（共享胜利）' : ''}`;
  }
}

function render(current: GameState): void {
  state = current;
  diveLabel.textContent = current.diveIndex >= 0 ? `DIVE ${current.diveIndex + 1} / 5` : '等待下潜';
  diveProgress.style.width = `${Math.max(0, ((current.diveIndex + 1) / 5) * 100)}%`;
  phaseKicker.textContent = phaseText(current);
  pathTreasure.textContent = String(current.pathTreasure);
  pathRelics.textContent = String(current.pathRelics.length);
  activeCount.textContent = String(current.activeDivers.length);
  const locked = current.activeDivers.filter((id) => current.decisions[id]?.locked).length;
  lockCount.textContent = `${locked} / ${current.activeDivers.length} 已锁定`;
  updateCard(current);
  updateHazards(current);
  updatePlayers(current);
  updateControls(current);
  updateStatus(current);
}

async function choose(choice: Decision): Promise<void> {
  if (!state) return;
  selectedDecision = choice;
  errorText = '';
  render(state);
  await window.parti.action('chooseDiveDecision', choice);
}

goBtn.addEventListener('click', () => void choose('GO'));
leaveBtn.addEventListener('click', () => void choose('LEAVE'));
lockBtn.addEventListener('click', () => void window.parti.action('lockDecision'));
startBtn.addEventListener('click', () => void window.parti.action('startGame'));
nextBtn.addEventListener('click', () => void window.parti.action('beginNextDive'));
rematchBtn.addEventListener('click', () => void window.parti.action('rematch'));

window.parti.onEvent<{ choice: Decision }>('decisionSelected', ({ choice }) => {
  selectedDecision = choice;
  if (state) render(state);
});
window.parti.onEvent<{ code: string; message: string }>('gameError', ({ code }) => {
  errorText = `操作被拒绝：${code}`;
  if (state) render(state);
  window.setTimeout(() => {
    errorText = '';
    if (state) render(state);
  }, 2400);
});
window.parti.onState<GameState>((next) => {
  errorText = '';
  render(next);
});
window.parti.exposeToAgent((raw) => {
  const current = raw as GameState;
  const id = window.parti.playerId;
  const mine = id ? current.decisions[id] : undefined;
  return {
    game: 'Deep Dive: Sunken Signal',
    phase: current.phase,
    dive: current.diveIndex + 1,
    activeDivers: current.activeDivers,
    pathTreasure: current.pathTreasure,
    pathRelics: current.pathRelics.length,
    yourStatus: mine ?? null,
    actions: current.phase === 'decision' && id && current.activeDivers.includes(id)
      ? mine?.locked ? [] : mine?.chosen ? ['chooseDiveDecision(GO|LEAVE)', 'lockDecision()'] : ['chooseDiveDecision(GO|LEAVE)']
      : [],
  };
});
window.parti.ready();
