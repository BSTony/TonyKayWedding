import { db, ref, onValue, update, increment } from './firebase.js';
import { BadmintonEngine } from './badmintonEngine.js';

let myTeam = null;
let myTaps = 0;
let isPlaying = false;

// 電腦對戰變數
let gameEngine = null;

const screenSelect = document.getElementById('screen-select');
const screenGame = document.getElementById('screen-game');
const teamText = document.getElementById('my-team-text');
const tapBtn = document.getElementById('tap-btn');
const myTapsEl = document.getElementById('my-taps');
const gameStatus = document.getElementById('game-status');
const myScoreVsEl = document.getElementById('my-score-vs');
const compScoreVsEl = document.getElementById('comp-score-vs');

const uid = localStorage.getItem('wbc_uid');

// Handle Team Selection
document.querySelectorAll('.btn-team').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // 確保點擊到的元素是 button 或者是往上找 button
    const targetBtn = e.target.closest('.btn-team');
    if (!targetBtn) return;
    
    myTeam = targetBtn.getAttribute('data-team');
    
    screenSelect.classList.add('hidden');
    screenGame.classList.remove('hidden');
    
    if (myTeam === 'left') {
      teamText.innerText = '👦 新郎隊';
      tapBtn.style.background = 'linear-gradient(135deg, #4facfe, #00f2fe)';
    } else if (myTeam === 'right') {
      teamText.innerText = '👧 新娘隊';
      tapBtn.style.background = 'linear-gradient(135deg, #ff0844, #ffb199)';
    } else if (myTeam === 'computer') {
      teamText.innerText = '🏸 單人對戰 (真實羽球)';
      screenGame.classList.add('mode-computer');
      startRealBadmintonMode();
    }
  });
});

