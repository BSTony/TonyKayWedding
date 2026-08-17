import { db, ref, onValue, update, increment } from './firebase.js';
import { BadmintonEngine } from './badmintonEngine.js';
import { calculateRankedPoints } from './rankedScore.js';

const uid = localStorage.getItem('wbc_uid') || ('user_' + Math.floor(Math.random() * 1000000));
const nickname = localStorage.getItem('wbc_nickname') || '新郎';
localStorage.setItem('wbc_uid', uid);
localStorage.setItem('wbc_nickname', nickname);

let myPoints = Number(localStorage.getItem('wbc_points')) || 0;

if (uid) {
  onValue(ref(db, 'players/' + uid), snap => {
    const d = snap.val();
    if (d && d.points !== undefined) {
      myPoints = d.points;
      localStorage.setItem('wbc_points', myPoints);
    }
  });
}

// 取得遊戲模式 (tournament = 錦標賽, quick = 快速對戰)
const urlParams = new URLSearchParams(window.location.search);
const gameMode = urlParams.get('mode') || 'quick';

// DOM 元素
const playerNameBadge = document.getElementById('player-name-badge');
const opponentNameBadge = document.getElementById('opponent-name-badge');
const myScoreVsEl = document.getElementById('my-score-vs');
const compScoreVsEl = document.getElementById('comp-score-vs');
const tournamentHud = document.getElementById('tournament-hud');
const tournamentRoundTitle = document.getElementById('tournament-round-title');

const matchModal = document.getElementById('match-modal');
const modalIcon = document.getElementById('modal-icon');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalBtnNext = document.getElementById('modal-btn-next');

// 設定玩家名稱
playerNameBadge.textContent = '👦 ' + nickname;

// 錦標賽關卡設定
const TOURNAMENT_ROUNDS = [
  {
    stageName: '第一輪 · 八強晉級賽',
    opponentName: '🥉【青銅初階】AI',
    targetScore: 5,
    boldness: 1,
    rewardPoints: 50,
    rewardWins: 1
  },
  {
    stageName: '第二輪 · 四強準決賽',
    opponentName: '🥇【黃金大師】AI',
    targetScore: 5,
    boldness: 3,
    rewardPoints: 100,
    rewardWins: 1
  },
  {
    stageName: '最終決賽 · 總冠軍爭奪',
    opponentName: '👑【最強王者】新娘 KAY 👑',
    targetScore: 7,
    boldness: 5,
    rewardPoints: 300,
    rewardWins: 2
  }
];

let currentTournamentRound = 0;
let gameEngine = null;

// 初始化遊戲引擎
function initGameEngine() {
  if (!gameEngine) {
    gameEngine = new BadmintonEngine('game-canvas');

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

    // ── 左手 360° 八向圓盤虛擬搖桿 ──
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

    // ── 鍵盤監聽 ──
    const KEY_MAP = {
      'ArrowUp':    'up',
      'ArrowDown':  'down',
      'ArrowLeft':  'left',
      'ArrowRight': 'right',
      'KeyW': 'up',
      'KeyS': 'down',
      'KeyA': 'left',
      'KeyD': 'right',
    };
    const JUMP_KEYS = new Set(['KeyW', 'ArrowUp', 'Space']);
    const POWER_KEYS = new Set(['KeyJ', 'KeyK', 'KeyX', 'KeyZ', 'ShiftLeft', 'ShiftRight', 'Enter']);

    document.addEventListener('keydown', (e) => {
      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      if (KEY_MAP[code] && gameEngine) {
        e.preventDefault();
        gameEngine.keys[KEY_MAP[code]] = true;
      }
      if (JUMP_KEYS.has(code) && gameEngine) {
        e.preventDefault();
        gameEngine.keys.up = true;
      }
      if ((POWER_KEYS.has(code) || key === 'a' || key === 'j') && gameEngine) {
        e.preventDefault();
        gameEngine.playerHit();
      }
    });

    document.addEventListener('keyup', (e) => {
      const code = e.code;
      if (KEY_MAP[code] && gameEngine) {
        e.preventDefault();
        gameEngine.keys[KEY_MAP[code]] = false;
      }
      if (JUMP_KEYS.has(code) && gameEngine) {
        e.preventDefault();
        gameEngine.keys.up = false;
      }
    });

    window.addEventListener('blur', () => {
      if (gameEngine) {
        gameEngine.keys = { up: false, down: false, left: false, right: false };
        gameEngine.powerHitBuffer = 0;
      }
    });

    // ── 分數更新回呼 ──
    gameEngine.onScoreUpdate = (pScore, cScore) => {
      myScoreVsEl.innerText = pScore;
      compScoreVsEl.innerText = cScore;
    };

    // ── 遊戲結束回呼 ──
    gameEngine.onGameOver = (playerWon) => {
      handleMatchResult(playerWon);
    };
  }
}

