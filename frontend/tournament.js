import './version.js';
import './lineRedirect.js';
import { db, ref, onValue, set, update, push, increment } from './firebase.js';
import { BadmintonEngine } from './badmintonEngine.js';
import { calculateRankedPoints } from './rankedScore.js';

// 本地玩家身分
const uid = localStorage.getItem('wbc_uid') || ('user_' + Math.floor(Math.random() * 1000000));
const nickname = localStorage.getItem('wbc_nickname') || '婚禮嘉賓';
localStorage.setItem('wbc_uid', uid);
localStorage.setItem('wbc_nickname', nickname);

let myPoints = Number(localStorage.getItem('wbc_points')) || 0;

// 取得自身積分
onValue(ref(db, 'players/' + uid), snap => {
  const d = snap.val();
  if (d && d.points !== undefined) {
    myPoints = d.points;
    localStorage.setItem('wbc_points', myPoints);
  }
});

// DOM 元素
const lobbyView = document.getElementById('lobby-view');
const arenaView = document.getElementById('arena-view');
const roomStatusBadge = document.getElementById('room-status-badge');
const seatCountEl = document.getElementById('seat-count');

const btnStart = document.getElementById('btn-start-tournament');
const btnShuffle = document.getElementById('btn-shuffle-slots');
const btnFillAi = document.getElementById('btn-fill-ai');
const btnReset = document.getElementById('btn-reset-bracket');
const btnExitArena = document.getElementById('btn-exit-arena');

const arenaHudTitle = document.getElementById('arena-stage-title');
const arenaP1Name = document.getElementById('arena-p1-name');
const arenaP2Name = document.getElementById('arena-p2-name');
const arenaP1Score = document.getElementById('arena-p1-score');
const arenaP2Score = document.getElementById('arena-p2-score');
const arenaControls = document.getElementById('arena-controls');
const spectatorBar = document.getElementById('spectator-bar');

const arenaModal = document.getElementById('arena-modal');
const arenaModalIcon = document.getElementById('arena-modal-icon');
const arenaModalTitle = document.getElementById('arena-modal-title');
const arenaModalDesc = document.getElementById('arena-modal-desc');
const arenaModalBtn = document.getElementById('arena-modal-btn');

// 預設電腦選手名冊 (純段位命名)
const AI_NAMES = [
  '🥉【青銅初階】AI', '🥉【青銅先鋒】AI',
  '🥈【白銀好手】AI', '🥈【白銀菁英】AI',
  '🥇【黃金專家】AI', '🥇【黃金大師】AI',
  '💎【璀璨鑽石】AI', '👑【最強王者】新娘 KAY'
];

// Firebase 錦標賽房間節點
const roomRef = ref(db, 'tournamentRoom');
const cheersRef = ref(db, 'tournamentRoom/cheers');

let currentRoomData = null;
let gameEngine = null;

// 初始化房間監聽
onValue(roomRef, snap => {
  const data = snap.val();
  if (!data) {
    // 若無房間，初始化新房間
    initializeNewRoom();
    return;
  }
  currentRoomData = data;
  renderBracketUI(data);
  handleRoomStateSync(data);
});

// 初始化新房間資料
function initializeNewRoom() {
  const initialRoom = {
    status: 'waiting', // 'waiting' | 'playing' | 'finished'
    slots: [null, null, null, null],
    currentMatchIndex: 0, // 0 = 準決賽1, 1 = 準決賽2, 2 = 總決賽
    sf1Winner: null,
    sf2Winner: null,
    champion: null,
    updatedAt: Date.now()
  };
  set(roomRef, initialRoom);
}

// 渲染 4 強對陣表 (Bracket)
function renderBracketUI(room) {
  const slots = room.slots || [null, null, null, null];
  let occupiedCount = 0;

  for (let i = 0; i < 4; i++) {
    const slotEl = document.getElementById(`slot-${i}`);
    const slotData = slots[i];

    if (slotData) {
      occupiedCount++;
      slotEl.className = 'slot-card occupied';
      if (slotData.id === uid) slotEl.classList.add('is-me');
      if (slotData.isAi) slotEl.classList.add('is-ai');

      slotEl.innerHTML = `
        <div class="slot-num">席位 ${i + 1}</div>
        <div class="slot-name">${slotData.name}</div>
        <div class="slot-pts">${slotData.points || 0} pts</div>
      `;
      slotEl.onclick = null;
    } else {
      slotEl.className = 'slot-card';
      slotEl.innerHTML = `
        <div class="slot-num">席位 ${i + 1}</div>
        <div class="slot-name" style="color:var(--text-secondary);">+ 點擊入座</div>
        <div class="slot-pts"></div>
      `;
      slotEl.onclick = () => joinSlot(i);
    }
  }

  seatCountEl.textContent = `${occupiedCount} / 4 位選手`;

  if (room.status === 'playing') {
    roomStatusBadge.textContent = '🔥 錦標賽激戰中...';
    roomStatusBadge.style.color = '#ef4444';
  } else if (occupiedCount === 4) {
    roomStatusBadge.textContent = '✅ 人數已滿，隨時可開賽！';
    roomStatusBadge.style.color = '#22c55e';
  } else {
    roomStatusBadge.textContent = '等待選手加入...';
    roomStatusBadge.style.color = '#f59e0b';
  }
}

