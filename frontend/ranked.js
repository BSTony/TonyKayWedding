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

let currentRoomId = null;
let isHostPlayer = false;

// 配對到真人玩家
function pairWithRealOpponent(opponent) {
  if (elapsedTimer) clearInterval(elapsedTimer);

  const oppKey = opponent.queueKey || opponent.uid;
  isHostPlayer = queueKey < oppKey;
  currentRoomId = 'room_' + [queueKey, oppKey].sort().join('_vs_').replace(/[^a-zA-Z0-9_]/g, '_');

  setTimeout(() => {
    if (queueRef) remove(queueRef).catch(() => {});
  }, 3000);

  currentOpponent = {
    name: opponent.nickname || '線上嘉賓',
    avatar: opponent.avatar || '🏸',
    points: opponent.points || 0,
    isRealPlayer: true
  };

  oppAvatarEl.textContent = currentOpponent.avatar;
  oppNameEl.textContent = currentOpponent.name;
  oppNameEl.style.color = 'var(--text-primary)';
  oppPtsEl.textContent = currentOpponent.points + ' pts';

  matchStatusText.textContent = `🎯 成功配對真人玩家【${currentOpponent.name}】！`;

  // 若為 Host，初始化房間
  if (isHostPlayer) {
    set(ref(db, 'rankedRooms/' + currentRoomId), {
      host: { uid, nickname, points: myPoints },
      guest: { uid: opponent.uid, nickname: opponent.nickname, points: opponent.points },
      status: 'playing',
      createdAt: Date.now()
    }).catch(() => {});
  }

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
  if (elapsedTimer) clearInterval(elapsedTimer);
  const contender = getDynamicAIContender(myPoints);
  const oppPoints = Math.max(0, myPoints + contender.offset);

  currentOpponent = {
    name: contender.name,
    avatar: contender.avatar,
    points: oppPoints,
    boldness: contender.boldness,
    isRealPlayer: false
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
  if (currentRoomId) remove(ref(db, 'rankedRooms/' + currentRoomId)).catch(() => {});
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

  // 判定真人連線對打 vs 單人 AI
  if (currentOpponent.isRealPlayer && currentRoomId) {
    if (isHostPlayer) {
      // 🌟 Host 模式：左邊玩家充當權威主機，負責物理運算並廣播畫面狀態給 Guest
      gameEngine.startMultiplayer('host', 5, null, (state) => {
        set(ref(db, 'rankedRooms/' + currentRoomId + '/state'), state).catch(() => {});
      });

      // 即時接收 Guest (右邊玩家) 的搖桿按鍵操作
      onValue(ref(db, 'rankedRooms/' + currentRoomId + '/guestInput'), (snap) => {
        const input = snap.val();
        if (input && gameEngine) {
          gameEngine.setRemoteGuestInput(input);
        }
      });
    } else {
      // 🌟 Guest 模式：右邊玩家，發送本地按鍵指令並即時同步 Host 的畫面
      gameEngine.startMultiplayer('guest', 5, (input) => {
        set(ref(db, 'rankedRooms/' + currentRoomId + '/guestInput'), input).catch(() => {});
      }, null);

      // 即時接收 Host 廣播的權威物理畫面與比分 (100% 畫面一致)
      onValue(ref(db, 'rankedRooms/' + currentRoomId + '/state'), (snap) => {
        const state = snap.val();
        if (state && gameEngine) {
          gameEngine.receiveRemoteState(state);
        }
      });
    }
  } else {
    // 單人練習 / AI 對戰模式
    gameEngine.start(5, currentOpponent.boldness || 3);
  }
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
    matchModal.style.display = 'flex';
  }
}

// 退出賽場返回大廳
document.getElementById('btn-exit-arena').addEventListener('click', () => {
  if (gameEngine) gameEngine.stop();
  window.location.href = './lobby.html';
});