// 開始比賽回合
function startCurrentMatch() {
  matchModal.style.display = 'none';
  myScoreVsEl.innerText = '0';
  compScoreVsEl.innerText = '0';

  if (gameMode === 'tournament') {
    const roundConfig = TOURNAMENT_ROUNDS[currentTournamentRound];
    tournamentHud.style.display = 'block';
    tournamentRoundTitle.innerText = roundConfig.stageName;
    opponentNameBadge.innerText = roundConfig.opponentName;
    gameEngine.start(roundConfig.targetScore, roundConfig.boldness);
  } else {
    // 快速對戰模式 (直接打新娘 KAY)
    tournamentHud.style.display = 'none';
    opponentNameBadge.innerText = '👰 新娘 KAY';
    gameEngine.start(5, 2);
  }
}

// 處理比賽結束結果
function handleMatchResult(playerWon) {
  if (gameMode === 'tournament') {
    const roundConfig = TOURNAMENT_ROUNDS[currentTournamentRound];

    if (playerWon) {
      // 獲勝
      if (uid) {
        update(ref(db, 'players/' + uid), {
          points: increment(roundConfig.rewardPoints),
          wins: increment(roundConfig.rewardWins)
        }).catch(err => console.error(err));
      }

      if (currentTournamentRound < TOURNAMENT_ROUNDS.length - 1) {
        // 晉級下一輪
        modalIcon.innerText = '🎉';
        modalTitle.innerText = `勝利！晉級${TOURNAMENT_ROUNDS[currentTournamentRound + 1].stageName.split('·')[1]}！`;
        modalDesc.innerText = `成功擊敗了 ${roundConfig.opponentName}！獲得 +${roundConfig.rewardPoints} 積分！`;
        modalBtnNext.innerText = '晉級下一輪 ➔';
        modalBtnNext.onclick = () => {
          currentTournamentRound++;
          startCurrentMatch();
        };
      } else {
        // 總冠軍！
        modalIcon.innerText = '👑';
        modalTitle.innerText = '🏆 恭喜榮獲婚禮大賽總冠軍！';
        modalDesc.innerText = `成功擊敗新娘 KAY 贏得最高榮耀！獲得 +${roundConfig.rewardPoints} 積分與冠軍獎盃！`;
        modalBtnNext.innerText = '查看排行榜 🏆';
        modalBtnNext.onclick = () => {
          window.location.href = './ranking.html';
        };
      }
    } else {
      // 錦標賽落敗
      modalIcon.innerText = '💀';
      modalTitle.innerText = '比賽惜敗！';
      modalDesc.innerText = `未能擊敗 ${roundConfig.opponentName}。再接再厲！`;
      modalBtnNext.innerText = '重新挑戰本輪 🔄';
      modalBtnNext.onclick = () => {
        startCurrentMatch();
      };
    }
  } else {
    // 挑戰電腦 (新娘 KAY) 模式
    const kayPoints = 15;
    if (playerWon) {
      const scoreResult = calculateRankedPoints(myPoints, kayPoints);
      if (uid) {
        update(ref(db, 'players/' + uid), {
          points: increment(scoreResult.winnerDelta),
          wins: increment(1)
        }).catch(err => console.error(err));
      }
      modalIcon.innerText = '🎉';
      modalTitle.innerText = '勝利！你打敗了新娘 KAY！';
      modalDesc.innerText = `精湛的球技！獲得 +${scoreResult.winnerDelta} 積分！`;
    } else {
      const scoreResult = calculateRankedPoints(kayPoints, myPoints);
      if (uid) {
        update(ref(db, 'players/' + uid), {
          points: increment(scoreResult.loserDelta)
        }).catch(err => console.error(err));
      }
      modalIcon.innerText = '💀';
      modalTitle.innerText = '新娘 KAY 贏得了這場比賽！';
      modalDesc.innerText = `扣除 ${Math.abs(scoreResult.loserDelta)} 積分 (最低 0 分)。要再挑戰一次嗎？`;
    }
    modalBtnNext.innerText = '再戰一場 🏸';
    modalBtnNext.onclick = () => {
      startCurrentMatch();
    };
  }

  matchModal.style.display = 'flex';
}

// 頁面載入直接初始化並開打！
initGameEngine();
startCurrentMatch();