// 點擊入座
function joinSlot(slotIndex) {
  if (!currentRoomData) return;
  const slots = currentRoomData.slots ? [...currentRoomData.slots] : [null, null, null, null];

  // 若已在其他席位，先移除
  for (let i = 0; i < 4; i++) {
    if (slots[i] && slots[i].id === uid) {
      slots[i] = null;
    }
  }

  slots[slotIndex] = {
    id: uid,
    name: '👦 ' + nickname,
    points: myPoints,
    isAi: false
  };

  update(roomRef, { slots, updatedAt: Date.now() });
}

// 隨機抽籤擺位 (Shuffle)
btnShuffle.addEventListener('click', () => {
  if (!currentRoomData || !currentRoomData.slots) return;
  const occupied = currentRoomData.slots.filter(Boolean);
  if (occupied.length < 2) {
    alert('至少需要 2 位選手才能進行隨機抽籤排位！');
    return;
  }

  // 洗牌演算法
  for (let i = occupied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [occupied[i], occupied[j]] = [occupied[j], occupied[i]];
  }

  const newSlots = [null, null, null, null];
  for (let i = 0; i < occupied.length; i++) {
    newSlots[i] = occupied[i];
  }

  update(roomRef, { slots: newSlots, updatedAt: Date.now() });
});

// 一鍵補滿電腦 AI
btnFillAi.addEventListener('click', () => {
  if (!currentRoomData) return;
  const slots = currentRoomData.slots ? [...currentRoomData.slots] : [null, null, null, null];

  let aiIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (!slots[i]) {
      const aiName = AI_NAMES[aiIdx % AI_NAMES.length];
      slots[i] = {
        id: 'ai_' + (i + 1),
        name: aiName,
        points: Math.floor(Math.random() * 15) + 3,
        isAi: true
      };
      aiIdx++;
    }
  }

  update(roomRef, { slots, updatedAt: Date.now() });
});

// 清空重置房間
btnReset.addEventListener('click', () => {
  if (confirm('確定要清空席位並重設錦標賽房間嗎？')) {
    initializeNewRoom();
  }
});

// 開始錦標賽
btnStart.addEventListener('click', () => {
  if (!currentRoomData || !currentRoomData.slots) return;
  const occupied = currentRoomData.slots.filter(Boolean);
  if (occupied.length < 4) {
    alert('需要滿 4 位選手才能開始錦標賽！請點擊「一鍵補滿電腦 AI」或等待朋友加入。');
    return;
  }

  update(roomRef, {
    status: 'playing',
    currentMatchIndex: 0,
    sf1Winner: null,
    sf2Winner: null,
    champion: null,
    updatedAt: Date.now()
  });
});

// 退出比賽畫面
btnExitArena.addEventListener('click', () => {
  if (gameEngine) gameEngine.stop();
  arenaView.style.display = 'none';
  lobbyView.style.display = 'block';
});

// ─── 比賽與觀戰處理 ───
function handleRoomStateSync(room) {
  if (room.status !== 'playing') {
    arenaView.style.display = 'none';
    lobbyView.style.display = 'block';
    if (gameEngine) gameEngine.stop();
    return;
  }

  // 進入對戰/觀戰畫面
  lobbyView.style.display = 'none';
  arenaView.style.display = 'block';

  const matchIdx = room.currentMatchIndex || 0;
  let p1, p2, stageTitle;

  if (matchIdx === 0) {
    p1 = room.slots[0];
    p2 = room.slots[1];
    stageTitle = '準決賽 第 1 場 (SF 1)';
  } else if (matchIdx === 1) {
    p1 = room.slots[2];
    p2 = room.slots[3];
    stageTitle = '準決賽 第 2 場 (SF 2)';
  } else {
    p1 = room.sf1Winner;
    p2 = room.sf2Winner;
    stageTitle = '👑 婚禮總決賽 (GRAND FINALS)';
  }

  if (!p1 || !p2) return;

  arenaHudTitle.textContent = stageTitle;
  arenaP1Name.textContent = p1.name;
  arenaP2Name.textContent = p2.name;

  // 判斷我是參賽者還是觀戰者
  const isP1 = (p1.id === uid);
  const isP2 = (p2.id === uid);
  const isPlayer = isP1 || isP2;

  if (isPlayer) {
    arenaControls.style.display = 'flex';
    spectatorBar.style.display = 'none';
  } else {
    arenaControls.style.display = 'none';
    spectatorBar.style.display = 'flex';
  }

  startMatchSimulation(p1, p2, isP1, isP2, matchIdx);
}

