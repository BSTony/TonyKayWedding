import { db, ref, onValue, set, get, update, remove, increment } from './firebase.js';
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
const EMOJIS = ['🏆', '👑', '⚡', '🌸', '🦋', '🎯', '🔥', '🌟', '💪', '🐼'];
const code = nickname.charCodeAt(0) || 0;
myAvatarEl.textContent = EMOJIS[code % EMOJIS.length];
myNameEl.textContent = nickname;
myPtsEl.textContent = myPoints + ' pts';

// 天梯候選對手池 (包含各個積分段位的對手)
const RANKED_CONTENDERS = [
  { name: '🥉【青銅初階】AI', avatar: '🥉', ptsOffset: -5, boldness: 2 },
  { name: '🥈【白銀好手】AI', avatar: '🥈', ptsOffset: 0, boldness: 3 },
  { name: '🥇【黃金專家】AI', avatar: '🥇', ptsOffset: +4, boldness: 4 },
  { name: '💎【璀璨鑽石】AI', avatar: '💎', ptsOffset: +6, boldness: 5 },
  { name: '👑【最強王者】新娘 KAY', avatar: '👑', ptsOffset: +10, boldness: 6 }
];

let gameEngine = null;
let currentOpponent = null;
let queueKey = null;
let queueRef = null;
let matchFound = false;
let elapsedTimer = null;
let elapsedSeconds = 0;

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// 啟動排位配對 (優先配對線上真人，計時增加)
function startMatchmaking() {
  matchingView.style.display = 'block';
  arenaView.style.display = 'none';
  matchModal.style.display = 'none';
  matchFound = false;
  elapsedSeconds = 0;

  if (elapsedTimer) clearInterval(elapsedTimer);

  matchStatusText.textContent = '🔍 正在搜尋線上真人對手...';
  const timerEl = document.getElementById('queue-timer');
  if (timerEl) timerEl.textContent = '00:00';

  oppAvatarEl.textContent = '❓';
  oppNameEl.textContent = '搜尋對手中...';
  oppNameEl.style.color = 'var(--text-secondary)';
  oppPtsEl.textContent = '- pts';

  try {
    // 為每個配對連線產生獨立 Session Key (防止同瀏覽器雙開或多開互相衝突)
    queueKey = uid + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    queueRef = ref(db, 'rankedQueue/' + queueKey);

    // 1. 登記進入排位配對隊列
    set(queueRef, {
      queueKey,
      uid,
      nickname,
      points: myPoints,
      avatar: myAvatarEl.textContent,
      status: 'searching',
      matchedWith: null,
      createdAt: Date.now()
    }).catch((err) => console.error('Queue set error:', err));

    // 2. 監聽自身是否被其他玩家配對
    onValue(queueRef, (snap) => {
      if (matchFound) return;
      const data = snap.val();
      if (data && data.matchedWith) {
        matchFound = true;
        if (elapsedTimer) clearInterval(elapsedTimer);
        pairWithRealOpponent(data.matchedWith);
      }
    });

    // 3. 主動尋找隊列中其他等待中的玩家
    onValue(ref(db, 'rankedQueue'), (snap) => {
      if (matchFound) return;
      const allQueue = snap.val() || {};
      for (const otherKey in allQueue) {
        if (otherKey !== queueKey) {
          const other = allQueue[otherKey];
          // 檢查對方是否正在搜尋且尚未配對，且時間在 2 分鐘內
          if (other && (other.status === 'searching' && !other.matchedWith) && (Date.now() - (other.createdAt || 0) < 120000)) {
            matchFound = true;
            if (elapsedTimer) clearInterval(elapsedTimer);

            // 雙向即時握手配對
            update(ref(db, 'rankedQueue/' + otherKey), {
              status: 'matched',
              matchedWith: { uid, nickname, points: myPoints, avatar: myAvatarEl.textContent }
            }).catch(() => {});

            update(queueRef, {
              status: 'matched',
              matchedWith: { uid: other.uid, nickname: other.nickname, points: other.points || 0, avatar: other.avatar || '🏸' }
            }).catch(() => {});

            pairWithRealOpponent(other);
            break;
          }
        }
      }
    });
  } catch (err) {
    console.warn('Firebase RTDB queue initialization error:', err);
  }

  // 4. 正向增加計時器 (00:00 向上遞增)
  elapsedTimer = setInterval(() => {
    elapsedSeconds++;
    if (timerEl) timerEl.textContent = formatTime(elapsedSeconds);
  }, 1000);

  // 綁定一鍵挑戰 AI 按鈕
  const btnPlayAi = document.getElementById('btn-play-ai');
  if (btnPlayAi) {
    btnPlayAi.onclick = () => {
      if (!matchFound) {
        matchFound = true;
        if (elapsedTimer) clearInterval(elapsedTimer);
        if (queueRef) remove(queueRef).catch(() => {});
        pairWithAIContender();
      }
    };
  }
}

