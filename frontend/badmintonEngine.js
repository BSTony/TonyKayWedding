import { PikaPhysics, PikaUserInput, processPlayerMovementAndSetPlayerPosition } from './physics.js';

/**
 * Pikachu Volleyball Engine - 高畫質婚禮復刻版 (KAY & TONY WEDDING)
 *
 * 核心邏輯座標系 (432x304)：
 *   玩家 x,y = 中心點 (64x64 sprite -> 繪製左上角 = x-32, y-32)
 *   球   x,y = 中心點 (40x40 sprite -> 繪製左上角 = x-20, y-20)
 *   地板 y = 248
 *   球落地 y = 252 (BALL_TOUCHING_GROUND_Y_COORD)
 *   玩家站地 y = 244 (PLAYER_TOUCHING_GROUND_Y_COORD)
 *   網柱頂 y = 176 (NET_PILLAR_TOP_TOP_Y_COORD)
 *
 * 渲染解析度：2x Retina HD (864x608)，極致細膩清晰
 */
export class BadmintonEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // 邏輯解析度 (原版物理) 與 2x 高畫質渲染解析度
    this.scale = 2;
    this.logicalWidth = 432;
    this.logicalHeight = 304;
    this.canvas.width = this.logicalWidth * this.scale;
    this.canvas.height = this.logicalHeight * this.scale;

    this.isRunning = false;
    this.roundState = 'idle'; // 'idle' | 'playing' | 'scoring' | 'game_over'
    this.playerScore = 0;
    this.compScore = 0;
    this.maxScore = 15;

    // 物理引擎 (player1=左=玩家, player2=右=AI)
    this.pikaPhysics = new PikaPhysics(false, true);

    // 輸入狀態與緩衝
    this.keys = { up: false, down: false, left: false, right: false };
    this.powerHitBuffer = 0;

    // 特效列表 (爆炸打擊、金色婚禮星芒)
    this.punchEffects = [];
    this.sparkles = [];

    this.loop = this.loop.bind(this);

    // 載入 Sprite Sheet
    this.spriteImg = new Image();
    this.spriteImg.src = './sprite_sheet.png';
    this.spriteData = null;
    this.spriteLoaded = false;
    fetch('./sprite_sheet.json')
      .then(res => res.json())
      .then(data => {
        this.spriteData = data.frames;
        this.spriteLoaded = true;
      });

    // 載入婚禮背景圖 (KAY & TONY WEDDING)
    this.bgImg = new Image();
    this.bgImg.src = './wedding_bg.jpg';
    this.bgLoaded = false;
    this.bgImg.onload = () => {
      this.bgLoaded = true;
    };

    // 浪漫玫瑰花瓣系統 (粉紅/象牙白玫瑰)
    this.petals = Array.from({ length: 24 }, () => ({
      x: Math.random() * 432,
      y: Math.random() * 250,
      size: 2.5 + Math.random() * 3.5,
      speedX: 0.25 + Math.random() * 0.45,
      speedY: 0.3 + Math.random() * 0.5,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.03 + Math.random() * 0.04,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      color: Math.random() > 0.4 ? 'rgba(255, 182, 193, 0.85)' : 'rgba(255, 240, 245, 0.92)'
    }));

    // 遊戲速度放慢 20% (由 30 FPS 調降至 24 FPS，反應更充裕舒適)
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 24;

    // 回呼
    this.onScoreUpdate = null;
    this.onGameOver = null;

    // 多人連線狀態 (權威主機 Host-Authoritative 同步架構)
    this.isMultiplayer = false;
    this.multiplayerRole = 'single'; // 'single' | 'host' | 'guest'
    this.remoteGuestInput = { left: false, right: false, up: false, down: false, powerHit: 0 };
    this.onSendState = null;
    this.onSendInput = null;
    this.lastStateSendTime = 0;
    this.lastInputSendTime = 0;
  }

  start(maxScore = 5, compBoldness = 2) {
    this.isMultiplayer = false;
    this.multiplayerRole = 'single';
    this.maxScore = maxScore;
    this.compBoldness = compBoldness;
    this.isRunning = true;
    this.roundState = 'playing';
    this.playerScore = 0;
    this.compScore = 0;
    this.punchEffects = [];
    this.sparkles = [];
    this.pikaPhysics = new PikaPhysics(false, true);
    this.pikaPhysics.player2.computerBoldness = compBoldness;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  startMultiplayer(role = 'host', maxScore = 5, onSendInput = null, onSendState = null) {
    this.isMultiplayer = true;
    this.multiplayerRole = role;
    this.maxScore = maxScore;
    this.onSendInput = onSendInput;
    this.onSendState = onSendState;
    this.isRunning = true;
    this.roundState = 'playing';
    this.playerScore = 0;
    this.compScore = 0;
    this.punchEffects = [];
    this.sparkles = [];
    this.remoteGuestInput = { left: false, right: false, up: false, down: false, powerHit: 0 };
    this.remoteHostState = null;
    this.lastInputSendTime = 0;
    this.lastStateSendTime = 0;
    this.lastSentInputKey = '';
    this.pikaPhysics = new PikaPhysics(false, false);
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /**
   * 🌟 Firebase 純客戶端模式 (Server-Authoritative via Firebase RTDB)
   * 雙方均不做物理計算，只送輸入、接收伺服器廣播的 state 並渲染
   * @param {string} role - 'p1' 或 'p2'
   * @param {Function} onSendInput - (inputObj) => void，送輸入至 Firebase 的函式
   * @param {number} maxScore
   */
  startFirebaseClient(role = 'p1', onSendInput = null, maxScore = 5) {
    this.isMultiplayer = true;
    this.multiplayerRole = 'firebase';
    this.cloudRole = role;
    this.maxScore = maxScore;
    this.onSendInput = onSendInput;
    this.isRunning = true;
    this.roundState = 'waiting'; // 等待伺服器第一個 state
    this.playerScore = 0;
    this.compScore = 0;
    this.punchEffects = [];
    this.sparkles = [];
    this.remoteHostState = null;
    this.lastInputSendTime = 0;
    this.lastSentInputKey = '';
    this.powerHitBuffer = 0;
    this.pikaPhysics = new PikaPhysics(false, false);
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /**
   * 🌟 雲端專屬伺服器模式 (Server-Authoritative WebSocket - 保留備用)
   */
  startCloudServer(wsUrl, roomId, role = 'p1', maxScore = 5) {
    this.isMultiplayer = true;
    this.multiplayerRole = 'cloud';
    this.cloudRole = role; // 'p1' 或 'p2'
    this.maxScore = maxScore;
    this.isRunning = true;
    this.roundState = 'playing';
    this.playerScore = 0;
    this.compScore = 0;
    this.punchEffects = [];
    this.sparkles = [];
    this.pikaPhysics = new PikaPhysics(false, false);
    this.remoteHostState = null;
    this.lastInputSendTime = 0;
    this.lastSentInputKey = '';

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[Cloud Server] 已連線至雲端伺服器: ${wsUrl}`);
        this.ws.send(JSON.stringify({
          type: 'join',
          roomId,
          role,
          maxScore
        }));
      };

      this.ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          const t = data.t || data.type;

          if (t === 's') { // 雲端權威狀態廣播
            this.receiveRemoteState(data);
          } else if (t === 'game_over') {
            this.roundState = 'game_over';
            const won = (this.cloudRole === 'p1' && data.winner === 'p1') || (this.cloudRole === 'p2' && data.winner === 'p2');
            if (this.onGameOver) this.onGameOver(won);
          }
        } catch (e) {
          console.error('[WS Parse Error]', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Cloud Server] WebSocket 連線異常:', err);
      };

      this.ws.onclose = () => {
        console.log('[Cloud Server] WebSocket 連線關閉');
      };
    } catch (err) {
      console.warn('[Cloud Server] 無法建立 WebSocket 連線:', err);
    }

    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // Host 接收 Guest 傳來的即時搖桿指令
  setRemoteGuestInput(input) {
    if (!input) return;
    this.remoteGuestInput = { ...input };
  }

  // 接收伺服器廣播的權威畫面（適用 cloud, guest, firebase 模式）
  receiveRemoteState(state) {
    if (!state) return;
    this.remoteHostState = state;

    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    const b = this.pikaPhysics.ball;

    const isPredicted = (this.multiplayerRole === 'firebase' || this.multiplayerRole === 'cloud' || this.multiplayerRole === 'guest') && (this.cloudRole !== 'spectate');
    const isP1 = (this.cloudRole === 'p1');
    const isP2 = (this.cloudRole === 'p2');

    // 1. 同步 P1
    if (state.p1) {
      const sX = Number.isFinite(state.p1.x) ? state.p1.x : 36;
      const sY = Number.isFinite(state.p1.y) ? state.p1.y : 244;
      const sState = state.p1.s !== undefined ? state.p1.s : (state.p1.state !== undefined ? state.p1.state : 0);
      const sFrame = state.p1.f !== undefined ? state.p1.f : (state.p1.frameNumber !== undefined ? state.p1.frameNumber : 0);

      if (isPredicted && isP1) {
        // 本地是 P1：本人物理以本地 0ms 預測為主，僅在重大偏差或換局時校正
        const diffX = Math.abs(p1.x - sX);
        const diffY = Math.abs(p1.y - sY);
        if (diffX > 24 || diffY > 24 || this.roundState !== 'playing' || state.newRound) {
          p1.x = sX;
          p1.y = sY;
          p1.state = sState;
          p1.frameNumber = sFrame;
        }
      } else {
        // 本地是 P2 或觀戰：P1 100% 聽從伺服器
        p1.x = sX;
        p1.y = sY;
        p1.state = sState;
        p1.frameNumber = sFrame;
      }
      p1.divingDirection = state.p1.d !== undefined ? state.p1.d : (state.p1.divingDirection || 1);
    }

    // 2. 同步 P2
    if (state.p2) {
      const sX = Number.isFinite(state.p2.x) ? state.p2.x : 396;
      const sY = Number.isFinite(state.p2.y) ? state.p2.y : 244;
      const sState = state.p2.s !== undefined ? state.p2.s : (state.p2.state !== undefined ? state.p2.state : 0);
      const sFrame = state.p2.f !== undefined ? state.p2.f : (state.p2.frameNumber !== undefined ? state.p2.frameNumber : 0);

      if (isPredicted && isP2) {
        // 本地是 P2：本人物理以本地 0ms 預測為主，僅在重大偏差或換局時校正
        const diffX = Math.abs(p2.x - sX);
        const diffY = Math.abs(p2.y - sY);
        if (diffX > 24 || diffY > 24 || this.roundState !== 'playing' || state.newRound) {
          p2.x = sX;
          p2.y = sY;
          p2.state = sState;
          p2.frameNumber = sFrame;
        }
      } else {
        // 本地是 P1 或觀戰：P2 100% 聽從伺服器
        p2.x = sX;
        p2.y = sY;
        p2.state = sState;
        p2.frameNumber = sFrame;
      }
      p2.divingDirection = state.p2.d !== undefined ? state.p2.d : (state.p2.divingDirection || -1);
    }

    // 3. 同步排球 (權威伺服器物理 + 拋物線推算)
    if (state.b) {
      b.x = Number.isFinite(state.b.x) ? state.b.x : 56;
      b.y = Number.isFinite(state.b.y) ? state.b.y : 0;
      b.xVelocity = Number.isFinite(state.b.vx) ? state.b.vx : 0;
      b.yVelocity = Number.isFinite(state.b.vy) ? state.b.vy : 1;
      b.rotation = state.b.r !== undefined ? state.b.r : (state.b.rot || 0);
      b.isPowerHit = state.b.p !== undefined ? !!state.b.p : !!state.b.power;

      this.ballServerPos = {
        x: b.x,
        y: b.y,
        vx: b.xVelocity,
        vy: b.yVelocity,
        time: performance.now()
      };
    }

    // 🌟 換局或得分時：立即重置平滑位置，防止任何飄移/慢速拖曳
    if (state.newRound || state.round === 'scoring' || state.round === 'game_over' || !this.smoothBall) {
      this.smoothP1 = { x: p1.x, y: p1.y };
      this.smoothP2 = { x: p2.x, y: p2.y };
      this.smoothBall = { x: b.x, y: b.y };
    }

    if (state.s1 !== undefined && state.s2 !== undefined) {
      if (this.playerScore !== state.s1 || this.compScore !== state.s2) {
        this.playerScore = state.s1;
        this.compScore = state.s2;
        if (this.onScoreUpdate) this.onScoreUpdate(this.playerScore, this.compScore);
      }
    }

    // 同步局狀態
    if (state.round && state.round !== this.roundState) {
      this.roundState = state.round;
    }

    // 只要達成結算條件或收到結束信號，立即觸發結束事件
    if ((state.round === 'game_over' || this.playerScore >= this.maxScore || this.compScore >= this.maxScore) && this.roundState !== 'game_over') {
      this.roundState = 'game_over';
      if (this.onGameOver) {
        const myScore = this.cloudRole === 'p2' ? state.s2 : state.s1;
        const oppScore = this.cloudRole === 'p2' ? state.s1 : state.s2;
        if (this.onGameOver) this.onGameOver(myScore > oppScore);
      }
    }

    if (state.punch) {
      this.addPunchEffect(state.punch.x, state.punch.y, state.punch.isPower);
    }
  }

  stop() {
    this.isRunning = false;
    this.roundState = 'idle';
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }

  /**
   * 觸發攻擊/殺球/撲球指令 (A鍵)
   */
  playerHit() {
    if (this.roundState !== 'playing') return;
    this.powerHitBuffer = 4;
  }

  /**
   * 新增打擊特效與金色婚禮星芒
   */
  addPunchEffect(x, y, isPower = false) {
    this.punchEffects.push({
      x,
      y,
      radius: 20,
      maxRadius: 20,
      decay: 1.4
    });

    // 產生金色星芒粒子
    const count = isPower ? 12 : 6;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 2 + Math.random() * 3.5;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 0.06 + Math.random() * 0.04
      });
    }
  }

  update() {
    if (!this.isRunning) return;

    const now = performance.now();

    // ── 客戶端多人連線模式 (Firebase / 雲端 WebSocket) ──
    if (this.multiplayerRole === 'firebase' || this.multiplayerRole === 'cloud' || this.multiplayerRole === 'guest') {
      const hit = this.powerHitBuffer > 0 ? 1 : 0;
      const currentInputKey = `${this.keys.left},${this.keys.right},${this.keys.up},${this.keys.down},${hit}`;

      // 1. 發送指令給伺服器 (按鍵變動時立即送出，否則以 30ms 節流)
      if (now - this.lastInputSendTime > 30 || currentInputKey !== this.lastSentInputKey || hit) {
        this.lastInputSendTime = now;
        this.lastSentInputKey = currentInputKey;
        if (hit && this.powerHitBuffer > 0) this.powerHitBuffer--;

        const inputPayload = {
          left: !!this.keys.left,
          right: !!this.keys.right,
          up: !!this.keys.up,
          down: !!this.keys.down,
          powerHit: hit
        };

        if (this.onSendInput) this.onSendInput(inputPayload);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'input',
            role: this.cloudRole,
            input: inputPayload
          }));
        }
      }

      // 2. 🌟 客戶端 0ms 即時預測響應 (Client-Side Input Prediction)
      //    按下按鍵時本地立即運算本人皮卡丘的物理移動與跳躍，手感達到 0 延遲原生級即時！
      if (this.roundState === 'playing') {
        const isP1 = (this.cloudRole === 'p1');
        const myPlayer = isP1 ? this.pikaPhysics.player1 : this.pikaPhysics.player2;
        const otherPlayer = isP1 ? this.pikaPhysics.player2 : this.pikaPhysics.player1;

        const myInput = new PikaUserInput();
        if (this.keys.left)  myInput.xDirection = -1;
        if (this.keys.right) myInput.xDirection = 1;
        if (this.keys.up)    myInput.yDirection = -1;
        if (this.keys.down)  myInput.yDirection = 1;
        myInput.powerHit = hit;
        if (hit && myPlayer.state === 0 && myInput.yDirection === 1 && myInput.xDirection === 0) {
          myInput.xDirection = isP1 ? 1 : -1;
        }

        processPlayerMovementAndSetPlayerPosition(
          myPlayer,
          myInput,
          otherPlayer,
          this.pikaPhysics.ball
        );
      }
      return;
    }

    if (this.roundState !== 'playing') {
      return;
    }

    // ── Host 主機模式 或 單人 AI 模式：權威物理運算 ──
    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;

    const p1Input = new PikaUserInput();
    const p2Input = new PikaUserInput();

    // P1 輸入 (本地玩家)
    if (this.keys.left)  p1Input.xDirection = -1;
    if (this.keys.right) p1Input.xDirection = 1;
    if (this.keys.up)    p1Input.yDirection = -1;
    if (this.keys.down)  p1Input.yDirection = 1;

    if (this.powerHitBuffer > 0) {
      p1Input.powerHit = 1;
      this.powerHitBuffer--;
      if (p1.state === 0 && p1Input.yDirection === 1 && p1Input.xDirection === 0) {
        p1Input.xDirection = 1;
      }
    } else {
      p1Input.powerHit = 0;
    }

    // P2 輸入 (若為多人連線使用 Guest 輸入，否則由 AI 操控)
    if (this.isMultiplayer && this.multiplayerRole === 'host') {
      if (this.remoteGuestInput.left)  p2Input.xDirection = -1;
      if (this.remoteGuestInput.right) p2Input.xDirection = 1;
      if (this.remoteGuestInput.up)    p2Input.yDirection = -1;
      if (this.remoteGuestInput.down)  p2Input.yDirection = 1;
      if (this.remoteGuestInput.powerHit) {
        p2Input.powerHit = 1;
        if (p2.state === 0 && p2Input.yDirection === 1 && p2Input.xDirection === 0) {
          p2Input.xDirection = -1;
        }
      }
    }

    const prevPunchRadius = this.pikaPhysics.ball.punchEffectRadius;

    // 執行權威物理幀
    const isBallTouchingGround = this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);
    const b = this.pikaPhysics.ball;

    let punchEvent = null;

    // 打擊特效觸發
    if (b.punchEffectRadius > 0 && prevPunchRadius === 0) {
      this.addPunchEffect(b.punchEffectX, b.punchEffectY, b.isPowerHit);
      punchEvent = { x: b.punchEffectX, y: b.punchEffectY, isPower: b.isPowerHit };
      b.punchEffectRadius = 0;
    }

    // 球落地得分
    if (isBallTouchingGround) {
      b.isPowerHit = false;
      this.powerHitBuffer = 0;
      this.keys = { up: false, down: false, left: false, right: false };
      this.addPunchEffect(b.x, 252, false);
      punchEvent = { x: b.x, y: 252, isPower: false };

      const ballX = b.x;
      if (ballX < 216) {
        this.compScore++;
      } else {
        this.playerScore++;
      }

      if (this.onScoreUpdate) {
        this.onScoreUpdate(this.playerScore, this.compScore);
      }

      if (this.playerScore >= this.maxScore || this.compScore >= this.maxScore) {
        this.roundState = 'game_over';
        if (this.onGameOver) this.onGameOver(this.playerScore > this.compScore);
        if (this.isMultiplayer && this.multiplayerRole === 'host' && this.onSendState) {
          this.onSendState({
            p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
            p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
            b: {
              x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit,
              px: b.previousX, py: b.previousY, ppx: b.previousPreviousX, ppy: b.previousPreviousY
            },
            s1: this.playerScore,
            s2: this.compScore,
            round: 'game_over',
            punch: punchEvent
          });
        }
      } else {
        this.roundState = 'scoring';
        setTimeout(() => {
          if (!this.isRunning) return;
          const p2Serve = ballX < 216;
          this.pikaPhysics.player1.initializeForNewRound();
          this.pikaPhysics.player2.initializeForNewRound();
          if (!this.isMultiplayer && this.compBoldness !== undefined) {
            this.pikaPhysics.player2.computerBoldness = this.compBoldness;
          }
          this.pikaPhysics.ball.initializeForNewRound(p2Serve);
          this.powerHitBuffer = 0;
          this.keys = { up: false, down: false, left: false, right: false };
          this.punchEffects = [];
          this.sparkles = [];
          this.roundState = 'playing';
        }, 1200);
      }
    }

    // ── Host 廣播即時權威畫面狀態給 Guest ──
    if (this.isMultiplayer && this.multiplayerRole === 'host' && this.onSendState) {
      if (now - this.lastStateSendTime > 40 || punchEvent || isBallTouchingGround) {
        this.lastStateSendTime = now;
        this.onSendState({
          p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
          p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
          b: {
            x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit,
            px: b.previousX, py: b.previousY, ppx: b.previousPreviousX, ppy: b.previousPreviousY
          },
          s1: this.playerScore,
          s2: this.compScore,
          round: this.roundState,
          punch: punchEvent
        });
      }
    }
  }

  // ─── 精緻繪圖系統 ──────────────────────────────────────────

  drawSprite(name, x, y, options = {}) {
    if (!this.spriteLoaded) return;
    const frameData = this.spriteData[name];
    if (!frameData) return;

    const f = frameData.frame;
    const isOldFlip = (typeof options === 'boolean') ? options : false;
    const flipX = (typeof options === 'object' && options.flipX) || isOldFlip;
    const w = (typeof options === 'object' && options.w !== undefined) ? options.w : f.w;
    const h = (typeof options === 'object' && options.h !== undefined) ? options.h : f.h;
    const alpha = (typeof options === 'object' && options.alpha !== undefined) ? options.alpha : 1.0;

    if (alpha <= 0 || w <= 0 || h <= 0) return;

    this.ctx.save();
    if (alpha < 1.0) {
      this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    }
    if (flipX) {
      this.ctx.translate(x + w, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(this.spriteImg, f.x, f.y, f.w, f.h, 0, 0, w, h);
    } else {
      this.ctx.drawImage(this.spriteImg, f.x, f.y, f.w, f.h, x, y, w, h);
    }
    this.ctx.restore();
  }

  updateSmoothPositions() {
    if (!this.isMultiplayer) return;

    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    const b = this.pikaPhysics.ball;

    // 確保 smooth 結構存在
    if (!this.smoothP1) this.smoothP1 = { x: p1.x || 36, y: p1.y || 244 };
    if (!this.smoothP2) this.smoothP2 = { x: p2.x || 396, y: p2.y || 244 };
    if (!this.smoothBall) this.smoothBall = { x: b.x || 56, y: b.y || 100 };

    const targetP1X = Number.isFinite(p1.x) ? p1.x : 36;
    const targetP1Y = Number.isFinite(p1.y) ? p1.y : 244;
    const targetP2X = Number.isFinite(p2.x) ? p2.x : 396;
    const targetP2Y = Number.isFinite(p2.y) ? p2.y : 244;
    const targetBallX = Number.isFinite(b.x) ? b.x : 56;
    const targetBallY = Number.isFinite(b.y) ? b.y : 100;

    // 皮卡丘平滑漸進 (大於 50px 瞬移時直接重置，否則 0.45 Lerp 絲滑跟隨)
    if (Math.abs(this.smoothP1.x - targetP1X) > 50) this.smoothP1.x = targetP1X;
    else this.smoothP1.x += (targetP1X - this.smoothP1.x) * 0.45;

    if (Math.abs(this.smoothP1.y - targetP1Y) > 50) this.smoothP1.y = targetP1Y;
    else this.smoothP1.y += (targetP1Y - this.smoothP1.y) * 0.45;

    if (Math.abs(this.smoothP2.x - targetP2X) > 50) this.smoothP2.x = targetP2X;
    else this.smoothP2.x += (targetP2X - this.smoothP2.x) * 0.45;

    if (Math.abs(this.smoothP2.y - targetP2Y) > 50) this.smoothP2.y = targetP2Y;
    else this.smoothP2.y += (targetP2Y - this.smoothP2.y) * 0.45;

    // 羽毛球 Dead Reckoning 物理外推 (在 33ms 網絡間隙內推算拋物線，消除卡頓與跳躍)
    if (this.ballServerPos && this.roundState === 'playing') {
      const elapsed = Math.max(0, performance.now() - this.ballServerPos.time);
      const tFrames = Math.min(elapsed / 33.333, 1.8);

      const estX = this.ballServerPos.x + this.ballServerPos.vx * tFrames;
      let estY = this.ballServerPos.y + this.ballServerPos.vy * tFrames + 0.5 * 1.0 * tFrames * tFrames;
      if (estY > 252) estY = 252;

      if (Math.abs(this.smoothBall.x - estX) > 60 || Math.abs(this.smoothBall.y - estY) > 60) {
        this.smoothBall.x = estX;
        this.smoothBall.y = estY;
      } else {
        this.smoothBall.x += (estX - this.smoothBall.x) * 0.48;
        this.smoothBall.y += (estY - this.smoothBall.y) * 0.48;
      }
    } else {
      if (Math.abs(this.smoothBall.x - targetBallX) > 50) this.smoothBall.x = targetBallX;
      else this.smoothBall.x += (targetBallX - this.smoothBall.x) * 0.48;

      if (Math.abs(this.smoothBall.y - targetBallY) > 50) this.smoothBall.y = targetBallY;
      else this.smoothBall.y += (targetBallY - this.smoothBall.y) * 0.48;
    }
  }

  drawTiledSprite(name, rectX, rectY, rectW, rectH) {
    if (!this.spriteLoaded) return;
    const frameData = this.spriteData[name];
    if (!frameData) return;
    const f = frameData.frame;
    for (let y = rectY; y < rectY + rectH; y += f.h) {
      for (let x = rectX; x < rectX + rectW; x += f.w) {
        this.ctx.drawImage(this.spriteImg, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
      }
    }
  }

  /**
   * 繪製精緻的動態柔和圓形陰影
   */
  drawSmoothShadow(x, y, radiusX, radiusY, alpha = 0.35) {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.translate(x, y);
    ctx.scale(1, radiusY / radiusX);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
    grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    grad.addColorStop(0.7, `rgba(0, 0, 0, ${alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  draw() {
    if (!this.spriteLoaded) return;

    const ctx = this.ctx;

    ctx.save();
    // 放大至 2x 高解析度
    ctx.scale(this.scale, this.scale);

    // ── 1. 浪漫戶外婚禮花園背景 (KAY & TONY WEDDING) ──
    if (this.bgLoaded) {
      // 繪製高畫質背景 (0~248px)
      ctx.drawImage(this.bgImg, 0, 0, 432, 248);
    } else {
      ctx.fillStyle = '#70b8e8';
      ctx.fillRect(0, 0, 432, 248);
    }

    // ── 2. 浪漫玫瑰花瓣漂浮系統 ──
    for (const p of this.petals) {
      p.wobble += p.wobbleSpeed;
      p.x += p.speedX + Math.sin(p.wobble) * 0.3;
      p.y += p.speedY;
      p.rot += p.rotSpeed;

      if (p.y > 248) {
        p.y = -10;
        p.x = Math.random() * 432;
      }
      if (p.x > 432) {
        p.x = -10;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── 3. 地板 (婚禮沙灘球場，帶有精緻邊緣) ──
    this.drawTiledSprite('objects/ground_red.png',    0, 248, 432, 16);
    this.drawTiledSprite('objects/ground_yellow.png', 0, 264, 432, 40);

    // ── 4. 網柱 ──
    const netX = 216 - 4;
    this.drawTiledSprite('objects/net_pillar_top.png', netX, 176, 8, 8);
    this.drawTiledSprite('objects/net_pillar.png',     netX, 184, 8, 64);

    // ── 5. 動態柔和陰影 ──
    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    const b = this.pikaPhysics.ball;

    const isSmooth = this.isMultiplayer && (this.multiplayerRole === 'firebase' || this.multiplayerRole === 'cloud' || this.multiplayerRole === 'guest');
    const p1X = isSmooth && this.smoothP1 ? this.smoothP1.x : (Number.isFinite(p1.x) ? p1.x : 36);
    const p1Y = isSmooth && this.smoothP1 ? this.smoothP1.y : (Number.isFinite(p1.y) ? p1.y : 244);
    const p2X = isSmooth && this.smoothP2 ? this.smoothP2.x : (Number.isFinite(p2.x) ? p2.x : 396);
    const p2Y = isSmooth && this.smoothP2 ? this.smoothP2.y : (Number.isFinite(p2.y) ? p2.y : 244);
    const bX  = isSmooth && this.smoothBall ? this.smoothBall.x : (Number.isFinite(b.x) ? b.x : 56);
    const bY  = isSmooth && this.smoothBall ? this.smoothBall.y : (Number.isFinite(b.y) ? b.y : 100);

    // 玩家陰影 (隨跳躍高度動態縮放)
    const p1HeightAboveGround = Math.max(0, 244 - p1Y);
    const p1ShadowScale = Math.max(0.4, 1 - p1HeightAboveGround / 180);
    this.drawSmoothShadow(p1X, 249, 22 * p1ShadowScale, 7 * p1ShadowScale, 0.4 * p1ShadowScale);

    const p2HeightAboveGround = Math.max(0, 244 - p2Y);
    const p2ShadowScale = Math.max(0.4, 1 - p2HeightAboveGround / 180);
    this.drawSmoothShadow(p2X, 249, 22 * p2ShadowScale, 7 * p2ShadowScale, 0.4 * p2ShadowScale);

    // 球的地面投影陰影
    const ballHeightAboveGround = Math.max(0, 252 - bY);
    const ballShadowScale = Math.max(0.3, 1 - ballHeightAboveGround / 220);
    this.drawSmoothShadow(bX, 251, 14 * ballShadowScale, 5 * ballShadowScale, 0.35 * ballShadowScale);

    // ── 6. Pikachu 角色 (朝向與撲球方向對齊) ──
    const p1State = Math.min(Number.isFinite(p1.state) ? p1.state : 0, 6);
    const p1Frame = Number.isFinite(p1.frameNumber) ? p1.frameNumber : 0;
    const p2State = Math.min(Number.isFinite(p2.state) ? p2.state : 0, 6);
    const p2Frame = Number.isFinite(p2.frameNumber) ? p2.frameNumber : 0;

    // 計算朝向：若撲球(state 3)或趴地(state 4)，依 divingDirection 決定面向 (1=向右撲, -1=向左撲)
    let p1Flip = false; // 左邊玩家預設面向右邊 (球網)
    if (p1State === 3 || p1State === 4) {
      p1Flip = (p1.divingDirection === -1);
    }

    let p2Flip = true; // 右邊玩家預設面向左邊 (球網)
    if (p2State === 3 || p2State === 4) {
      p2Flip = (p2.divingDirection === -1);
    }

    this.drawSprite(`pikachu/pikachu_${p1State}_${p1Frame}.png`, p1X - 32, p1Y - 32, { flipX: p1Flip });
    this.drawSprite(`pikachu/pikachu_${p2State}_${p2Frame}.png`, p2X - 32, p2Y - 32, { flipX: p2Flip });

    // ── 7. 排球與殺球光軌 ──
    if (b.isPowerHit && this.roundState === 'playing') {
      const ppx = Number.isFinite(b.previousPreviousX) ? b.previousPreviousX : bX;
      const ppy = Number.isFinite(b.previousPreviousY) ? b.previousPreviousY : bY;
      const px = Number.isFinite(b.previousX) ? b.previousX : bX;
      const py = Number.isFinite(b.previousY) ? b.previousY : bY;
      this.drawSprite('ball/ball_trail.png', ppx - 20, ppy - 20, { alpha: 0.35 });
      this.drawSprite('ball/ball_trail.png', px - 20,  py - 20,  { alpha: 0.65 });
      this.drawSprite('ball/ball_hyper.png', bX - 20,  bY - 20,  { alpha: 1.0 });
    } else {
      let rot = Number.isFinite(b.rotation) ? b.rotation : 0;
      if (rot < 0 || rot > 4) rot = 0;
      this.drawSprite(`ball/ball_${rot}.png`, bX - 20, bY - 20);
    }

    // ── 8. 打擊爆炸特效 ──
    for (let i = this.punchEffects.length - 1; i >= 0; i--) {
      const fx = this.punchEffects[i];
      fx.radius -= fx.decay;
      const alpha = Math.max(0, fx.radius / fx.maxRadius);

      if (fx.radius <= 0 || alpha <= 0) {
        this.punchEffects.splice(i, 1);
        continue;
      }

      const size = (fx.radius / fx.maxRadius) * 42;
      this.drawSprite('ball/ball_punch.png', fx.x - size / 2, fx.y - size / 2, {
        w: size,
        h: size,
        alpha: alpha
      });
    }

    // ── 9. 金色婚禮星芒光點 ──
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sp = this.sparkles[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vx *= 0.94;
      sp.vy *= 0.94;
      sp.alpha -= sp.decay;

      if (sp.alpha <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = sp.alpha;
      ctx.fillStyle = '#fde047'; // 金黃色星芒
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  loop(timestamp) {
    if (!this.isRunning) return;

    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    let elapsed = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // 防止切換分頁或背景喚醒時時間累積過大
    if (elapsed > 200) elapsed = 200;

    this.accumulator = (this.accumulator || 0) + elapsed;
    const fixedTimeStep = 1000 / 30;

    while (this.accumulator >= fixedTimeStep) {
      this.update();
      this.accumulator -= fixedTimeStep;
    }

    // 每一幀進行 60 FPS 平滑補間插值 (Lerp)
    this.updateSmoothPositions();

    this.draw();
    requestAnimationFrame(this.loop);
  }

  /**
   * 啟動背景物理計算 (setInterval 驅動，不受 tab 最小化影響)
   * 只在 host multiplayer 模式使用，確保 P1 縮小時物理仍持續廣播給 P2
   */
  startBackgroundPhysics() {
    if (this._bgInterval) return; // 防止重複啟動
    const fixedTimeStep = 1000 / 30;
    this._bgInterval = setInterval(() => {
      if (!this.isRunning) {
        this.stopBackgroundPhysics();
        return;
      }
      this.update();
    }, fixedTimeStep);
  }

  stopBackgroundPhysics() {
    if (this._bgInterval) {
      clearInterval(this._bgInterval);
      this._bgInterval = null;
    }
  }
}

// ── 全域 visibilitychange：Host 背景 setInterval 保活機制 ──
// 當 Host 切換到背景 tab 時，requestAnimationFrame 暫停，改用 setInterval 保持物理廣播
let _globalEngineRef = null;

function setGlobalEngine(engine) {
  _globalEngineRef = engine;
}

document.addEventListener('visibilitychange', () => {
  const engine = _globalEngineRef;
  if (!engine) return;

  const isHostFallback = engine.multiplayerRole === 'host' && engine.isMultiplayer;
  if (document.hidden) {
    if (isHostFallback) {
      engine.startBackgroundPhysics();
    }
  } else {
    engine.stopBackgroundPhysics();
  }
});

export { setGlobalEngine };