// 啟動球賽模擬與控制
function startMatchSimulation(p1, p2, isP1, isP2, matchIdx) {
  if (!gameEngine) {
    gameEngine = new BadmintonEngine('game-canvas');
    bindMobileControls();
  }

  arenaModal.style.display = 'none';
  arenaP1Score.innerText = '0';
  arenaP2Score.innerText = '0';

  gameEngine.onScoreUpdate = (s1, s2) => {
    arenaP1Score.innerText = s1;
    arenaP2Score.innerText = s2;
  };

  gameEngine.onGameOver = (p1Won) => {
    const winner = p1Won ? p1 : p2;
    const loser = p1Won ? p2 : p1;

    // 計算積分賽加扣分
    const scoreResult = calculateRankedPoints(winner.points || 0, loser.points || 0);

    // 更新個人積分
    if (winner.id === uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.winnerDelta),
        wins: increment(1)
      });
    } else if (loser.id === uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.loserDelta)
      });
    }

    showMatchResultModal(winner, loser, scoreResult, matchIdx);
  };

  // 難度配置 (決賽魔王級難度)
  const boldness = matchIdx === 2 ? 8 : 5;
  gameEngine.start(5, boldness);
}

// 手遊控制綁定 (實體鍵盤風格按鍵 ＋ 右手【跳躍 Jump】＋【殺球 Hit】雙鍵)
function bindMobileControls() {
  const btnJump = document.getElementById('btn-jump');
  const btnHit  = document.getElementById('btn-hit');
  const dpadUp    = document.getElementById('dpad-up');
  const dpadDown  = document.getElementById('dpad-down');
  const dpadLeft  = document.getElementById('dpad-left');
  const dpadRight = document.getElementById('dpad-right');

  const triggerHaptic = (ms = 12) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (err) {}
    }
  };

  // 建立方向鍵綁定工具函式 (pointer + touch 雙保安)
  const bindDpad = (btn, key) => {
    if (!btn) return;
    const down = (e) => {
      e.preventDefault();
      btn.classList.add('active');
      triggerHaptic(10);
      if (gameEngine) gameEngine.keys[key] = true;
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (gameEngine) gameEngine.keys[key] = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', up, { passive: false });
  };

  bindDpad(dpadUp,    'up');
  bindDpad(dpadDown,  'down');
  bindDpad(dpadLeft,  'left');
  bindDpad(dpadRight, 'right');

  // 右手按鈕 1：【跳躍 Jump】🚀
  if (btnJump) {
    const down = (e) => {
      e.preventDefault();
      triggerHaptic(12);
      btnJump.classList.add('active');
      if (gameEngine) gameEngine.keys.up = true;
    };
    const up = (e) => {
      e.preventDefault();
      btnJump.classList.remove('active');
      if (gameEngine) gameEngine.keys.up = false;
    };
    btnJump.addEventListener('pointerdown', down);
    btnJump.addEventListener('pointerup', up);
    btnJump.addEventListener('pointerleave', up);
    btnJump.addEventListener('pointercancel', up);
    btnJump.addEventListener('touchstart', down, { passive: false });
    btnJump.addEventListener('touchend', up, { passive: false });
    btnJump.addEventListener('touchcancel', up, { passive: false });
  }

  // 右手按鈕 2：【殺球 / 擊球 Hit】⚡
  if (btnHit) {
    const down = (e) => {
      e.preventDefault();
      triggerHaptic(18);
      btnHit.classList.add('active');
      if (gameEngine) gameEngine.playerHit();
    };
    const up = (e) => {
      e.preventDefault();
      btnHit.classList.remove('active');
    };
    btnHit.addEventListener('pointerdown', down);
    btnHit.addEventListener('pointerup', up);
    btnHit.addEventListener('pointerleave', up);
    btnHit.addEventListener('pointercancel', up);
    btnHit.addEventListener('touchstart', down, { passive: false });
    btnHit.addEventListener('touchend', up, { passive: false });
    btnHit.addEventListener('touchcancel', up, { passive: false });
  }

  // 鍵盤支援
  const KEY_MAP = {
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    'KeyW': 'up', 'KeyS': 'down', 'KeyA': 'left', 'KeyD': 'right'
  };
  const JUMP_KEYS = new Set(['KeyW', 'ArrowUp', 'Space']);
  const POWER_KEYS = new Set(['KeyJ', 'KeyK', 'KeyX', 'KeyZ', 'ShiftLeft', 'ShiftRight', 'Enter']);

  document.addEventListener('keydown', (e) => {
    const code = e.code;
    const key = e.key ? e.key.toLowerCase() : '';
    if (KEY_MAP[code] && gameEngine) { e.preventDefault(); gameEngine.keys[KEY_MAP[code]] = true; }
    if (JUMP_KEYS.has(code) && gameEngine) { e.preventDefault(); gameEngine.keys.up = true; }
    if ((POWER_KEYS.has(code) || key === 'a' || key === 'j') && gameEngine) { e.preventDefault(); gameEngine.playerHit(); }
  });

  document.addEventListener('keyup', (e) => {
    const code = e.code;
    if (KEY_MAP[code] && gameEngine) { e.preventDefault(); gameEngine.keys[KEY_MAP[code]] = false; }
    if (JUMP_KEYS.has(code) && gameEngine) { e.preventDefault(); gameEngine.keys.up = false; }
  });
}