// 配對到真人玩家
function pairWithRealOpponent(opponent) {
  if (elapsedTimer) clearInterval(elapsedTimer);
  setTimeout(() => {
    if (queueRef) remove(queueRef).catch(() => {});
  }, 2500);

  currentOpponent = {
    name: opponent.nickname || '線上嘉賓',
    avatar: opponent.avatar || '🏸',
    points: opponent.points || 0,
    boldness: 3
  };

  oppAvatarEl.textContent = currentOpponent.avatar;
  oppNameEl.textContent = currentOpponent.name;
  oppNameEl.style.color = 'var(--text-primary)';
  oppPtsEl.textContent = currentOpponent.points + ' pts';

  matchStatusText.textContent = `🎯 成功配對真人玩家【${currentOpponent.name}】！`;

  setTimeout(() => {
    enterArenaMatch();
  }, 1200);
}

// 根據玩家積分，動態獲取匹配的天梯 AI 對手與強度等級 (純段位命名)
function getDynamicAIContender(pts) {
  if (pts <= 10) {
    // 🥉 青銅新手段位 (0~10 pts)
    const contenders = [
      { name: '🥉【青銅初階】AI', avatar: '🥉', offset: -1, boldness: 2 },
      { name: '🥉【青銅先鋒】AI', avatar: '🥉', offset: 0, boldness: 2 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 25) {
    // 🥈 白銀好手段位 (11~25 pts)
    const contenders = [
      { name: '🥈【白銀好手】AI', avatar: '🥈', offset: 2, boldness: 3 },
      { name: '🥈【白銀菁英】AI', avatar: '🥈', offset: -2, boldness: 4 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 50) {
    // 🥇 黃金大師段位 (26~50 pts)
    const contenders = [
      { name: '🥇【黃金專家】AI', avatar: '🥇', offset: 4, boldness: 5 },
      { name: '🥇【黃金大師】AI', avatar: '🥇', offset: 3, boldness: 5 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 90) {
    // 💎 璀璨鑽石段位 (51~90 pts)
    const contenders = [
      { name: '💎【璀璨鑽石】AI', avatar: '💎', offset: 6, boldness: 6 },
      { name: '💎【星耀宗師】AI', avatar: '💎', offset: 5, boldness: 6 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else {
    // 👑 最強王者 / 殿堂傳奇 (90+ pts)
    const contenders = [
      { name: '👑【最強王者】新娘 KAY', avatar: '👑', offset: 8, boldness: 7 },
      { name: '🏆【神話傳奇】巔峰 AI', avatar: '🏆', offset: 10, boldness: 7 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  }
}

// 配對到天梯挑戰者 (AI)
function pairWithAIContender() {
  if (countdownTimer) clearInterval(countdownTimer);
  const contender = getDynamicAIContender(myPoints);
  const oppPoints = Math.max(0, myPoints + contender.offset);

  currentOpponent = {
    name: contender.name,
    avatar: contender.avatar,
    points: oppPoints,
    boldness: contender.boldness
  };

  oppAvatarEl.textContent = currentOpponent.avatar;
  oppNameEl.textContent = currentOpponent.name;
  oppNameEl.style.color = 'var(--text-primary)';
  oppPtsEl.textContent = currentOpponent.points + ' pts';

  matchStatusText.textContent = `🎯 配對到天梯高手【${currentOpponent.name}】！(難度 LV.${contender.boldness})`;

  setTimeout(() => {
    enterArenaMatch();
  }, 1200);
}

window.addEventListener('beforeunload', () => {
  if (queueRef) remove(queueRef).catch(() => {});
});

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
