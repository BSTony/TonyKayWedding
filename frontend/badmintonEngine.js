import { PikaPhysics, PikaUserInput } from './physics.js';

export class BadmintonEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    
    // 固定經典解析度 432x304
    this.canvas.width = 432;
    this.canvas.height = 304;
    
    this.isRunning = false;
    this.playerScore = 0;
    this.compScore = 0;
    this.maxScore = 15;
    
    this.pikaPhysics = new PikaPhysics(false, true); // 左邊玩家，右邊電腦
    
    this.keys = { up: false, down: false, left: false, right: false, hit: false };
    this.loop = this.loop.bind(this);
    
    // 載入 Sprite Sheet
    this.spriteImg = new Image();
    this.spriteImg.src = './sprite_sheet.png';
    this.spriteData = null;
    fetch('./sprite_sheet.json')
      .then(res => res.json())
      .then(data => {
        this.spriteData = data.frames;
      });

    // 控制禎率大約 30 FPS，還原原版速度
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 30;
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
  
  playerHit() {
    this.keys.hit = true;
    // 點擊一次視為按住一小段時間，確保觸發
    setTimeout(() => { this.keys.hit = false; }, 100);
  }
  
  update() {
    if (!this.isRunning) return;
    
    const p1Input = new PikaUserInput();
    if (this.keys.left) p1Input.xDirection = -1;
    if (this.keys.right) p1Input.xDirection = 1;
    if (this.keys.up) p1Input.yDirection = -1;
    if (this.keys.down) p1Input.yDirection = 1;
    if (this.keys.hit) p1Input.powerHit = 1;
    
    // p2Input 給空值，因為 physicsEngine 內部會處理 AI
    const p2Input = new PikaUserInput(); 
    
    const isBallTouchingGround = this.pikaPhysics.runEngineForNextFrame([p1Input, p2Input]);
    
    if (isBallTouchingGround) {
      if (this.pikaPhysics.ball.x < 216) {
        this.compScore++;
      } else {
        this.playerScore++;
      }
      
      if (this.onScoreUpdate) {
        this.onScoreUpdate(this.playerScore, this.compScore);
      }
      
      if (this.playerScore >= this.maxScore || this.compScore >= this.maxScore) {
        this.isRunning = false;
        if (this.onGameOver) this.onGameOver(this.playerScore > this.compScore);
      } else {
        // 等待 1.5 秒後重新發球
        this.isRunning = false; 
        setTimeout(() => {
          // 失分方發球 (左邊分數增加代表球掉在右邊，右邊發球)
          const p2Serve = this.pikaPhysics.ball.x >= 216;
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

  drawSprite(name, x, y, flipX = false) {
    if (!this.spriteData || !this.spriteImg.complete) return;
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
  
  draw() {
    // 尚未載入圖片時先不畫
    if (!this.spriteData) return;

    // 清空背景
    this.ctx.fillStyle = '#6cb4e4'; // 經典天空藍
    this.ctx.fillRect(0, 0, 432, 304);
    
    // 背景：山脈
    this.drawSprite('objects/mountain.png', 0, 244 - 110);
    
    // 背景：雲朵
    this.drawSprite('objects/cloud.png', 30, 40);
    this.drawSprite('objects/cloud.png', 180, 20);
    this.drawSprite('objects/cloud.png', 320, 60);

    // 地板與網子
    this.drawSprite('objects/ground_red.png', 0, 244);
    this.ctx.fillStyle = '#facc15'; 
    this.ctx.fillRect(0, 244 + 4, 432, 304 - (244 + 4)); // ground_yellow 等效
    
    this.ctx.fillStyle = '#ef4444';
    this.ctx.fillRect(216 - 8, 176, 16, 16); // 網柱紅頭
    this.ctx.fillStyle = '#9ca3af';
    this.ctx.fillRect(216 - 8, 176 + 16, 16, 304 - (176 + 16)); // 網柱灰身

    // 玩家
    const p1 = this.pikaPhysics.player1;
    const p2 = this.pikaPhysics.player2;
    
    this.drawSprite(`pikachu/pikachu_${p1.state}_${p1.frameNumber}.png`, p1.x, p1.y, false);
    // 電腦在右邊，需要水平翻轉圖片
    this.drawSprite(`pikachu/pikachu_${p2.state}_${p2.frameNumber}.png`, p2.x, p2.y, true);

    // 寶貝球
    const b = this.pikaPhysics.ball;
    
    // 如果有扣殺特效
    if (b.punchEffectRadius > 0) {
      this.drawSprite('ball/ball_punch.png', b.punchEffectX - 20, b.punchEffectY - 20);
    }
    
    if (b.isPowerHit) {
      this.drawSprite('ball/ball_trail.png', b.previousPreviousX - 20, b.previousPreviousY - 20);
      this.drawSprite('ball/ball_trail.png', b.previousX - 20, b.previousY - 20);
      this.drawSprite('ball/ball_hyper.png', b.x - 20, b.y - 20);
    } else {
      let rot = b.rotation;
      if (rot === 5) rot = 0; // 避免找不到圖片
      this.drawSprite(`ball/ball_${rot}.png`, b.x - 20, b.y - 20);
    }
  }
  
  loop(timestamp) {
    if (!this.isRunning) return;
    
    const elapsed = timestamp - this.lastFrameTime;
    if (elapsed > this.fpsInterval) {
      this.lastFrameTime = timestamp - (elapsed % this.fpsInterval);
      this.update();
      this.draw();
    }
    
    if (this.isRunning) {
      requestAnimationFrame(this.loop);
    }
  }
}