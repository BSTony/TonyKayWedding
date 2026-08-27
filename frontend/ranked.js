// Author: Tony Hsieh
// Date: 2026-08-27
// Version: 2.3.5
import './version.js';
import { db, ref, onValue, set, update, remove, increment, onDisconnect } from './firebase.js';
import { BadmintonEngine, setGlobalEngine } from './badmintonEngine.js';
import { calculateRankedPoints } from './rankedScore.js';
import { CLOUD_RUN_WS_URL } from './cloudServer.js';

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
  { name: '🥉【青銅高階】AI', avatar: '🥉', ptsOffset: -5, boldness: 4 },
  { name: '🥈【白銀菁英】AI', avatar: '🥈', ptsOffset: 0, boldness: 5 },
  { name: '🥇【黃金大師】AI', avatar: '🥇', ptsOffset: +4, boldness: 6 },
  { name: '💎【星耀宗師】AI', avatar: '💎', ptsOffset: +6, boldness: 7 },
  { name: '👿【終極大魔王】新娘 KAY 👑', avatar: '👑', ptsOffset: +10, boldness: 8 }
];

const urlParams = new URLSearchParams(window.location.search);
let currentTab = urlParams.get('mode') === 'spectate' ? 'spectate' : 'play';

let gameEngine = null;
let currentOpponent = null;
let queueKey = null;
let queueRef = null;
let matchFound = false;
let elapsedTimer = null;
let elapsedSeconds = 0;
let isSpectating = false;
let spectatorUnsubs = [];
let matchUnsubs = [];
let activeSpectatedRoomId = null;

function clearMatchUnsubs() {
  matchUnsubs.forEach((u) => { try { u(); } catch (e) {} });
  matchUnsubs = [];
}