// 單人對戰真實羽球邏輯
function startRealBadmintonMode() {
  gameStatus.innerText = '比賽開始！請用下方按鈕操控！';
  gameStatus.style.background = 'rgba(138,43,226,0.5)';
  
  if (!gameEngine) {
    gameEngine = new BadmintonEngine('game-canvas');
    
    // ── 虛擬按鈕綁定 ─────────────────────────────────────────
    const btnUp    = document.getElementById('btn-up');
    const btnDown  = document.getElementById('btn-down');
    const btnLeft  = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const btnHit   = document.getElementById('btn-hit');

    const bindDirBtn = (btn, key) => {
      if (!btn) return;
      btn.addEventListener('pointerdown',  (e) => { e.preventDefault(); gameEngine.keys[key] = true; });
      btn.addEventListener('pointerup',    (e) => { e.preventDefault(); gameEngine.keys[key] = false; });
      btn.addEventListener('pointerleave', (e) => { e.preventDefault(); gameEngine.keys[key] = false; });
    };

    bindDirBtn(btnUp,    'up');
    bindDirBtn(btnDown,  'down');
    bindDirBtn(btnLeft,  'left');
    bindDirBtn(btnRight, 'right');

    // A 鍵（殺球/撲球）— 每次按下觸發一次 powerHit
    if (btnHit) {
      btnHit.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        gameEngine.playerHit();
      });
    }

    // ── 鍵盤支援（電腦網頁版）────────────────────────────────
    const KEY_MAP = {
      'ArrowUp':    'up',
      'ArrowDown':  'down',
      'ArrowLeft':  'left',
      'ArrowRight': 'right',
      'KeyW': 'up',
      'KeyS': 'down',
      'KeyD': 'right',
    };
    // 攻擊鍵：A / X / Z / Space / Shift / Enter / J / K
    const POWER_KEYS = new Set(['KeyA', 'KeyX', 'Space', 'KeyZ', 'ShiftLeft', 'ShiftRight', 'Enter', 'KeyJ', 'KeyK']);

    document.addEventListener('keydown', (e) => {
      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      // 方向鍵
      if (KEY_MAP[code]) {
        e.preventDefault();
        gameEngine.keys[KEY_MAP[code]] = true;
      } else if (key === 'arrowup' || key === 'w') {
        e.preventDefault();
        gameEngine.keys.up = true;
      } else if (key === 'arrowdown' || key === 's') {
        e.preventDefault();
        gameEngine.keys.down = true;
      } else if (key === 'arrowleft') {
        e.preventDefault();
        gameEngine.keys.left = true;
      } else if (key === 'arrowright' || key === 'd') {
        e.preventDefault();
        gameEngine.keys.right = true;
      }

      // 攻擊 / 殺球鍵 (A / X / Z / Space / Shift / Enter / J / K)
      const isAttackKey = POWER_KEYS.has(code) || 
                          key === 'a' || key === 'x' || key === 'z' || 
                          key === ' ' || key === 'shift' || key === 'enter' ||
                          key === 'j' || key === 'k';

      if (isAttackKey) {
        e.preventDefault();
        gameEngine.playerHit();
      }
    });

    document.addEventListener('keyup', (e) => {
      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      if (KEY_MAP[code]) {
        e.preventDefault();
        gameEngine.keys[KEY_MAP[code]] = false;
      }
      if (key === 'arrowup' || key === 'w')    gameEngine.keys.up = false;
      if (key === 'arrowdown' || key === 's')  gameEngine.keys.down = false;
      if (key === 'arrowleft')                 gameEngine.keys.left = false;
      if (key === 'arrowright' || key === 'd') gameEngine.keys.right = false;
    });

    // 視窗失焦時自動清除所有按鍵，避免卡鍵
    window.addEventListener('blur', () => {
      if (gameEngine) {
        gameEngine.keys = { up: false, down: false, left: false, right: false };
        gameEngine.powerHitBuffer = 0;
      }
    });

    // ── 分數 / 遊戲結束回呼 ──────────────────────────────────
    gameEngine.onScoreUpdate = (pScore, cScore) => {
      myScoreVsEl.innerText = pScore;
      compScoreVsEl.innerText = cScore;
    };
    
    gameEngine.onGameOver = (playerWon) => {
      if (playerWon) {
        gameStatus.innerText = '🎉 勝利！你打敗了電腦！(獲得 50 積分)';
        gameStatus.style.background = 'rgba(0,255,0,0.5)';
        if (uid) {
          update(ref(db, 'players/' + uid), {
            points: increment(50),
            wins: increment(1)
          });
        }
      } else {
        gameStatus.innerText = '💀 失敗！再試一次！';
        gameStatus.style.background = 'rgba(255,0,0,0.5)';
      }
      
      setTimeout(() => {
        if(confirm('要再挑戰一次嗎？')) {
          gameEngine.start();
          gameStatus.innerText = '比賽開始！請用下方按鈕操控！';
          gameStatus.style.background = 'rgba(138,43,226,0.5)';
          myScoreVsEl.innerText = '0';
          compScoreVsEl.innerText = '0';
        } else {
          window.location.href = './lobby.html';
        }
      }, 3000);
    };
  }
  
  gameEngine.start();
}



// Listen to Global Game State (多人連線邏輯)
const stateRef = ref(db, 'gameState');
onValue(stateRef, (snapshot) => {
  if (myTeam === 'computer') return; // 如果是對戰電腦模式，忽略全域狀態
  
  const data = snapshot.val();
  if (!data) return;

  if (data.status === 'waiting') {
    isPlaying = false;
    gameStatus.innerText = '等待大螢幕開始...';
    gameStatus.style.background = 'rgba(255,255,255,0.1)';
    tapBtn.disabled = true;
    tapBtn.innerText = '等待中';
    myTaps = 0;
    myTapsEl.innerText = myTaps;
  } else if (data.status === 'playing') {
    isPlaying = true;
    gameStatus.innerText = '比賽中！瘋狂點擊！';
    gameStatus.style.background = 'rgba(255,0,0,0.5)';
    tapBtn.disabled = false;
    tapBtn.innerText = '揮拍！\n(點擊)';
  } else if (data.status === 'finished') {
    isPlaying = false;
    gameStatus.innerText = '比賽結束！看大螢幕結果';
    gameStatus.style.background = 'rgba(0,255,0,0.5)';
    tapBtn.disabled = true;
  }
});

// Handle Tapping
tapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // Prevent zoom/scroll on mobile
  if (!isPlaying || !myTeam || myTeam === 'computer') return;

  myTaps++;
  
  myTapsEl.innerText = myTaps;
  // Send tap to Firebase for global match
  const updates = {};
  if (myTeam === 'left') {
    updates['gameState/tapsLeft'] = increment(1);
  } else {
    updates['gameState/tapsRight'] = increment(1);
  }
  update(ref(db), updates).catch(err => console.error(err));
});
