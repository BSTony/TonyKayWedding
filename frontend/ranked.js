import { db, ref, onValue, update, increment } from './firebase.js';
import { BadmintonEngine } from './badmintonEngine.js';
import { calculateRankedPoints } from './rankedScore.js';

const uid = localStorage.getItem('wbc_uid') || ('user_' + Math.floor(Math.random() * 1000000));
const nickname = localStorage.getItem('wbc_nickname') || '婚禮嘉賓';
localStorage.setItem('wbc_uid', uid);
localStorage.setItem('wbc_nickname', nickname);

let myPoints = Number(localStorage.getItem('wbc_points')) || 0;

// 監聽自身積分
onValue(ref(db, 'players/' + uid), snap => {
  const d = snap.val();
  if (d && d.points !== undefined) {
    myPoints = d.points;
    localStorage.setItem('wbc_points', myPoints);
    document.getElementById('my-pts').innerText = myPoints + ' pts';
  }
});

// DOM 元素
const matchingView = document.getElementById('matching-view');
const arenaView = document.getElementById('arena-view');
const matchStatusText = document.getElementById('match-status-text');

const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myPtsEl = document.getElementById('my-pts');

const oppAvatarEl = document.getElementById('opp-avatar');
const oppNameEl = document.getElementById('opp-name');
const oppPtsEl = document.getElementById('opp-pts');

const arenaP1Name = document.getElementById('arena-p1-name');
const arenaP2Name = document.getElementById('arena-p2-name');
const arenaP1Score = document.getElementById('arena-p1-score');
const arenaP2Score = document.getElementById('arena-p2-score');

const matchModal = document.getElementById('match-modal');
const modalIcon = document.getElementById('modal-icon');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalBtnNext = document.getElementById('modal-btn-next');

// 初始化自身資料
const EMOJIS = ['🏸', '👑', '⚡', '🌸', '🦋', '🎯', '🔥', '🌟', '💪', '🐼'];
const code = nickname.charCodeAt(0) || 0;
myAvatarEl.textContent = EMOJIS[code % EMOJIS.length];
myNameEl.textContent = nickname;
myPtsEl.textContent = myPoints + ' pts';

// 天梯候選對手池 (包含各個積分段位的對手)
const RANKED_CONTENDERS = [
  { name: '👦 伴郎大明', avatar: '🏸', ptsOffset: -5, boldness: 2 },
  { name: '👧 伴娘小雅', avatar: '🌸', ptsOffset: 0, boldness: 3 },
  { name: '👦 伴郎阿豪', avatar: '⚡', ptsOffset: +4, boldness: 4 },
  { name: '👧 伴娘萱萱', avatar: '🦋', ptsOffset: -2, boldness: 3 },
  { name: '👦 伴郎俊傑', avatar: '🔥', ptsOffset: +6, boldness: 5 },
  { name: '👰 新娘 KAY 👑', avatar: '👑', ptsOffset: +10, boldness: 6 }
];

let currentOpponent = null;
let gameEngine = null;

// 啟動排位配對
function startMatchmaking() {
  matchingView.style.display = 'block';
  arenaView.style.display = 'none';
  matchModal.style.display = 'none';

  matchStatusText.textContent = '正在配對實力相當的對手...';
  oppAvatarEl.textContent = '❓';
  oppNameEl.textContent = '搜尋對手中...';
  oppNameEl.style.color = 'var(--text-secondary)';
  oppPtsEl.textContent = '- pts';

  // 模擬 1.8 秒雷達搜尋後配對成功
  setTimeout(() => {
    // 隨機挑選天梯對手
    const randContender = RANKED_CONTENDERS[Math.floor(Math.random() * RANKED_CONTENDERS.length)];
    const oppPoints = Math.max(0, myPoints + randContender.ptsOffset);

    currentOpponent = {
      name: randContender.name,
      avatar: randContender.avatar,
      points: oppPoints,
      boldness: randContender.boldness
    };

    oppAvatarEl.textContent = currentOpponent.avatar;
    oppNameEl.textContent = currentOpponent.name;
    oppNameEl.style.color = 'var(--text-primary)';
    oppPtsEl.textContent = currentOpponent.points + ' pts';

    matchStatusText.textContent = '🎯 配對成功！即將進入賽場...';

    setTimeout(() => {
      enterArenaMatch();
    }, 1200);
  }, 1800);
}

// 進入對決賽場
function enterArenaMatch() {
  matchingView.style.display = 'none';
  arenaView.style.display = 'block';

  arenaP1Name.textContent = `👦 ${nickname} (${myPoints} pts)`;
  arenaP2Name.textContent = `${currentOpponent.name} (${currentOpponent.points} pts)`;
  arenaP1Score.textContent = '0';
  arenaP2Score.textContent = '0';

  if (!gameEngine) {
    gameEngine = new BadmintonEngine('game-canvas');
    bindMobileControls();
  }

  gameEngine.onScoreUpdate = (p1Score, p2Score) => {
    arenaP1Score.textContent = p1Score;
    arenaP2Score.textContent = p2Score;
  };

  gameEngine.onGameOver = (playerWon) => {
    handleRankedGameOver(playerWon);
  };

  gameEngine.start(5, currentOpponent.boldness);
}

