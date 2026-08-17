import { PikaPhysics, PikaUserInput } from './physics.js';

/**
 * Pikachu Volleyball Engine - 完美復刻
 * 鍵盤操作：方向鍵 / WASD 移動，A 或 X 或 Space 殺球
 *
 * 原版座標系：
 *   玩家 x,y = 中心點  (64x64 sprite, 所以左上角 = x-32, y-32)
 *   球   x,y = 中心點  (40x40 sprite, 所以左上角 = x-20, y-20)
 *   地板 y = 248 (ground_red 最上緣)
 *   球落地 y = 252 (BALL_TOUCHING_GROUND_Y_COORD)
 *   玩家站地 y = 244 (PLAYER_TOUCHING_GROUND_Y_COORD)
 *   網柱頂 y = 176 (NET_PILLAR_TOP_TOP_Y_COORD)
 */
export class BadmintonEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // 固定原版解析度
    this.canvas.width = 432;
    this.canvas.height = 304;

    this.isRunning = false;
    this.playerScore = 0;
    this.compScore = 0;
    this.maxScore = 15;

    // 物理引擎 (player1=左=玩家, player2=右=AI)
    this.pikaPhysics = new PikaPhysics(false, true);

    // 輸入狀態 (hit 是「non-auto-repeated」的 powerHit，需每幀重置)
    this.keys = { up: false, down: false, left: false, right: false };
    this.powerHitThisFrame = false; // powerHit 只在按下的那一幀有效

    this.loop = this.loop.bind(this);

    // 預載 Sprite Sheet
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

    // 原版 30 FPS
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 30;

    // 雲朵動態位置
    this.clouds = [
      { x: 40, y: 38, speed: 0.3 },
      { x: 160, y: 20, speed: 0.2 },
      { x: 300, y: 50, speed: 0.4 },
    ];

    // 回呼
    this.onScoreUpdate = null;
    this.onGameOver = null;
  }

  start() {
    this.isRunning = true;
    this.playerScore = 0;
    this.compScore = 0;
    this.pikaPhysics = new PikaPhysics(false, true);
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
  }

  /** 玩家按下 A/殺球鍵 — 在這幀觸發 powerHit */
  playerHit() {
    this.powerHitThisFrame = true;
  }

  update() {
    if (!this.isRunning) return;

    const p1Input = new PikaUserInput();
    if (this.keys.left)  p1Input.xDirection = -1;
    if (this.keys.right) p1Input.xDirection = 1;
    if (this.keys.up)    p1Input.yDirection = -1;
    if (this.keys.down)  p1Input.yDirection = 1;
    // powerHit 必須是「非自動重複」的按鍵（只在按下的那一幀為 1）
    p1Input.powerHit = this.powerHitThisFrame ? 1 : 0;
    this.powerHitThisFrame = false; // 清除，避免下幀再觸發

    const p2Input = new PikaUserInput(); // AI 由 physicsEngine 內部處理

    const isBallTouchingGround = this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);

    if (isBallTouchingGround) {
      // 判斷得分：球落在哪邊，對面得分
      const ballX = this.pikaPhysics.ball.x;
      if (ballX < 216) {
        // 球落在左半邊 → 右邊電腦得分
        this.compScore++;
      } else {
        // 球落在右半邊 → 左邊玩家得分
        this.playerScore++;
      }

      if (this.onScoreUpdate) {
        this.onScoreUpdate(this.playerScore, this.compScore);
      }

      if (this.playerScore >= this.maxScore || this.compScore >= this.maxScore) {
        this.isRunning = false;
        if (this.onGameOver) this.onGameOver(this.playerScore > this.compScore);
      } else {
        // 停止，1.5 秒後重新發球
        this.isRunning = false;
        setTimeout(() => {
          // 失分方發球：如果球落在左邊（電腦得分），下一球由電腦（右邊）發
          const p2Serve = ballX < 216;
          this.pikaPhysics.player1.initializeForNewRound();
          this.pikaPhysics.player2.initializeForNewRound();
          this.pikaPhysics.ball.initializeForNewRound(p2Serve);
          this.isRunning = true;
          this.lastFrameTime = performance.now();
          requestAnimationFrame(this.loop);
        }, 1500);
      }
    }
  }

  // ─── 繪圖輔助 ──────────────────────────────────────────────

  drawSprite(name, x, y, flipX = false) {
    if (!this.spriteLoaded) return;
    const frameData = this.spriteData[name];
    if (!frameData) return;

    const f = frameData.frame;
    this.ctx.save();
    if (flipX) {
      this.ctx.translate(x + f.w, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(this.spriteImg, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    } else {
      this.ctx.drawImage(this.spriteImg, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
    }
    this.ctx.restore();
  }

  /** 重複貼一個 tile 填滿指定矩形 */
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

  draw() {
    if (!this.spriteLoaded) return;

    const ctx = this.ctx;

    // ── 天空背景 ──
    ctx.fillStyle = '#70b8e8';
    ctx.fillRect(0, 0, 432, 188);

    // ── 移動的雲朵 ──
    for (const c of this.clouds) {
      c.x = (c.x + c.speed) % 480;
      this.drawSprite('objects/cloud.png', c.x - 48, c.y);
    }

    // ── 山脈 (y=188) ──
    this.drawSprite('objects/mountain.png', 0, 188);

    // ── 地板 (原版: ground_red 在 y=248，然後 ground_yellow 填下方) ──
    this.drawTiledSprite('objects/ground_red.png',    0, 248, 432, 16);
    this.drawTiledSprite('objects/ground_yellow.png', 0, 264, 432, 40);

    // ── 網柱 (net_pillar_top 在 176, net_pillar 重複填 184~248) ──
    const netX = 216 - 4; // 網柱水平中心對齊在 216，柱寬 8
    this.drawTiledSprite('objects/net_pillar_top.png', netX, 176, 8, 8);
    this.drawTiledSprite('objects/net_pillar.png',     netX, 184, 8, 64);

    // ── 玩家陰影 ──
    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    // 陰影 sprite 是 32x8，繪製在腳底
    this.drawSprite('objects/shadow.png', p1.x - 16, 248);
    this.drawSprite('objects/shadow.png', p2.x - 16, 248);

    // ── 玩家 Pikachu ──
    // p.x, p.y = 中心點，sprite 64x64 → 左上角 = (x-32, y-32)
    const p1State = Math.min(p1.state, 6);
    const p1Frame = p1.frameNumber;
    const p2State = Math.min(p2.state, 6);
    const p2Frame = p2.frameNumber;

    // 確認 sprite 存在再繪製
    const p1SpriteName = `pikachu/pikachu_${p1State}_${p1Frame}.png`;
    const p2SpriteName = `pikachu/pikachu_${p2State}_${p2Frame}.png`;
    this.drawSprite(p1SpriteName, p1.x - 32, p1.y - 32, false);
    // 右邊玩家水平翻轉
    this.drawSprite(p2SpriteName, p2.x - 32, p2.y - 32, true);

    // ── 球 ──
    const b = this.pikaPhysics.ball;

    // 殺球特效 (punch effect) — 每幀縮小 2px，直到消失
    if (b.punchEffectRadius > 0) {
      b.punchEffectRadius -= 2; // 模擬原版 view.js 的遞減邏輯
      const r = b.punchEffectRadius;
      if (r > 0) {
        // 以 punchEffectX/Y 為中心，依半徑縮放繪製
        const scale = r / 20;
        const sw = 40 * scale;
        const sh = 40 * scale;
        this.drawSprite('ball/ball_punch.png',
          b.punchEffectX - sw / 2,
          b.punchEffectY - sh / 2
        );
      }
    }

    if (b.isPowerHit) {
      // 殘影
      this.drawSprite('ball/ball_trail.png', b.previousPreviousX - 20, b.previousPreviousY - 20);
      this.drawSprite('ball/ball_trail.png', b.previousX - 20,         b.previousY - 20);
      this.drawSprite('ball/ball_hyper.png', b.x - 20, b.y - 20);
    } else {
      let rot = b.rotation;
      if (rot < 0 || rot > 4) rot = 0; // 防止 frame 5 (hyper glitch 情況)
      this.drawSprite(`ball/ball_${rot}.png`, b.x - 20, b.y - 20);
    }
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