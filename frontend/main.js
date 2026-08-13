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
    
    // Bind Controls
    const btnHit = document.getElementById('btn-hit');
    const gameCanvas = document.getElementById('game-canvas');
    
    // 點擊畫布設定目標位置
    gameCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = gameCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      
      // 根據 Canvas 縮放比例計算真實 X 座標
      const scaleX = gameEngine.canvas.width / rect.width;
      gameEngine.player.targetX = clickX * scaleX;
    });
    
    btnHit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gameEngine.playerHit();
    });
    
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
        gameStatus.innerText = '💀 失敗！電腦獲得了 5 分！';
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
