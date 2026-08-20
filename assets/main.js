const $ = (id) => {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Missing #${id}`);
    return element;
};
const diveLabel = $('dive-label');
const diveProgress = $('dive-progress');
const phaseKicker = $('phase-kicker');
const phasePill = $('phase-pill');
const riskIndicator = $('risk-indicator');
const revealCard = $('reveal-card');
const cardIcon = $('card-icon');
const cardTitle = $('card-title');
const cardDetail = $('card-detail');
const pathTreasure = $('path-treasure');
const pathRelics = $('path-relics');
const activeCount = $('active-count');
const hazards = $('hazards');
const removedHazards = $('removed-hazards');
const eventLog = $('event-log');
const relicTrack = $('relic-track');
const bubbleField = $('bubble-field');
const players = $('players');
const lockCount = $('lock-count');
const myScore = $('my-score');
const myUnbanked = $('my-unbanked');
const statusMessage = $('status-message');
const decisionControls = $('decision-controls');
const hostControls = $('host-controls');
const goBtn = $('go-btn');
const leaveBtn = $('leave-btn');
const lockBtn = $('lock-btn');
const startBtn = $('start-btn');
const nextBtn = $('next-btn');
const rematchBtn = $('rematch-btn');
const rulesBtn = $('rules-btn');
const rulesClose = $('rules-close');
const rulesDialog = $('rules-dialog');
let state = null;
let selectedDecision = null;
let lastCardId = null;
let errorText = '';
const hazardLabels = {
    PRESSURE: '压力',
    CURRENT: '暗流',
    FRACTURE: '裂谷',
    DARKNESS: '黑障',
    PREDATOR: '猎影',
};
const eventLabels = {
    seed: '任务种子已记录',
    shuffle: '探索牌堆已重新洗牌',
    draw: '探测器发现新信号',
    treasure: '深海晶矿完成分配',
    hazard: '危险信号已记录',
    relic: '发现失落信标',
    decisions: '全员决定已揭示',
    leave: '撤退队伍返回母舰',
    crash: '重复危险触发崩溃',
    diveEnd: '本次 Dive 结束',
    gameEnd: '远征结算完成',
    system: '系统记录',
};
function createBubbles() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 24; i += 1) {
        const bubble = document.createElement('span');
        bubble.className = 'bubble';
        const size = 3 + ((i * 7) % 12);
        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;
        bubble.style.left = `${(i * 37) % 100}%`;
        bubble.style.opacity = String(0.16 + ((i * 11) % 30) / 100);
        bubble.style.animationDuration = `${8 + ((i * 13) % 12)}s`;
        bubble.style.animationDelay = `${-((i * 17) % 16)}s`;
        bubble.style.setProperty('--drift', `${-22 + ((i * 19) % 45)}px`);
        fragment.append(bubble);
    }
    bubbleField.replaceChildren(fragment);
}
function cardPresentation(card) {
    if (!card)
        return { icon: '◌', title: '等待开始', detail: '房主将在 3–8 人到齐后启动本局', className: 'card-empty' };
    if (card.kind === 'treasure')
        return { icon: '◇', title: `深海晶矿 ${card.value}`, detail: '晶矿立即按仍在深潜的人数均分，余数留在路径', className: 'card-treasure' };
    if (card.kind === 'relic')
        return { icon: '✦', title: '失落信标', detail: '信标进入路径；只有恰好一人撤退时才能回收', className: 'card-relic' };
    const count = state?.revealedHazards[card.hazard] ?? 0;
    return {
        icon: count >= 2 ? '⚠' : '△',
        title: `${hazardLabels[card.hazard]} ${count}/2`,
        detail: count >= 2 ? '同类危险第二次出现：立即 Crash，本次未入账收益归零' : '危险已标记；同类信号再次出现就会崩溃',
        className: count >= 2 ? 'card-crash' : 'card-hazard',
    };
}
function phaseText(current) {
    if (current.phase === 'lobby')
        return '等待队伍集结';
    if (current.phase === 'diveEnd')
        return current.lastDiveEndReason === 'crash' ? '崩溃后返回母舰' : '本次下潜完成';
    if (current.phase === 'gameEnd')
        return '五次 Dive 已完成';
    return '选择航向并锁定';
}
function phaseName(current) {
    if (current.phase === 'lobby')
        return '集结中';
    if (current.phase === 'decision')
        return '同步决策';
    if (current.phase === 'diveEnd')
        return current.lastDiveEndReason === 'crash' ? '紧急返航' : '整备中';
    return '远征结束';
}
function updateCard(current) {
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
function updateHazards(current) {
    let activeThreats = 0;
    for (const type of Object.keys(hazardLabels)) {
        let chip = hazards.querySelector(`[data-hazard="${type}"]`);
        if (!chip) {
            chip = document.createElement('span');
            chip.dataset.hazard = type;
            chip.className = 'hazard-chip';
            hazards.append(chip);
        }
        const count = current.revealedHazards[type];
        activeThreats += count;
        chip.textContent = `${hazardLabels[type]} ${count}/2`;
        chip.classList.toggle('danger', count >= 1);
    }
    riskIndicator.textContent = activeThreats === 0 ? '低' : activeThreats <= 2 ? '警戒' : '高危';
    riskIndicator.style.color = activeThreats === 0 ? '#9be9d6' : activeThreats <= 2 ? '#f7c96c' : '#ff8290';
    removedHazards.textContent = current.removedHazards.length
        ? `永久移除：${current.removedHazards.map((id) => hazardLabels[id.split('-')[1]] ?? id).join(' · ')}`
        : '尚无危险牌被永久移除';
}
function updatePlayers(current) {
    const wanted = new Set(current.participantIds);
    for (const id of current.participantIds) {
        const player = current.players[id];
        if (!player)
            continue;
        let row = players.querySelector(`[data-player-id="${CSS.escape(id)}"]`);
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
        row.querySelector('strong').textContent = player.name;
        row.querySelector('small').textContent = !player.connected
            ? '断线 · 等待重连'
            : current.phase === 'decision' && active
                ? decision?.locked ? '航向已锁定' : decision?.chosen ? '已选择 · 待确认' : '正在决定…'
                : active ? `深潜中 · 未入账 ${player.unbanked}` : '已返回母舰';
        row.querySelector('.player-score').textContent = String(player.banked + player.relicPoints);
    }
    for (const row of [...players.querySelectorAll('[data-player-id]')]) {
        if (!wanted.has(row.dataset.playerId ?? ''))
            row.remove();
    }
}
function updateRelicTrack(current) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 5; i += 1) {
        const node = document.createElement('span');
        node.className = `relic-node${i < current.recoveredRelicCount ? ' recovered' : ''}`;
        node.textContent = i < current.recoveredRelicCount ? '✦' : i < 3 ? '5' : '10';
        node.title = i < 3 ? '价值 5 分' : '价值 10 分';
        fragment.append(node);
    }
    relicTrack.replaceChildren(fragment);
}
function formatEvent(event, current) {
    if (event.type === 'treasure')
        return `晶矿 ${event.value}：每人 +${event.each}，路径留下 ${event.remainder}`;
    if (event.type === 'hazard')
        return `${hazardLabels[event.hazard]} ${event.count}/2${event.crash ? ' · CRASH' : ''}`;
    if (event.type === 'relic')
        return '失落信标进入路径';
    if (event.type === 'decisions') {
        const summary = Object.entries(event.choices).map(([id, choice]) => `${current.players[id]?.name ?? id}:${choice}`).join(' · ');
        return `航向揭示 · ${summary}`;
    }
    if (event.type === 'leave')
        return `${event.playerIds.length} 人返航 · 路径分成 ${event.pathShare}${event.relicCount ? ` · 回收遗物 ${event.relicCount}` : ''}`;
    if (event.type === 'crash')
        return `${hazardLabels[event.hazard]} 重复 · 下潜崩溃`;
    if (event.type === 'diveEnd')
        return `Dive ${event.diveIndex + 1} 结束 · ${event.reason}`;
    if (event.type === 'gameEnd')
        return `远征结束 · 最高分 ${event.highScore}`;
    if (event.type === 'system')
        return event.message;
    return eventLabels[event.type];
}
function updateEventLog(current) {
    const visible = current.events.filter((event) => !['seed', 'shuffle', 'draw'].includes(event.type)).slice(-4).reverse();
    if (!visible.length) {
        eventLog.innerHTML = '<p>声呐频道静默，等待首个信号…</p>';
        return;
    }
    eventLog.replaceChildren(...visible.map((event) => {
        const line = document.createElement('p');
        line.textContent = formatEvent(event, current);
        return line;
    }));
}
function updateControls(current) {
    const meId = window.parti.playerId;
    const me = meId ? current.players[meId] : undefined;
    const myDecision = meId ? current.decisions[meId] : undefined;
    const isActive = Boolean(meId && current.activeDivers.includes(meId));
    const canChoose = current.phase === 'decision' && isActive && !myDecision?.locked;
    decisionControls.classList.toggle('hidden', current.phase !== 'decision' || !isActive);
    goBtn.disabled = !canChoose;
    leaveBtn.disabled = !canChoose;
    lockBtn.disabled = !canChoose || !myDecision?.chosen;
    goBtn.classList.toggle('selected', selectedDecision === 'GO');
    leaveBtn.classList.toggle('selected', selectedDecision === 'LEAVE');
    const lockSpan = lockBtn.querySelector('span');
    if (lockSpan)
        lockSpan.textContent = myDecision?.locked ? '航向已锁定' : '确认航向';
    hostControls.classList.toggle('hidden', !['lobby', 'diveEnd', 'gameEnd'].includes(current.phase));
    startBtn.classList.toggle('hidden', current.phase !== 'lobby');
    nextBtn.classList.toggle('hidden', current.phase !== 'diveEnd');
    rematchBtn.classList.toggle('hidden', current.phase !== 'gameEnd');
    startBtn.disabled = Object.values(current.players).filter((p) => p.connected).length < 3;
    myScore.textContent = String(me ? me.banked + me.relicPoints : 0);
    myUnbanked.textContent = `未入账 ${me?.unbanked ?? 0}${me?.relicPoints ? ` · 遗物分 ${me.relicPoints}` : ''}`;
    if (myDecision?.locked)
        selectedDecision = null;
}
function updateStatus(current) {
    if (errorText) {
        statusMessage.textContent = errorText;
        statusMessage.classList.add('error');
        return;
    }
    statusMessage.classList.remove('error');
    if (current.phase === 'lobby') {
        const ready = Object.values(current.players).filter((p) => p.connected).length;
        statusMessage.textContent = `${ready}/3 最少人数 · 房主可启动远征`;
    }
    else if (current.phase === 'decision') {
        const meId = window.parti.playerId;
        const mine = meId ? current.decisions[meId] : undefined;
        statusMessage.textContent = mine?.locked ? '航向已锁定，等待其他潜水员。' : mine?.chosen ? '航向已暂存，可修改；确认后不可更改。' : '评估风险：继续深潜，或带着未入账晶矿返航。';
    }
    else if (current.phase === 'diveEnd') {
        statusMessage.textContent = current.lastDiveEndReason === 'crash' ? '本次下潜崩溃。仍在深潜者失去全部未入账收益。' : '本次 Dive 已完成，母舰正在准备下一次投放。';
    }
    else {
        const names = current.winners.map((id) => current.players[id]?.name ?? id).join('、');
        statusMessage.textContent = `远征胜者：${names || '—'}${current.winners.length > 1 ? ' · 共享胜利' : ''}`;
    }
}
function render(current) {
    state = current;
    diveLabel.textContent = current.diveIndex >= 0 ? `DIVE ${current.diveIndex + 1} / 5` : '等待下潜';
    diveProgress.style.width = `${Math.max(0, ((current.diveIndex + 1) / 5) * 100)}%`;
    phasePill.textContent = phaseName(current);
    phaseKicker.textContent = phaseText(current);
    pathTreasure.textContent = String(current.pathTreasure);
    pathRelics.textContent = String(current.pathRelics.length);
    activeCount.textContent = String(current.activeDivers.length);
    const locked = current.activeDivers.filter((id) => current.decisions[id]?.locked).length;
    lockCount.textContent = `${locked} / ${current.activeDivers.length} 已锁定`;
    updateCard(current);
    updateHazards(current);
    updatePlayers(current);
    updateRelicTrack(current);
    updateEventLog(current);
    updateControls(current);
    updateStatus(current);
}
async function choose(choice) {
    if (!state)
        return;
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
rulesBtn.addEventListener('click', () => rulesDialog.showModal());
rulesClose.addEventListener('click', () => rulesDialog.close());
rulesDialog.addEventListener('click', (event) => { if (event.target === rulesDialog)
    rulesDialog.close(); });
window.parti.onEvent('decisionSelected', ({ choice }) => {
    selectedDecision = choice;
    if (state)
        render(state);
});
window.parti.onEvent('gameError', ({ code }) => {
    errorText = `操作被拒绝：${code}`;
    if (state)
        render(state);
    window.setTimeout(() => {
        errorText = '';
        if (state)
            render(state);
    }, 2400);
});
window.parti.onState((next) => {
    errorText = '';
    render(next);
});
window.parti.exposeToAgent((raw) => {
    const current = raw;
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
createBubbles();
window.parti.ready();
export {};