function wakeCloudServer(wsUrl) {
  if (!wsUrl) return;
  try {
    const httpUrl = String(wsUrl).replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    fetch(httpUrl, { cache: 'no-store' }).catch(() => {});
  } catch (e) {}
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── 即時監聽排隊人數與對戰中房間 ──
onValue(ref(db, 'rankedQueue'), snap => {
  const q = snap.val() || {};
  const now = Date.now();
  const validQueue = [];
  for (const key in q) {
    const item = q[key];
    if (item && item.createdAt && (now - item.createdAt < 45000) && item.status === 'searching') {
      validQueue.push(item);
    } else if (item && item.createdAt && (now - item.createdAt >= 45000)) {
      // 自動清理超過 45 秒之廢棄排隊項目
      remove(ref(db, 'rankedQueue/' + key)).catch(() => {});
    }
  }
  const el = document.getElementById('stat-queue-count');
  if (el) el.textContent = validQueue.length;
});

onValue(ref(db, 'rankedRooms'), snap => {
  const rooms = snap.val() || {};
  const now = Date.now();
  const activeRooms = [];
  let totalBattlingPlayers = 0;

  for (const rId in rooms) {
    const r = rooms[rId];
    if (r && r.status === 'playing' && !r.abandoned && r.createdAt && (now - r.createdAt < 5 * 60 * 1000)) {
      activeRooms.push({ id: rId, ...r });
      totalBattlingPlayers += (r.guest?.isAI ? 1 : 2);
    }
  }

  const battlingEl = document.getElementById('stat-battling-count');
  if (battlingEl) battlingEl.textContent = totalBattlingPlayers;

  const badgeEl = document.getElementById('live-matches-count-badge');
  if (badgeEl) badgeEl.textContent = `${activeRooms.length} 場`;

  renderLiveMatchesList(activeRooms);
});

function renderLiveMatchesList(activeRooms) {
  const container = document.getElementById('live-matches-container');
  if (!container) return;

  if (activeRooms.length === 0) {
    if (currentTab === 'spectate') {
      container.innerHTML = `
        <div style="background:white; border-radius:14px; padding:24px 16px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <div style="font-size:36px; margin-bottom:6px;">🏸</div>
          <div style="font-size:15px; font-weight:800; color:#1e1b4b;">目前暫無進行中的真人對戰</div>
          <div style="font-size:12px; color:#64748b; margin-top:4px; margin-bottom:16px;">您可以親自上場開戰，成為全場矚目的焦點！</div>
          <button id="btn-switch-to-matchmaking" style="background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:white; border:none; border-radius:12px; padding:10px 22px; font-size:13px; font-weight:800; cursor:pointer; box-shadow:0 2px 8px rgba(139,92,246,0.3);">
            ⚔️ 立即開始排位對決
          </button>
        </div>
      `;
      const btn = document.getElementById('btn-switch-to-matchmaking');
      if (btn) btn.onclick = () => switchTab('play');
    } else {
      container.innerHTML = `<div style="text-align:center; padding:12px 0; color:var(--text-secondary); font-size:12px;">目前暫無進行中的真人對戰，歡迎配對開戰！</div>`;
    }
    return;
  }

  container.innerHTML = activeRooms.map(room => {
    const p1 = room.host || { nickname: '1P', points: 0 };
    const p2 = room.guest || { nickname: '2P', points: 0 };
    const s1 = room.state?.s1 || 0;
    const s2 = room.state?.s2 || 0;
    const specCount = Object.keys(room.spectators || {}).length;

    return `
      <div style="background:white; border:1px solid #ddd6fe; border-radius:12px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; box-shadow:0 2px 8px rgba(139,92,246,0.08); gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:800; color:#1e1b4b; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p1.nickname || '1P'}</span>
            <span style="font-size:10px; color:#7c3aed; background:#ede9fe; padding:1px 5px; border-radius:6px;">${p1.points || 0} pts</span>
            <span style="font-size:11px; font-weight:900; color:#ef4444;">VS</span>
            <span style="max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p2.nickname || '2P'}</span>
            <span style="font-size:10px; color:#7c3aed; background:#ede9fe; padding:1px 5px; border-radius:6px;">${p2.points || 0} pts</span>
          </div>
          <div style="font-size:11px; color:#64748b; margin-top:3px; display:flex; align-items:center; gap:10px;">
            <span style="color:#ef4444; font-weight:800;">🔴 即時比分: ${s1} - ${s2}</span>
            <span>👀 ${specCount} 人在看</span>
          </div>
        </div>
        <button class="btn-spectate-action" data-room-id="${room.id}" style="background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:white; border:none; border-radius:10px; padding:8px 12px; font-size:12px; font-weight:800; cursor:pointer; box-shadow:0 2px 6px rgba(139,92,246,0.3); white-space:nowrap;">
          👀 觀戰
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-spectate-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const rId = btn.getAttribute('data-room-id');
      const targetRoom = activeRooms.find(r => r.id === rId);
      if (targetRoom) {
        startSpectating(rId, targetRoom);
      }
    });
  });
}

function startSpectating(roomId, roomData) {
  if (queueRef) {
    remove(queueRef).catch(() => {});
    queueRef = null;
  }
  if (elapsedTimer) clearInterval(elapsedTimer);

  isSpectating = true;
  activeSpectatedRoomId = roomId;
  matchEnded = false;

  matchingView.style.display = 'none';
  arenaView.style.display = 'block';

  // 隱藏手把，顯示觀戰頂欄
  const ctrl = document.getElementById('arena-controls');
  if (ctrl) ctrl.style.display = 'none';

  const hudText = document.getElementById('arena-hud-text');
  if (hudText) hudText.style.display = 'none';

  const specBanner = document.getElementById('spectator-banner');
  if (specBanner) specBanner.style.display = 'flex';

  arenaP1Name.textContent = `${roomData.host?.nickname || '1P'} (${roomData.host?.points || 0} pts)`;
  arenaP2Name.textContent = `${roomData.guest?.nickname || '2P'} (${roomData.guest?.points || 0} pts)`;
  arenaP1Score.textContent = roomData.state?.s1 || '0';
  arenaP2Score.textContent = roomData.state?.s2 || '0';

  if (gameEngine) gameEngine.stop();
  gameEngine = new BadmintonEngine('game-canvas');
  setGlobalEngine(gameEngine);
  gameEngine.startFirebaseClient('spectate', null, roomData.maxScore || 5);

  // 登記觀戰者
  const mySpecRef = ref(db, `rankedRooms/${roomId}/spectators/${uid}`);
  set(mySpecRef, { name: nickname, avatar: myAvatarEl.textContent }).catch(() => {});
  onDisconnect(mySpecRef).remove().catch(() => {});

  // 監聽觀戰人數
  spectatorUnsubs.push(onValue(ref(db, `rankedRooms/${roomId}/spectators`), snap => {
    const specs = snap.val() || {};
    const countEl = document.getElementById('spectator-live-count');
    if (countEl) countEl.textContent = Math.max(1, Object.keys(specs).length);
  }));

  // 監聽賽事狀態
  spectatorUnsubs.push(onValue(ref(db, `rankedRooms/${roomId}/state`), snap => {
    const st = snap.val();
    if (st && gameEngine) {
    gameEngine.receiveRemoteState(st, 'rtdb');
      arenaP1Score.textContent = st.s1 || 0;
      arenaP2Score.textContent = st.s2 || 0;

      if (st.round === 'game_over' || (st.s1 >= (roomData.maxScore || 5)) || (st.s2 >= (roomData.maxScore || 5))) {
        const winnerName = (st.s1 > st.s2) ? (roomData.host?.nickname || '1P') : (roomData.guest?.nickname || '2P');
        const specModal = document.getElementById('spectator-modal');
        const specDesc = document.getElementById('spec-modal-desc');
        if (specDesc) specDesc.textContent = `玩家【${winnerName}】以 ${st.s1 || 0} : ${st.s2 || 0} 贏得排位賽勝利！`;
        if (specModal) specModal.style.display = 'flex';
      }
    }
  }));

  // 監聽中途退出
  spectatorUnsubs.push(onValue(ref(db, `rankedRooms/${roomId}/abandoned`), snap => {
    const ab = snap.val();
    if (ab) {
      const specModal = document.getElementById('spectator-modal');
      const specDesc = document.getElementById('spec-modal-desc');
      if (specDesc) specDesc.textContent = `玩家【${ab.name || '對手'}】已中途離開，本局比賽結束！`;
      if (specModal) specModal.style.display = 'flex';
    }
  }));
}

function stopSpectating() {
  if (activeSpectatedRoomId) {
    remove(ref(db, `rankedRooms/${activeSpectatedRoomId}/spectators/${uid}`)).catch(() => {});
    activeSpectatedRoomId = null;
  }

  spectatorUnsubs.forEach(u => typeof u === 'function' && u());
  spectatorUnsubs = [];

  if (gameEngine) gameEngine.stop();
  isSpectating = false;

  const specModal = document.getElementById('spectator-modal');
  if (specModal) specModal.style.display = 'none';

  const specBanner = document.getElementById('spectator-banner');
  if (specBanner) specBanner.style.display = 'none';

  const ctrl = document.getElementById('arena-controls');
  if (ctrl) ctrl.style.display = 'flex';

  const hudText = document.getElementById('arena-hud-text');
  if (hudText) hudText.style.display = 'block';

  switchTab(currentTab);
}

// 綁定退出觀戰按鈕
document.getElementById('btn-exit-spectate')?.addEventListener('click', stopSpectating);
document.getElementById('btn-spec-modal-close')?.addEventListener('click', stopSpectating);

const tabPlayMode = document.getElementById('tab-play-mode');
const tabSpectateMode = document.getElementById('tab-spectate-mode');
const matchActivePanel = document.getElementById('match-active-panel');
const btnPlayAi = document.getElementById('btn-play-ai');
const btnCancelMatch = document.getElementById('btn-cancel-match');

function switchTab(tab) {
  currentTab = tab;
  if (tab === 'play') {
    if (tabPlayMode) {
      tabPlayMode.style.background = '#8b5cf6';
      tabPlayMode.style.color = 'white';
      tabPlayMode.style.boxShadow = '0 2px 8px rgba(139,92,246,0.3)';
    }
    if (tabSpectateMode) {
      tabSpectateMode.style.background = 'transparent';
      tabSpectateMode.style.color = 'var(--text-secondary)';
      tabSpectateMode.style.boxShadow = 'none';
    }
    if (matchActivePanel) matchActivePanel.style.display = 'block';
    if (btnPlayAi) btnPlayAi.style.display = 'block';
    if (btnCancelMatch) btnCancelMatch.style.display = 'block';

    startMatchmaking();
  } else {
    // 觀戰大廳 Tab
    if (tabSpectateMode) {
      tabSpectateMode.style.background = '#8b5cf6';
      tabSpectateMode.style.color = 'white';
      tabSpectateMode.style.boxShadow = '0 2px 8px rgba(139,92,246,0.3)';
    }
    if (tabPlayMode) {
      tabPlayMode.style.background = 'transparent';
      tabPlayMode.style.color = 'var(--text-secondary)';
      tabPlayMode.style.boxShadow = 'none';
    }
    if (matchActivePanel) matchActivePanel.style.display = 'none';
    if (btnPlayAi) btnPlayAi.style.display = 'none';
    if (btnCancelMatch) btnCancelMatch.style.display = 'none';

    // 退出排隊，純觀戰
    if (queueRef) {
      remove(queueRef).catch(() => {});
      queueRef = null;
    }
    if (elapsedTimer) clearInterval(elapsedTimer);
  }
}

if (tabPlayMode) tabPlayMode.addEventListener('click', () => switchTab('play'));
if (tabSpectateMode) tabSpectateMode.addEventListener('click', () => switchTab('spectate'));

// 啟動排位配對 (優先配對線上真人，計時增加)
function startMatchmaking() {
  matchingView.style.display = 'block';
  arenaView.style.display = 'none';
  matchModal.style.display = 'none';
  matchFound = false;
  isSpectating = false;
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
      if (matchFound || isSpectating) return;
      const data = snap.val();
      if (data && data.matchedWith) {
        matchFound = true;
        if (elapsedTimer) clearInterval(elapsedTimer);
        pairWithRealOpponent(data.matchedWith);
      }
    });

    // 3. 主動尋找隊列中其他等待中的玩家
    onValue(ref(db, 'rankedQueue'), (snap) => {
      if (matchFound || isSpectating) return;
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
              matchedWith: { queueKey, uid, nickname, points: myPoints, avatar: myAvatarEl.textContent }
            }).catch(() => {});

            update(queueRef, {
              status: 'matched',
              matchedWith: { queueKey: other.queueKey || otherKey, uid: other.uid, nickname: other.nickname, points: other.points || 0, avatar: other.avatar || '🏸' }
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
      if (!matchFound && !isSpectating) {
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
    // 🥉 青銅段位 (0~10 pts)
    const contenders = [
      { name: '🥉【青銅高階】AI', avatar: '🥉', offset: -1, boldness: 4 },
      { name: '🥉【青銅先鋒】AI', avatar: '🥉', offset: 0, boldness: 4 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 25) {
    // 🥈 白銀段位 (11~25 pts)
    const contenders = [
      { name: '🥈【白銀好手】AI', avatar: '🥈', offset: 2, boldness: 5 },
      { name: '🥈【白銀菁英】AI', avatar: '🥈', offset: -2, boldness: 5 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 50) {
    // 🥇 黃金段位 (26~50 pts)
    const contenders = [
      { name: '🥇【黃金專家】AI', avatar: '🥇', offset: 4, boldness: 6 },
      { name: '🥇【黃金大師】AI', avatar: '🥇', offset: 3, boldness: 6 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else if (pts <= 90) {
    // 💎 鑽石/星耀段位 (51~90 pts)
    const contenders = [
      { name: '💎【璀璨鑽石】AI', avatar: '💎', offset: 6, boldness: 7 },
      { name: '💎【星耀宗師】AI', avatar: '💎', offset: 5, boldness: 7 }
    ];
    return contenders[Math.floor(Math.random() * contenders.length)];
  } else {
    // 👿 終極大魔王 / 殿堂傳奇 (90+ pts)
    const contenders = [
      { name: '👿【終極大魔王】新娘 KAY 👑', avatar: '👑', offset: 8, boldness: 8 },
      { name: '🏆【神話魔王】巔峰 AI ⚡', avatar: '🏆', offset: 10, boldness: 8 }
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

let matchEnded = false;

window.addEventListener('beforeunload', () => {
  if (queueRef) remove(queueRef).catch(() => {});
  if (currentRoomId && !matchEnded) {
    set(ref(db, 'rankedRooms/' + currentRoomId + '/abandoned'), { by: uid, name: nickname }).catch(() => {});
  }
  clearMatchUnsubs();
});

function bindRealtimeMatch(roomId) {
  clearMatchUnsubs();
  const roomBase = 'rankedRooms/' + roomId;
  const myRole = isHostPlayer ? 'p1' : 'p2';
  const inputPath = myRole === 'p1' ? '/p1Input' : '/p2Input';

  const sendInput = (input) => {
    set(ref(db, roomBase + inputPath), input).catch(() => {});
  };

  onDisconnect(ref(db, roomBase + '/abandoned')).set({ by: uid, name: nickname }).catch(() => {});

  const unsubAbandoned = onValue(ref(db, roomBase + '/abandoned'), (snap) => {
    const ab = snap.val();
    if (ab && !matchEnded) {
      matchEnded = true;
      clearMatchUnsubs();
      if (gameEngine) gameEngine.stop();
      const leaverName = ab.name || '對手';
      modalIcon.textContent = '🏃‍♂️';
      modalTitle.textContent = '比賽已取消';
      modalDesc.textContent = `玩家【${leaverName}】已離開賽事，本局比賽無效（不計勝敗場與積分）！`;
      matchModal.style.display = 'flex';
    }
  });
  matchUnsubs.push(unsubAbandoned);

  gameEngine.startFirebaseClient(myRole, sendInput, 5);

  if (isHostPlayer) {
    const unsubP2 = onValue(ref(db, roomBase + '/p2Input'), (snap) => {
      const input = snap.val();
      if (input && gameEngine && gameEngine.multiplayerRole === 'host') {
        gameEngine.setRemoteGuestInput(input);
      }
    });
    matchUnsubs.push(unsubP2);
  }

  const unsubState = onValue(ref(db, roomBase + '/state'), (snap) => {
    const state = snap.val();
    if (!state || !gameEngine) return;
    if (gameEngine.multiplayerRole === 'host') return;
    gameEngine.receiveRemoteState(state, 'rtdb');
  });
  matchUnsubs.push(unsubState);

  const connectWs = (wsUrl) => {
    if (!wsUrl || !gameEngine) return;
    wakeCloudServer(wsUrl);
    gameEngine.attachWebSocket(wsUrl, roomId, myRole);
  };

  connectWs(CLOUD_RUN_WS_URL);

  if (isHostPlayer) {
    const fallbackTimer = setTimeout(() => {
      if (matchEnded || !gameEngine) return;
      const wsLive = gameEngine.lastWsStateTime && (performance.now() - gameEngine.lastWsStateTime < 2000);
      if (wsLive || gameEngine.roundState === 'playing' || gameEngine.roundState === 'scoring') return;
      gameEngine.adoptHostAuthority((state) => {
        if (!gameEngine || gameEngine.multiplayerRole !== 'host') return;
        set(ref(db, roomBase + '/state'), state).catch(() => {});
      });
    }, 2000);
    matchUnsubs.push(() => clearTimeout(fallbackTimer));
  }

  const unsubServerInfo = onValue(ref(db, 'serverInfo'), (snap) => {
    const info = snap.val();
    if (info && info.wsUrl) connectWs(info.wsUrl);
  });
  matchUnsubs.push(unsubServerInfo);

  const unsubWs = onValue(ref(db, roomBase + '/wsUrl'), (snap) => {
    const wsUrl = snap.val();
    if (wsUrl) connectWs(wsUrl);
  });
  matchUnsubs.push(unsubWs);

  const unsubHost = onValue(ref(db, roomBase + '/serverHost'), (snap) => {
    if (!snap.val() || !gameEngine) return;
    if (gameEngine.multiplayerRole === 'host') {
      gameEngine.yieldToCloudAuthority('p1', sendInput);
    }
  });
  matchUnsubs.push(unsubHost);
}

// 進入對決賽場
function enterArenaMatch() {
  matchingView.style.display = 'none';
  arenaView.style.display = 'block';
  matchEnded = false;

  // 永遠保持 P1 = 左側選手，P2 = 右側選手，避免客端名稱反轉
  if (isHostPlayer || !currentOpponent.isRealPlayer) {
    arenaP1Name.textContent = `👦 ${nickname} (${myPoints} pts) [我]`;
    arenaP2Name.textContent = `${currentOpponent.name} (${currentOpponent.points} pts)`;
  } else {
    arenaP1Name.textContent = `${currentOpponent.name} (${currentOpponent.points} pts)`;
    arenaP2Name.textContent = `👧 ${nickname} (${myPoints} pts) [我]`;
  }
  arenaP1Score.textContent = '0';
  arenaP2Score.textContent = '0';

  if (gameEngine) gameEngine.stop();
  gameEngine = new BadmintonEngine('game-canvas');
  setGlobalEngine(gameEngine);
  bindMobileControls();

  gameEngine.onScoreUpdate = (p1Score, p2Score) => {
    arenaP1Score.textContent = p1Score;
    arenaP2Score.textContent = p2Score;
  };

  gameEngine.onGameOver = (playerWon) => {
    matchEnded = true;
    clearMatchUnsubs();
    if (currentRoomId) {
      update(ref(db, 'rankedRooms/' + currentRoomId), { status: 'finished' }).catch(() => {});
      setTimeout(() => {
        remove(ref(db, 'rankedRooms/' + currentRoomId)).catch(() => {});
      }, 15000);
    }
    handleRankedGameOver(playerWon);
  };

  // 判定真人連線對打 vs 單人 AI
  if (currentOpponent.isRealPlayer && currentRoomId) {
    bindRealtimeMatch(currentRoomId);
  } else {
    // 🌟 單人天梯 / AI 對戰模式：同步註冊房間並廣播畫面，讓大廳與好友隨時 LIVE 觀戰！
    currentRoomId = 'room_' + uid + '_vs_ai_' + Date.now();
    set(ref(db, 'rankedRooms/' + currentRoomId), {
      host: { uid, nickname, points: myPoints, avatar: myAvatarEl.textContent },
      guest: { uid: 'ai', nickname: currentOpponent.name, points: currentOpponent.points, avatar: currentOpponent.avatar, isAI: true },
      status: 'playing',
      createdAt: Date.now()
    }).catch(() => {});

    onDisconnect(ref(db, 'rankedRooms/' + currentRoomId)).remove().catch(() => {});

    gameEngine.start(5, currentOpponent.boldness || 3, (state) => {
      set(ref(db, 'rankedRooms/' + currentRoomId + '/state'), state).catch(() => {});
    });
  }
}

// 處理結算加扣分 (雙方玩家均正常彈出結算視窗)
function handleRankedGameOver(playerWon) {
  let scoreResult;

  if (playerWon) {
    // 玩家獲勝
    scoreResult = calculateRankedPoints(myPoints, currentOpponent ? (currentOpponent.points || 0) : 0);
    if (uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.winnerDelta),
        wins: increment(1)
      });
    }

    modalIcon.textContent = '🎉';
    modalTitle.textContent = '排位賽獲勝！';
    modalDesc.textContent = `獲得 +${scoreResult.winnerDelta} 積分！`;
  } else {
    // 玩家落敗
    scoreResult = calculateRankedPoints(currentOpponent ? (currentOpponent.points || 0) : 0, myPoints);
    if (uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(scoreResult.loserDelta),
        losses: increment(1)
      });
    }

    modalIcon.textContent = '💔';
    modalTitle.textContent = '排位賽惜敗！';
    modalDesc.textContent = `很可惜未拿下比賽，積分變動 ${scoreResult.loserDelta} 分，再接再厲！`;
  }

  matchModal.style.display = 'flex';
}

if (modalBtnNext) {
  modalBtnNext.addEventListener('click', () => {
    matchModal.style.display = 'none';
    clearMatchUnsubs();
    if (gameEngine) gameEngine.stop();
    switchTab('play');
  });
}

// 退出賽場返回大廳 (若比賽進行中離開，通知對手中止並取消本局)
document.getElementById('btn-exit-arena').addEventListener('click', () => {
  if (isSpectating) {
    stopSpectating();
    return;
  }
  if (!matchEnded && currentRoomId) {
    set(ref(db, 'rankedRooms/' + currentRoomId + '/abandoned'), { by: uid, name: nickname }).catch(() => {});
  }
  clearMatchUnsubs();
  if (gameEngine) gameEngine.stop();
  window.location.href = './lobby.html';
});

// 手遊控制綁定 (十字方向鍵 D-Pad ＋ 右手「跳躍 Jump」＋「殺球 Hit」)
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

  // 建立方向鍵綁定工即函式 (pointerdown + touchstart 雙保安)
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

  // 右手按鈕 1：「跳躍 Jump」
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

  // 右手按鈕 2：「殺球 Hit」
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

// 進入頁面依據 URL 參數模式初始化 (play 或 spectate)
switchTab(currentTab);
