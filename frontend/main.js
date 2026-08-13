import { db, ref, onValue, update, increment } from './firebase.js';

let myTeam = null;
let myTaps = 0;
let isPlaying = false;

// 電腦對戰變數
let computerTaps = 0;
let computerInterval = null;
let gameTimer = null;
let timeLeft = 10;

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
      teamText.innerText = '🤖 單人練習 (對戰電腦)';
      tapBtn.style.background = 'linear-gradient(135deg, #8a2be2, #d4a5fa)';
      screenGame.classList.add('mode-computer');
      startComputerMode();
    }
  });
});

// 單人對戰電腦邏輯
function startComputerMode() {
  myTaps = 0;
  computerTaps = 0;
  timeLeft = 10; // 10秒挑戰
  isPlaying = true;
  
  myScoreVsEl.innerText = myTaps;
  compScoreVsEl.innerText = computerTaps;
  
  tapBtn.disabled = false;
  gameStatus.style.background = 'rgba(138,43,226,0.5)';
  
  // 電腦自動點擊 (每秒點 3-6 下)
  computerInterval = setInterval(() => {
    if (!isPlaying) return;
    const clicks = Math.floor(Math.random() * 4) + 3;
    computerTaps += clicks;
    compScoreVsEl.innerText = computerTaps;
  }, 1000);
  
  // 倒數計時
  gameTimer = setInterval(() => {
    timeLeft--;
    gameStatus.innerText = `比賽中！剩下 ${timeLeft} 秒！瘋狂點擊！`;
    
    if (timeLeft <= 0) {
      endComputerMode();
    }
  }, 1000);
  
  gameStatus.innerText = `比賽中！剩下 ${timeLeft} 秒！瘋狂點擊！`;
  tapBtn.innerText = '揮拍！\n(點擊)';
}

function endComputerMode() {
  isPlaying = false;
  clearInterval(computerInterval);
  clearInterval(gameTimer);
  tapBtn.disabled = true;
  
  if (myTaps > computerTaps) {
    gameStatus.innerText = '🎉 勝利！你打敗了電腦！(獲得 50 積分)';
    gameStatus.style.background = 'rgba(0,255,0,0.5)';
    // 加分到排行榜
    if (uid) {
      update(ref(db, 'players/' + uid), {
        points: increment(50),
        wins: increment(1)
      });
    }
  } else if (myTaps < computerTaps) {
    gameStatus.innerText = '💀 失敗！電腦太強了！';
    gameStatus.style.background = 'rgba(255,0,0,0.5)';
  } else {
    gameStatus.innerText = '🤝 平手！';
    gameStatus.style.background = 'rgba(255,165,0,0.5)';
  }
  
  setTimeout(() => {
    if(confirm('要再挑戰一次嗎？')) {
      startComputerMode();
    } else {
      window.location.href = './lobby.html';
    }
  }, 3000);
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
  if (!isPlaying || !myTeam) return;

  myTaps++;
  
  if (myTeam === 'computer') {
    myScoreVsEl.innerText = myTaps;
  } else {
    myTapsEl.innerText = myTaps;
    // Send tap to Firebase for global match
    const updates = {};
    if (myTeam === 'left') {
      updates['gameState/tapsLeft'] = increment(1);
    } else {
      updates['gameState/tapsRight'] = increment(1);
    }
    update(ref(db), updates).catch(err => console.error(err));
  }
});
