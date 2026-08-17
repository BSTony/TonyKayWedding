import { PikaPhysics, PikaUserInput } from './physics.js';

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
    this.multiplayerRole = role; // 'host' (權威主機，負責物理計算與畫面廣播) 或 'guest' (訪客，發送按鍵並繪製畫面)
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

  // Host 接收 Guest 傳來的即時搖桿指令
  setRemoteGuestInput(input) {
    if (!input) return;
    this.remoteGuestInput = { ...input };
  }

  // Guest 接收 Host 廣播的即時權威畫面與比分 (100% 絕對同步)
  receiveRemoteState(state) {
    if (!state || this.multiplayerRole !== 'guest') return;
    this.remoteHostState = state;

    if (state.s1 !== undefined && state.s2 !== undefined) {
      if (this.playerScore !== state.s1 || this.compScore !== state.s2) {
        this.playerScore = state.s1;
        this.compScore = state.s2;
        if (this.onScoreUpdate) this.onScoreUpdate(this.playerScore, this.compScore);
      }
    }

    if (state.round && state.round !== this.roundState) {
      this.roundState = state.round;
      if (state.round === 'game_over') {
        if (this.onGameOver) this.onGameOver(this.compScore > this.playerScore);
      }
    }

    if (state.punch) {
      this.addPunchEffect(state.punch.x, state.punch.y, state.punch.isPower);
    }
  }

  stop() {
    this.isRunning = false;
    this.roundState = 'idle';
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

    // ── Guest 訪客模式：本地 60 FPS 物理預測 ＋ 平滑網路矯正 ──
    if (this.multiplayerRole === 'guest') {
      // 1. 發送本地即時搖桿指令給 Host 主機 (有動作立即發送，無動作心跳發送)
      if (this.onSendInput) {
        const hit = this.powerHitBuffer > 0 ? 1 : 0;
        const currentInputKey = `${this.keys.left},${this.keys.right},${this.keys.up},${this.keys.down},${hit}`;
        if (now - this.lastInputSendTime > 40 || currentInputKey !== this.lastSentInputKey || hit) {
          this.lastInputSendTime = now;
          this.lastSentInputKey = currentInputKey;
          this.onSendInput({
            left: !!this.keys.left,
            right: !!this.keys.right,
            up: !!this.keys.up,
            down: !!this.keys.down,
            powerHit: hit
          });
        }
      }

      if (this.roundState !== 'playing') {
        return;
      }

      const p1 = this.pikaPhysics.player1;
      const p2 = this.pikaPhysics.player2;
      const b = this.pikaPhysics.ball;

      const p1Input = new PikaUserInput();
      const p2Input = new PikaUserInput();

      // Guest 本地操控 P2 (零延遲 60 FPS 即時物理響應！)
      if (this.keys.left)  p2Input.xDirection = -1;
      if (this.keys.right) p2Input.xDirection = 1;
      if (this.keys.up)    p2Input.yDirection = -1;
      if (this.keys.down)  p2Input.yDirection = 1;

      if (this.powerHitBuffer > 0) {
        p2Input.powerHit = 1;
        this.powerHitBuffer--;
        if (p2.state === 0 && p2Input.yDirection === 1 && p2Input.xDirection === 0) {
          p2Input.xDirection = -1;
        }
      } else {
        p2Input.powerHit = 0;
      }

      // 執行本地 60 FPS 物理運算，確保 60 FPS 絲滑手感
      this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);

      // 2. 接收 Host 廣播進行平滑柔和內插 (Lerp Smoothing)
      if (this.remoteHostState) {
        const hs = this.remoteHostState;
        if (hs.p1) {
          p1.x += (hs.p1.x - p1.x) * 0.45;
          p1.y = hs.p1.y;
          p1.state = hs.p1.state;
          p1.frameNumber = hs.p1.frameNumber;
          p1.divingDirection = hs.p1.divingDirection || 1;
        }
        if (hs.b) {
          const dist = Math.hypot(b.x - hs.b.x, b.y - hs.b.y);
          if (dist > 40) {
            b.x = hs.b.x;
            b.y = hs.b.y;
            if (hs.b.vx !== undefined) b.xVelocity = hs.b.vx;
            if (hs.b.vy !== undefined) b.yVelocity = hs.b.vy;
          } else {
            b.x += (hs.b.x - b.x) * 0.35;
            b.y += (hs.b.y - b.y) * 0.35;
          }
          b.rotation = hs.b.rot || 0;
          b.isPowerHit = !!hs.b.power;
          b.previousX = hs.b.px !== undefined ? hs.b.px : b.x;
          b.previousY = hs.b.py !== undefined ? hs.b.py : b.y;
          b.previousPreviousX = hs.b.ppx !== undefined ? hs.b.ppx : b.x;
          b.previousPreviousY = hs.b.ppy !== undefined ? hs.b.ppy : b.y;
        }
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

    const p1X = Number.isFinite(p1.x) ? p1.x : 36;
    const p1Y = Number.isFinite(p1.y) ? p1.y : 244;
    const p2X = Number.isFinite(p2.x) ? p2.x : 396;
    const p2Y = Number.isFinite(p2.y) ? p2.y : 244;
    const bX = Number.isFinite(b.x) ? b.x : 56;
    const bY = Number.isFinite(b.y) ? b.y : 100;

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

    const elapsed = timestamp - this.lastFrameTime;
    if (elapsed >= this.fpsInterval) {
      this.lastFrameTime = timestamp - (elapsed % this.fpsInterval);
      this.update();
      this.draw();
    }

    requestAnimationFrame(this.loop);
  }
}