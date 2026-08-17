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

    // 原版約 30 FPS
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 30;

    // 回呼
    this.onScoreUpdate = null;
    this.onGameOver = null;
  }

  start() {
    this.isRunning = true;
    this.roundState = 'playing';
    this.playerScore = 0;
    this.compScore = 0;
    this.punchEffects = [];
    this.sparkles = [];
    this.pikaPhysics = new PikaPhysics(false, true);
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
    this.roundState = 'idle';
  }

  /**
   * 觸發攻擊/殺球/撲球指令 (A鍵)
   */
  playerHit() {
    this.powerHitBuffer = 5;
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

    if (this.roundState !== 'playing') {
      return;
    }

    const p1 = this.pikaPhysics.player1;
    const p1Input = new PikaUserInput();

    if (this.keys.left)  p1Input.xDirection = -1;
    if (this.keys.right) p1Input.xDirection = 1;
    if (this.keys.up)    p1Input.yDirection = -1;
    if (this.keys.down)  p1Input.yDirection = 1;

    // 處理 powerHit 緩衝
    if (this.powerHitBuffer > 0) {
      p1Input.powerHit = 1;
      this.powerHitBuffer--;

      // 若在地面且沒按方向鍵按A，自動向右撲球
      if (p1.state === 0 && p1Input.xDirection === 0) {
        p1Input.xDirection = 1;
      }
    } else {
      p1Input.powerHit = 0;
    }

    const p2Input = new PikaUserInput(); // AI 控制

    const prevPunchRadius = this.pikaPhysics.ball.punchEffectRadius;

    // 執行物理幀
    const isBallTouchingGround = this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);
    const b = this.pikaPhysics.ball;

    // 打擊特效觸發
    if (b.punchEffectRadius > 0 && prevPunchRadius === 0) {
      this.addPunchEffect(b.punchEffectX, b.punchEffectY, b.isPowerHit);
      b.punchEffectRadius = 0;
    }

    // 球落地得分
    if (isBallTouchingGround) {
      b.isPowerHit = false;
      this.addPunchEffect(b.x, 252, false);

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
          this.pikaPhysics.ball.initializeForNewRound(p2Serve);
          this.punchEffects = [];
          this.sparkles = [];
          this.roundState = 'playing';
        }, 1200);
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

    // 玩家陰影 (隨跳躍高度動態縮放)
    const p1HeightAboveGround = Math.max(0, 244 - p1.y);
    const p1ShadowScale = Math.max(0.4, 1 - p1HeightAboveGround / 180);
    this.drawSmoothShadow(p1.x, 249, 22 * p1ShadowScale, 7 * p1ShadowScale, 0.4 * p1ShadowScale);

    const p2HeightAboveGround = Math.max(0, 244 - p2.y);
    const p2ShadowScale = Math.max(0.4, 1 - p2HeightAboveGround / 180);
    this.drawSmoothShadow(p2.x, 249, 22 * p2ShadowScale, 7 * p2ShadowScale, 0.4 * p2ShadowScale);

    // 球的地面投影陰影
    const ballHeightAboveGround = Math.max(0, 252 - b.y);
    const ballShadowScale = Math.max(0.3, 1 - ballHeightAboveGround / 220);
    this.drawSmoothShadow(b.x, 251, 14 * ballShadowScale, 5 * ballShadowScale, 0.35 * ballShadowScale);

    // ── 6. Pikachu 角色 (清晰復刻像素繪製) ──
    const p1State = Math.min(p1.state, 6);
    const p1Frame = p1.frameNumber;
    const p2State = Math.min(p2.state, 6);
    const p2Frame = p2.frameNumber;

    this.drawSprite(`pikachu/pikachu_${p1State}_${p1Frame}.png`, p1.x - 32, p1.y - 32, { flipX: false });
    this.drawSprite(`pikachu/pikachu_${p2State}_${p2Frame}.png`, p2.x - 32, p2.y - 32, { flipX: true });

    // ── 7. 排球與殺球光軌 ──
    if (b.isPowerHit && this.roundState === 'playing') {
      this.drawSprite('ball/ball_trail.png', b.previousPreviousX - 20, b.previousPreviousY - 20, { alpha: 0.35 });
      this.drawSprite('ball/ball_trail.png', b.previousX - 20,         b.previousY - 20,         { alpha: 0.65 });
      this.drawSprite('ball/ball_hyper.png', b.x - 20,                 b.y - 20,                 { alpha: 1.0 });
    } else {
      let rot = b.rotation;
      if (rot < 0 || rot > 4) rot = 0;
      this.drawSprite(`ball/ball_${rot}.png`, b.x - 20, b.y - 20);
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