// 手遊控制綁定 (左手 360° 圓盤虛擬搖桿 ＋ 右手【跳躍 Jump】＋【殺球 Hit】雙鍵)
function bindMobileControls() {
  const disc = document.getElementById('joystick-disc');
  const knob = document.getElementById('joystick-knob');
  const btnJump = document.getElementById('btn-jump');
  const btnHit = document.getElementById('btn-hit');
  const arrowUp = document.getElementById('j-up');
  const arrowDown = document.getElementById('j-down');
  const arrowLeft = document.getElementById('j-left');
  const arrowRight = document.getElementById('j-right');

  const triggerHaptic = (ms = 12) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (err) {}
    }
  };

  // ── 右手按鈕 1：【跳躍 Jump】🚀 ──
  if (btnJump) {
    const handleJumpDown = (e) => {
      e.preventDefault();
      triggerHaptic(12);
      btnJump.classList.add('active');
      if (gameEngine) gameEngine.keys.up = true;
    };
    const handleJumpUp = (e) => {
      e.preventDefault();
      btnJump.classList.remove('active');
      if (gameEngine) gameEngine.keys.up = false;
    };

    btnJump.addEventListener('pointerdown', handleJumpDown);
    btnJump.addEventListener('pointerup', handleJumpUp);
    btnJump.addEventListener('pointerleave', handleJumpUp);
    btnJump.addEventListener('pointercancel', handleJumpUp);
  }

  // ── 右手按鈕 2：【殺球 / 擊球 Hit】⚡ ──
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

  // ── 左手 360° 八向圓盤虛擬搖桿 (順滑打出撲球、斜向組合鍵) ──
  if (disc && knob) {
    let isDragging = false;
    let discRect = null;
    const MAX_RADIUS = 36;
    const DEAD_ZONE = 8;

    const resetJoystick = () => {
      isDragging = false;
      knob.style.transform = 'translate(0px, 0px)';
      knob.classList.remove('active');
      if (arrowUp) arrowUp.classList.remove('active');
      if (arrowDown) arrowDown.classList.remove('active');
      if (arrowLeft) arrowLeft.classList.remove('active');
      if (arrowRight) arrowRight.classList.remove('active');
      if (gameEngine) {
        // 保留可能由 Jump 按鈕按下的 up
        const isJumping = btnJump ? btnJump.classList.contains('active') : false;
        gameEngine.keys.left = false;
        gameEngine.keys.right = false;
        gameEngine.keys.down = false;
        if (!isJumping) gameEngine.keys.up = false;
      }
    };

    const updateJoystick = (clientX, clientY) => {
      if (!discRect) discRect = disc.getBoundingClientRect();
      const centerX = discRect.left + discRect.width / 2;
      const centerY = discRect.top + discRect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > MAX_RADIUS) {
        dx = (dx / dist) * MAX_RADIUS;
        dy = (dy / dist) * MAX_RADIUS;
      }

      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      knob.classList.add('active');

      const isJumping = btnJump ? btnJump.classList.contains('active') : false;
      const keys = { up: isJumping, down: false, left: false, right: false };

      if (dist > DEAD_ZONE) {
        if (dy < -DEAD_ZONE * 0.75) keys.up = true;
        if (dy > DEAD_ZONE * 0.75) keys.down = true;
        if (dx < -DEAD_ZONE * 0.75) keys.left = true;
        if (dx > DEAD_ZONE * 0.75) keys.right = true;
      }

      if (arrowUp) arrowUp.classList.toggle('active', keys.up);
      if (arrowDown) arrowDown.classList.toggle('active', keys.down);
      if (arrowLeft) arrowLeft.classList.toggle('active', keys.left);
      if (arrowRight) arrowRight.classList.toggle('active', keys.right);

      if (gameEngine) {
        gameEngine.keys.up = keys.up;
        gameEngine.keys.down = keys.down;
        gameEngine.keys.left = keys.left;
        gameEngine.keys.right = keys.right;
      }
    };

    const handlePointerDown = (e) => {
      e.preventDefault();
      isDragging = true;
      discRect = disc.getBoundingClientRect();
      triggerHaptic(10);
      updateJoystick(e.clientX, e.clientY);
    };

    const handlePointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      updateJoystick(e.clientX, e.clientY);
    };

    const handleTouchStart = (e) => {
      e.preventDefault();
      isDragging = true;
      discRect = disc.getBoundingClientRect();
      const t = e.touches[0];
      if (t) updateJoystick(t.clientX, t.clientY);
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) updateJoystick(t.clientX, t.clientY);
    };

    disc.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', resetJoystick);
    window.addEventListener('pointercancel', resetJoystick);

    disc.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', resetJoystick, { passive: false });
    window.addEventListener('touchcancel', resetJoystick, { passive: false });
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

// 進入頁面立即啟動配對！
startMatchmaking();
