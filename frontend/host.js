import { db, ref, onValue, set, update } from './firebase.js';

const stateRef = ref(db, 'gameState');
const shuttlecock = document.getElementById('shuttlecock');
const scoreLeftEl = document.getElementById('score-left');
const scoreRightEl = document.getElementById('score-right');
const statusText = document.getElementById('status-text');

let isPlaying = false;
let scoreLeft = 0;
let scoreRight = 0;

// Listen to game state
onValue(stateRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  scoreLeft = data.scoreLeft || 0;
  scoreRight = data.scoreRight || 0;
  scoreLeftEl.innerText = scoreLeft;
  scoreRightEl.innerText = scoreRight;
  
  if (data.status === 'waiting') {
    isPlaying = false;
    statusText.innerText = "等待開始... (掃描手機參與)";
    shuttlecock.style.left = '50%';
  } else if (data.status === 'playing') {
    isPlaying = true;
    statusText.innerText = "比賽開始！瘋狂點擊！";
    
    // Calculate shuttlecock position based on tap difference
    const tapsL = data.tapsLeft || 0;
    const tapsR = data.tapsRight || 0;
    
    // Position = 50% + (tapsL - tapsR) * speedFactor
    // We want it to reach 0% (Left loses) or 100% (Right loses)
    // E.g., if one team is ahead by 50 taps, they win.
    const diff = tapsL - tapsR;
    let pos = 50 + (diff * 1.5); // 1.5% per tap difference
    
    if (pos > 100) pos = 100;
    if (pos < 0) pos = 0;
    
    shuttlecock.style.left = pos + '%';
    
    // Check if someone won the point
    if (pos >= 100) {
      // Left wins point
      statusText.innerText = "新郎隊得分！";
      endPoint('left');
    } else if (pos <= 0) {
      // Right wins point
      statusText.innerText = "新娘隊得分！";
      endPoint('right');
    }
    
  } else if (data.status === 'finished') {
    isPlaying = false;
  }
});

function endPoint(winner) {
  if (!isPlaying) return;
  isPlaying = false;
  
  update(stateRef, {
    status: 'finished',
    scoreLeft: winner === 'left' ? scoreLeft + 1 : scoreLeft,
    scoreRight: winner === 'right' ? scoreRight + 1 : scoreRight
  });
  
  setTimeout(() => {
    // Reset taps for next round
    update(stateRef, {
      status: 'waiting',
      tapsLeft: 0,
      tapsRight: 0
    });
  }, 3000);
}

document.getElementById('btn-start').addEventListener('click', () => {
  set(stateRef, {
    status: 'playing',
    scoreLeft: scoreLeft,
    scoreRight: scoreRight,
    tapsLeft: 0,
    tapsRight: 0
  });
});

document.getElementById('btn-reset').addEventListener('click', () => {
  set(stateRef, {
    status: 'waiting',
    scoreLeft: 0,
    scoreRight: 0,
    tapsLeft: 0,
    tapsRight: 0
  });
});
