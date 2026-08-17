import { PikaPhysics, PikaUserInput } from './physics.js';

/**
 * Pikachu Volleyball Engine - 完美復刻版
 *
 * 原版座標系：
 *   玩家 x,y = 中心點 (64x64 sprite -> 繪製左上角 = x-32, y-32)
 *   球   x,y = 中心點 (40x40 sprite -> 繪製左上角 = x-20, y-20)
 *   地板 y = 248
 *   球落地 y = 252 (BALL_TOUCHING_GROUND_Y_COORD)
 *   玩家站地 y = 244 (PLAYER_TOUCHING_GROUND_Y_COORD)
 *   網柱頂 y = 176 (NET_PILLAR_TOP_TOP_Y_COORD)
 */
export class BadmintonEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // 固定原版解析度 432x304
    this.canvas.width = 432;
    this.canvas.height = 304;

    this.isRunning = false;
    this.roundState = 'idle'; // 'idle' | 'playing' | 'scoring' | 'game_over'
    this.playerScore = 0;
    this.compScore = 0;
    this.maxScore = 15;

    // 物理引擎 (player1=左=玩家, player2=右=AI)
    this.pikaPhysics = new PikaPhysics(false, true);

    // 輸入狀態與緩衝 (讓按鍵手感極度靈敏，不掉指令)
    this.keys = { up: false, down: false, left: false, right: false };
    this.powerHitBuffer = 0; // 緩衝幀數

    // 打擊特效列表 (獨立管理，保證平滑淡出與縮小消失)
    this.punchEffects = [];

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

    // 載入婚禮背景圖
    this.bgImg = new Image();
    this.bgImg.src = './wedding_bg.jpg';
    this.bgLoaded = false;
    this.bgImg.onload = () => {
      this.bgLoaded = true;
    };

    // 浪漫婚禮漂浮花瓣粒子系統 (粉紅/白玫瑰花瓣)
    this.petals = Array.from({ length: 20 }, () => ({
      x: Math.random() * 432,
      y: Math.random() * 248,
      size: 2.5 + Math.random() * 3.5,
      speedX: 0.3 + Math.random() * 0.5,
      speedY: 0.35 + Math.random() * 0.55,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      color: Math.random() > 0.4 ? 'rgba(255, 182, 193, 0.75)' : 'rgba(255, 240, 245, 0.85)'
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
   * 支援 5 幀 (~160ms) 輸入緩衝，大幅提升手感
   */
  playerHit() {
    this.powerHitBuffer = 5;
  }

  /**
   * 新增一個打擊爆炸特效 (會自動由大變小並漸漸透明消失)
   */
  addPunchEffect(x, y) {
    this.punchEffects.push({
      x,
      y,
      radius: 20,
      maxRadius: 20,
      decay: 1.5 // 每幀衰減速度，約 13 幀 (~0.4s) 完全消失
    });
  }

  update() {
    if (!this.isRunning) return;

    // 如果在過場中，不更新球與玩家物理，但畫面動畫繼續跑
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

      // 如果在地面且沒按方向鍵按A，自動向面對方向撲球，提升反應
      if (p1.state === 0 && p1Input.xDirection === 0) {
        p1Input.xDirection = 1; // 左邊玩家預設向右撲
      }
    } else {
      p1Input.powerHit = 0;
    }

    const p2Input = new PikaUserInput(); // AI 自動控制

    // 紀錄執行前的 punchEffectRadius
    const prevPunchRadius = this.pikaPhysics.ball.punchEffectRadius;

    // 執行一幀物理計算
    const isBallTouchingGround = this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);
    const b = this.pikaPhysics.ball;

    // 若物理引擎觸發了新的打擊特效 (例如殺球或落地)
    if (b.punchEffectRadius > 0 && prevPunchRadius === 0) {
      this.addPunchEffect(b.punchEffectX, b.punchEffectY);
      b.punchEffectRadius = 0; // 由我們的特效系統接手管理
    }

    // 當球落地 (得分判定)
    if (isBallTouchingGround) {
      b.isPowerHit = false; // 落地立即取消殘影
      this.addPunchEffect(b.x, 252); // 在落地點生成小爆炸

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
        // 進入得分短暫過場 (畫面不卡頓，雲朵與特效正常淡出)
        this.roundState = 'scoring';
        setTimeout(() => {
          if (!this.isRunning) return;
          const p2Serve = ballX < 216; // 失分方發球
          this.pikaPhysics.player1.initializeForNewRound();
          this.pikaPhysics.player2.initializeForNewRound();
          this.pikaPhysics.ball.initializeForNewRound(p2Serve);
          this.punchEffects = [];
          this.roundState = 'playing';
        }, 1200);
      }
    }
  }

  // ─── 繪圖系統 ──────────────────────────────────────────────

  /**
   * 支援座標、翻轉、自訂寬高與透明度 (alpha)
   */
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

  /** 重複貼 tile 填滿指定區域 */
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

    // ── 1. 浪漫婚禮花園背景 ──
    if (this.bgLoaded) {
      // 繪製婚禮背景圖
      ctx.drawImage(this.bgImg, 0, 0, 432, 248);
    } else {
      ctx.fillStyle = '#70b8e8';
      ctx.fillRect(0, 0, 432, 248);
    }

    // ── 2. 浪漫玫瑰花瓣隨風飄落 ──
    for (const p of this.petals) {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rot += p.rotSpeed;
      if (p.y > 248) {
        p.y = -8;
        p.x = Math.random() * 432;
      }
      if (p.x > 432) {
        p.x = -8;
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

    // ── 3. 地板 (沙灘球場 / 婚禮草地球場) ──
    this.drawTiledSprite('objects/ground_red.png',    0, 248, 432, 16);
    this.drawTiledSprite('objects/ground_yellow.png', 0, 264, 432, 40);

    // ── 4. 網柱 ──
    const netX = 216 - 4; // 網柱寬 8px，中心對齊 216
    this.drawTiledSprite('objects/net_pillar_top.png', netX, 176, 8, 8);
    this.drawTiledSprite('objects/net_pillar.png',     netX, 184, 8, 64);

    // ── 6. 玩家陰影 ──
    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    this.drawSprite('objects/shadow.png', p1.x - 16, 248);
    this.drawSprite('objects/shadow.png', p2.x - 16, 248);

    // ── 7. Pikachu 角色 (座標中心點位移 -32, -32) ──
    const p1State = Math.min(p1.state, 6);
    const p1Frame = p1.frameNumber;
    const p2State = Math.min(p2.state, 6);
    const p2Frame = p2.frameNumber;

    this.drawSprite(`pikachu/pikachu_${p1State}_${p1Frame}.png`, p1.x - 32, p1.y - 32, { flipX: false });
    this.drawSprite(`pikachu/pikachu_${p2State}_${p2Frame}.png`, p2.x - 32, p2.y - 32, { flipX: true });

    // ── 8. 球與殺球殘影 ──
    const b = this.pikaPhysics.ball;

    if (b.isPowerHit && this.roundState === 'playing') {
      // 殺球三段殘影
      this.drawSprite('ball/ball_trail.png', b.previousPreviousX - 20, b.previousPreviousY - 20, { alpha: 0.35 });
      this.drawSprite('ball/ball_trail.png', b.previousX - 20,         b.previousY - 20,         { alpha: 0.65 });
      this.drawSprite('ball/ball_hyper.png', b.x - 20,                 b.y - 20,                 { alpha: 1.0 });
    } else {
      let rot = b.rotation;
      if (rot < 0 || rot > 4) rot = 0;
      this.drawSprite(`ball/ball_${rot}.png`, b.x - 20, b.y - 20);
    }

    // ── 9. 打擊爆炸特效 (漸漸縮小並透明消失) ──
    for (let i = this.punchEffects.length - 1; i >= 0; i--) {
      const fx = this.punchEffects[i];
      fx.radius -= fx.decay;
      const alpha = Math.max(0, fx.radius / fx.maxRadius);

      if (fx.radius <= 0 || alpha <= 0) {
        this.punchEffects.splice(i, 1);
        continue;
      }

      const size = (fx.radius / fx.maxRadius) * 40;
      this.drawSprite('ball/ball_punch.png', fx.x - size / 2, fx.y - size / 2, {
        w: size,
        h: size,
        alpha: alpha
      });
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