// 結算彈窗
function showMatchResultModal(winner, loser, scoreResult, matchIdx) {
  arenaModal.style.display = 'flex';

  if (matchIdx === 0) {
    // 準決賽 1 結束
    arenaModalIcon.textContent = '🎉';
    arenaModalTitle.textContent = `${winner.name} 獲勝！`;
    arenaModalDesc.textContent = `成功晉級婚禮總決賽！獲得 +${scoreResult.winnerDelta} 積分！落敗選手扣除 ${Math.abs(scoreResult.loserDelta)} 積分。`;
    arenaModalBtn.textContent = '進入準決賽第 2 場 ➔';
    arenaModalBtn.onclick = () => {
      update(roomRef, {
        currentMatchIndex: 1,
        sf1Winner: winner,
        updatedAt: Date.now()
      });
    };
  } else if (matchIdx === 1) {
    // 準決賽 2 結束
    arenaModalIcon.textContent = '🎉';
    arenaModalTitle.textContent = `${winner.name} 獲勝！`;
    arenaModalDesc.textContent = `成功搶下決賽最後一張門票！獲得 +${scoreResult.winnerDelta} 積分！即將展開巔峰總決賽！`;
    arenaModalBtn.textContent = '進入 👑 婚禮總決賽 ➔';
    arenaModalBtn.onclick = () => {
      update(roomRef, {
        currentMatchIndex: 2,
        sf2Winner: winner,
        updatedAt: Date.now()
      });
    };
  } else {
    // 總決賽結束，總冠軍出爐！
    arenaModalIcon.textContent = '👑';
    arenaModalTitle.textContent = `🏆 ${winner.name} 榮登婚禮總冠軍！`;
    arenaModalDesc.textContent = `以卓越的球技擊敗對手，贏得最高榮耀與 +${scoreResult.winnerDelta} 積分！祝新婚快樂！`;
    arenaModalBtn.textContent = '查看英雄排行榜 🏆';
    arenaModalBtn.onclick = () => {
      update(roomRef, {
        status: 'waiting',
        champion: winner,
        updatedAt: Date.now()
      });
      window.location.href = './ranking.html';
    };
  }
}

// 觀戰者加油拍手 / 飄愛心
document.querySelectorAll('.cheer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.getAttribute('data-emoji');
    push(cheersRef, {
      emoji,
      nickname,
      time: Date.now()
    });
  });
});

// 監聽即時加油彈幕
onValue(cheersRef, snap => {
  const data = snap.val();
  if (!data) return;
  const entries = Object.values(data);
  const latest = entries[entries.length - 1];
  if (latest && Date.now() - latest.time < 3000) {
    spawnFloatingEmoji(latest.emoji);
  }
});

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = (30 + Math.random() * 40) + '%';
  document.querySelector('.arena-content').appendChild(el);
  setTimeout(() => el.remove(), 2000);
}
