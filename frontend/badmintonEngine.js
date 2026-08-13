export class BadmintonEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    
    // Resize canvas
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    // Game State
    this.isRunning = false;
    this.playerScore = 0;
    this.compScore = 0;
    
    this.maxScore = 5; // First to 5 wins

    // Physics constants (調降重力讓球飛慢一點)
    this.gravity = 0.15;
    this.friction = 0.99;

    // Entities
    this.player = this.createPlayer(true);
    this.computer = this.createPlayer(false);
    this.ball = this.createBall();
    this.net = this.createNet();

    // Input state
    this.keys = { left: false, right: false, hit: false };
    
    // Start loop
    this.loop = this.loop.bind(this);
  }

  resize() {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    this.groundY = this.canvas.height - 20;
  }

  createPlayer(isLeft) {
    return {
      x: isLeft ? 50 : this.canvas.width - 50,
      y: this.groundY - 60,
      width: 30,
      height: 60,
      vx: 0,
      vy: 0,
      speed: 6, // 加快人物移動速度
      isLeft: isLeft,
      color: isLeft ? '#4facfe' : '#ff0844',
      isSwinging: false,
      swingTimer: 0,
      targetX: null // 新增目標 X 座標
    };
  }

  createBall() {
    return {
      x: 50,
      y: 50,
      radius: 8,
      vx: 0,
      vy: 0,
      active: false
    };
  }

  createNet() {
    return {
      x: this.canvas.width / 2 - 3,
      y: this.groundY - 100,
      width: 6,
      height: 100
    };
  }

  start() {
    this.isRunning = true;
    this.playerScore = 0;
    this.compScore = 0;
    this.serve(true);
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
  }

  serve(playerServes) {
    // 發球時把球拋高，給玩家反應時間
    this.ball.x = playerServes ? this.player.x : this.computer.x;
    this.ball.y = this.player.y - 60;
    this.ball.vx = 0;
    this.ball.vy = -6; // 往上拋
    this.ball.active = true;
  }

  update() {
    if (!this.isRunning) return;

    // Player Movement (混合按鍵與點擊目標移動)
    if (this.player.targetX !== null) {
      if (Math.abs(this.player.x - this.player.targetX) <= this.player.speed) {
        this.player.x = this.player.targetX;
        this.player.vx = 0;
        this.player.targetX = null; // 到達目標
      } else if (this.player.x < this.player.targetX) {
        this.player.vx = this.player.speed;
      } else {
        this.player.vx = -this.player.speed;
      }
    } else {
      if (this.keys.left) this.player.vx = -this.player.speed;
      else if (this.keys.right) this.player.vx = this.player.speed;
      else this.player.vx *= 0.8;
    }

    this.player.x += this.player.vx;
    
    // Player Boundary
    if (this.player.x < 0) this.player.x = 0;
    if (this.player.x > this.net.x - this.player.width) this.player.x = this.net.x - this.player.width;

    // Swing timer
    if (this.player.isSwinging) {
      this.player.swingTimer--;
      if (this.player.swingTimer <= 0) this.player.isSwinging = false;
    }
    if (this.computer.isSwinging) {
      this.computer.swingTimer--;
      if (this.computer.swingTimer <= 0) this.computer.isSwinging = false;
    }

    // AI Logic (Simple tracking)
    const targetX = this.ball.x > this.net.x ? this.ball.x : this.canvas.width - 50;
    
    if (this.computer.x < targetX - 10) this.computer.vx = this.computer.speed * 0.7;
    else if (this.computer.x > targetX + 10) this.computer.vx = -this.computer.speed * 0.7;
    else this.computer.vx *= 0.8;

    this.computer.x += this.computer.vx;
    
    if (this.computer.x < this.net.x + this.net.width) this.computer.x = this.net.x + this.net.width;
    if (this.computer.x > this.canvas.width) this.computer.x = this.canvas.width;

    // AI Hit Logic (大幅放寬 AI 擊球判定)
    if (this.ball.x > this.net.x && this.ball.y > this.computer.y - 120 && this.ball.y < this.computer.y + 40) {
      if (Math.abs(this.ball.x - this.computer.x) < 80 && !this.computer.isSwinging && this.ball.vy > 0) {
        this.hitBall(this.computer);
      }
    }

    // Ball Physics
    if (this.ball.active) {
      this.ball.vy += this.gravity;
      this.ball.vx *= this.friction; // air resistance
      this.ball.vy *= this.friction;
      
      this.ball.x += this.ball.vx;
      this.ball.y += this.ball.vy;

      // Net Collision
      if (this.ball.x > this.net.x - this.ball.radius && this.ball.x < this.net.x + this.net.width + this.ball.radius) {
        if (this.ball.y > this.net.y) {
          this.ball.vx *= -0.5;
          this.ball.x = this.ball.x < this.net.x ? this.net.x - this.ball.radius : this.net.x + this.net.width + this.ball.radius;
        }
      }

      // Ground Collision (Score!)
      if (this.ball.y > this.groundY - this.ball.radius) {
        this.ball.y = this.groundY - this.ball.radius;
        this.ball.vy = 0;
        this.ball.vx = 0;
        this.ball.active = false;
        
        // Determine winner of rally
        if (this.ball.x < this.net.x) {
          this.compScore++;
          setTimeout(() => this.serve(false), 1500); // 延長發球間隔讓玩家準備
        } else {
          this.playerScore++;
          setTimeout(() => this.serve(true), 1500);
        }
        
        if (this.onScoreUpdate) this.onScoreUpdate(this.playerScore, this.compScore);
        
        // Check match end
        if (this.playerScore >= this.maxScore || this.compScore >= this.maxScore) {
          this.isRunning = false;
          if (this.onGameOver) this.onGameOver(this.playerScore > this.compScore);
        }
      }
      
      // Wall Collision
      if (this.ball.x < 0) { this.ball.x = 0; this.ball.vx *= -0.5; }
      if (this.ball.x > this.canvas.width) { this.ball.x = this.canvas.width; this.ball.vx *= -0.5; }
    }
  }

  playerHit() {
    if (!this.isRunning) return;
    this.player.isSwinging = true;
    this.player.swingTimer = 15; // 延長揮拍動畫
    
    // 放寬玩家擊球判定：只要球在玩家附近 (X 距離 100，Y 在頭頂附近) 就一定打得到
    const dx = Math.abs(this.ball.x - this.player.x);
    const dy = this.ball.y - this.player.y;
    
    // 如果球在玩家前方/後方不遠，且高度不會太低
    if (dx < 100 && dy > -150 && dy < 50) {
      this.hitBall(this.player);
    }
  }

  hitBall(hitter) {
    hitter.isSwinging = true;
    hitter.swingTimer = 15;
    
    // 打高遠球，確保一定過網
    const hitPowerX = 10 + Math.random() * 3;
    const hitPowerY = -12 - Math.random() * 3;
    
    if (hitter.isLeft) {
      this.ball.vx = hitPowerX;
      this.ball.vy = hitPowerY;
    } else {
      this.ball.vx = -hitPowerX;
      this.ball.vy = hitPowerY;
    }
    
    // 強制把球拉回拍子高度再飛出，避免穿模
    this.ball.y = hitter.y - 40;
  }

  draw() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw Ground
    this.ctx.fillStyle = '#81c784';
    this.ctx.fillRect(0, this.groundY, this.canvas.width, this.canvas.height - this.groundY);

    // Draw Net
    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(this.net.x, this.net.y, this.net.width, this.net.height);

    // Draw Player
    this.ctx.fillStyle = this.player.color;
    this.ctx.fillRect(this.player.x - this.player.width/2, this.player.y - this.player.height, this.player.width, this.player.height);
    // Draw Racket (Player)
    if (this.player.isSwinging) {
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.moveTo(this.player.x, this.player.y - this.player.height/2);
      this.ctx.lineTo(this.player.x + 40, this.player.y - this.player.height - 20);
      this.ctx.stroke();
    }

    // Draw Computer
    this.ctx.fillStyle = this.computer.color;
    this.ctx.fillRect(this.computer.x - this.computer.width/2, this.computer.y - this.computer.height, this.computer.width, this.computer.height);
    // Draw Racket (Computer)
    if (this.computer.isSwinging) {
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.moveTo(this.computer.x, this.computer.y - this.computer.height/2);
      this.ctx.lineTo(this.computer.x - 40, this.computer.y - this.computer.height - 20);
      this.ctx.stroke();
    }

    // Draw Ball
    this.ctx.fillStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = '#ddd';
    this.ctx.stroke();
  }

  loop() {
    this.update();
    this.draw();
    if (this.isRunning || this.ball.active) {
      requestAnimationFrame(this.loop);
    }
  }
}
