import { db, ref, onValue, update, increment } from './firebase.js';
import './version.js';
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