// 處理結算加扣分
function handleRankedGameOver(playerWon) {
  let scoreResult;

  if (playerWon) {
    // 玩家獲勝
    scoreResult = calculateRankedPoints(myPoints, currentOpponent.points);
    if (uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.winnerDelta),
        wins: increment(1)
      });
    }

    modalIcon.textContent = '🎉';
    if (scoreResult.winnerDelta === 5) {
      modalTitle.textContent = '🔥 驚天逆轉勝！';
      modalDesc.textContent = `成功逆襲高積分對手！獲得 +5 積分！(當前積分: ${myPoints + 5} pts)`;
    } else if (scoreResult.winnerDelta === 3) {
      modalTitle.textContent = '🏆 勢均力敵，旗開得勝！';
      modalDesc.textContent = `擊敗同積分強敵！獲得 +3 積分！(當前積分: ${myPoints + 3} pts)`;
    } else {
      modalTitle.textContent = '⚡ 穩操勝券，贏得比賽！';
      modalDesc.textContent = `成功捍衛排名！獲得 +1 積分！(當前積分: ${myPoints + 1} pts)`;
    }
  } else {
    // 玩家落敗
    scoreResult = calculateRankedPoints(currentOpponent.points, myPoints);
    if (uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.loserDelta)
      });
    }

    modalIcon.textContent = '💀';
    modalTitle.textContent = '排位賽惜敗！';
    const newPts = Math.max(0, myPoints + scoreResult.loserDelta);
    modalDesc.textContent = `扣除 ${Math.abs(scoreResult.loserDelta)} 積分 (最低 0 分保底，當前積分: ${newPts} pts)。要再挑戰一次嗎？`;
  }

  modalBtnNext.onclick = () => {
    startMatchmaking();
  };

  matchModal.style.display = 'flex';
}

// 退出賽場返回大廳
document.getElementById('btn-exit-arena').addEventListener('click', () => {
  if (gameEngine) gameEngine.stop();
  window.location.href = './lobby.html';
});

// 手遊控制綁定 (左手滑動 D-pad ＋ 右手發光攻擊鈕)
function bindMobileControls() {
  const dpadContainer = document.getElementById('dpad-container');
  const btnHit = document.getElementById('btn-hit');
  const dirBtns = {
    up: document.getElementById('btn-up'),
    down: document.getElementById('btn-down'),
    left: document.getElementById('btn-left'),
    right: document.getElementById('btn-right')
  };

  const triggerHaptic = (ms = 12) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (err) {}
    }
  };

  // ── 右手殺球鍵 ──
  if (btnHit) {
    const handleHitDown = (e) => {
      e.preventDefault();
      triggerHaptic(18);
      btnHit.classList.add('active');
      if (gameEngine) gameEngine.playerHit();
    };
    const handleHitUp = (e) => {
      e.preventDefault();
      btnHit.classList.remove('active');
    };

    btnHit.addEventListener('pointerdown', handleHitDown);
    btnHit.addEventListener('pointerup', handleHitUp);
    btnHit.addEventListener('pointerleave', handleHitUp);
    btnHit.addEventListener('pointercancel', handleHitUp);
  }

  // ── 左手方向鍵滑動轉向判定 ──
  if (dpadContainer) {
    const resetDirs = () => {
      if (gameEngine) gameEngine.keys = { up: false, down: false, left: false, right: false };
      Object.values(dirBtns).forEach(b => b?.classList.remove('active'));
    };

    const handleTouch = (e) => {
      e.preventDefault();
      const touches = e.touches ? Array.from(e.touches) : [e];
      const newKeys = { up: false, down: false, left: false, right: false };

      touches.forEach(t => {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && el.dataset && el.dataset.dir) {
          newKeys[el.dataset.dir] = true;
        }
      });

      let changed = false;
      for (const k in newKeys) {
        if (gameEngine && gameEngine.keys[k] !== newKeys[k]) changed = true;
        if (gameEngine) gameEngine.keys[k] = newKeys[k];
        if (dirBtns[k]) {
          if (newKeys[k]) dirBtns[k].classList.add('active');
          else dirBtns[k].classList.remove('active');
        }
      }
      if (changed) triggerHaptic(10);
    };

    dpadContainer.addEventListener('touchstart', handleTouch, { passive: false });
    dpadContainer.addEventListener('touchmove', handleTouch, { passive: false });
    dpadContainer.addEventListener('touchend', (e) => {
      if (!e.touches || e.touches.length === 0) resetDirs();
      else handleTouch(e);
    }, { passive: false });
    dpadContainer.addEventListener('touchcancel', resetDirs, { passive: false });

    // Pointer / 滑鼠點擊相容
    for (const dir in dirBtns) {
      const btn = dirBtns[dir];
      if (!btn) continue;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        triggerHaptic(10);
        if (gameEngine) gameEngine.keys[dir] = true;
        btn.classList.add('active');
      });
      btn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        if (gameEngine) gameEngine.keys[dir] = false;
        btn.classList.remove('active');
      });
      btn.addEventListener('pointerleave', (e) => {
        e.preventDefault();
        if (gameEngine) gameEngine.keys[dir] = false;
        btn.classList.remove('active');
      });
    }
  }

  // 鍵盤支援
  const KEY_MAP = {
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    'KeyW': 'up', 'KeyS': 'down', 'KeyD': 'right'
  };
  const POWER_KEYS = new Set(['KeyA', 'KeyX', 'Space', 'KeyZ', 'ShiftLeft', 'ShiftRight', 'Enter', 'KeyJ', 'KeyK']);

  document.addEventListener('keydown', (e) => {
    const code = e.code;
    const key = e.key ? e.key.toLowerCase() : '';
    if (KEY_MAP[code] && gameEngine) { e.preventDefault(); gameEngine.keys[KEY_MAP[code]] = true; }
    if ((POWER_KEYS.has(code) || key === 'a' || key === ' ') && gameEngine) { e.preventDefault(); gameEngine.playerHit(); }
  });

  document.addEventListener('keyup', (e) => {
    const code = e.code;
    if (KEY_MAP[code] && gameEngine) { e.preventDefault(); gameEngine.keys[KEY_MAP[code]] = false; }
  });
}

// 進入頁面立即啟動配對！
startMatchmaking();
