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

    // Physics constants (皮卡丘排球版)
    this.gravity = 0.4;
    this.friction = 1; // 完美彈性，無阻力
    this.playerGravity = 0.6;
    this.jumpForce = -12;

    // Entities
    this.player = this.createPlayer(true);
    this.computer = this.createPlayer(false);
    this.ball = this.createBall();
    this.net = this.createNet();

    // Input state
    this.keys = { up: false, down: false, left: false, right: false, hit: false };
    
    // Start loop
    this.loop = this.loop.bind(this);
  }

  resize() {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    this.groundY = this.canvas.height - 20;
    
    // Update positions
    if (this.player) this.player.y = this.groundY - this.player.height;
    if (this.computer) this.computer.y = this.groundY - this.computer.height;
    if (this.net) {
      this.net.x = this.canvas.width / 2 - 3;
      this.net.y = this.groundY - 100;
    }
  }

  createPlayer(isLeft) {
    return {
      x: isLeft ? 100 : this.canvas.width - 100,
      y: 0,
      width: 40,
      height: 60,
      vx: 0,
      vy: 0,
      speed: 7,
      isLeft: isLeft,
      color: isLeft ? '#4facfe' : '#ff0844',
      isSwinging: false,
      swingTimer: 0,
      isGrounded: false
    };
  }

  createBall() {
    return {
      x: 50,
      y: 50,
      radius: 12,
      vx: 0,
      vy: 0,
      active: false
    };
  }

  createNet() {
    return {
      x: this.canvas.width / 2 - 3,
      y: 0,
      width: 6,
      height: 100
    };
  }

  start() {
    this.resize();
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
    this.ball.x = playerServes ? 100 : this.canvas.width - 100;
    this.ball.y = 50; // 發球從高空掉下
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.active = true;
    
    // 重置玩家位置
    this.player.x = 100;
    this.computer.x = this.canvas.width - 140;
  }
  
  checkPlayerBallCollision(p) {
    // 簡單的 AABB 碰撞加上頭部圓形碰撞模擬
    const distX = Math.abs(this.ball.x - (p.x + p.width/2));
    const distY = Math.abs(this.ball.y - (p.y + p.height/2));

    if (distX <= (p.width/2 + this.ball.radius) && distY <= (p.height/2 + this.ball.radius)) {
      // 發生碰撞
      // 判斷撞擊位置決定反彈方向
      if (this.ball.y < p.y) {
        // 頂球 (碰到頭)
        this.ball.vy = -10;
        this.ball.vx = p.vx * 0.5 + (this.ball.x < p.x + p.width/2 ? -5 : 5);
      } else {
        // 側邊相撞
        this.ball.vx *= -1;
        this.ball.x += this.ball.vx; 
      }
      return true;
    }
    return false;
  }

  update() {
    if (!this.isRunning) return;

    // --- Player Movement ---
    if (this.keys.left) this.player.vx = -this.player.speed;
    else if (this.keys.right) this.player.vx = this.player.speed;
    else this.player.vx = 0;
    
    if (this.keys.up && this.player.isGrounded) {
      this.player.vy = this.jumpForce;
      this.player.isGrounded = false;
    }

    // Gravity for player
    this.player.vy += this.playerGravity;
    this.player.x += this.player.vx;
    this.player.y += this.player.vy;
    
    // Floor collision
    if (this.player.y > this.groundY - this.player.height) {
      this.player.y = this.groundY - this.player.height;
      this.player.vy = 0;
      this.player.isGrounded = true;
    }
    
    // Boundary collision
    if (this.player.x < 0) this.player.x = 0;
    if (this.player.x > this.net.x - this.player.width) this.player.x = this.net.x - this.player.width;

    // --- AI Logic (Pikachu Style) ---
    // AI 簡單邏輯：球在自己的半場就去追球，否則回到中心
    const targetX = this.ball.x > this.net.x ? this.ball.x - this.computer.width/2 : this.canvas.width - 100;
    
    if (this.computer.x + this.computer.width/2 < targetX - 15) this.computer.vx = this.computer.speed * 0.9;
    else if (this.computer.x + this.computer.width/2 > targetX + 15) this.computer.vx = -this.computer.speed * 0.9;
    else this.computer.vx = 0;

    // 電腦跳躍頂球 (如果球在正上方且快掉下來)
    if (this.ball.x > this.net.x && this.ball.y > this.groundY - 150 && this.ball.y < this.groundY - 60) {
      if (Math.abs(this.ball.x - (this.computer.x + this.computer.width/2)) < 30 && this.computer.isGrounded) {
        this.computer.vy = this.jumpForce;
        this.computer.isGrounded = false;
      }
    }
    
    // 電腦殺球 (在空中且球靠近)
    if (!this.computer.isGrounded && this.ball.y < this.computer.y && Math.abs(this.ball.x - this.computer.x) < 50) {
      if (Math.random() < 0.1 && !this.computer.isSwinging) {
        this.hitBall(this.computer);
      }
    }

    this.computer.vy += this.playerGravity;
    this.computer.x += this.computer.vx;
    this.computer.y += this.computer.vy;
    
    if (this.computer.y > this.groundY - this.computer.height) {
      this.computer.y = this.groundY - this.computer.height;
      this.computer.vy = 0;
      this.computer.isGrounded = true;
    }
    
    if (this.computer.x < this.net.x + this.net.width) this.computer.x = this.net.x + this.net.width;
    if (this.computer.x > this.canvas.width - this.computer.width) this.computer.x = this.canvas.width - this.computer.width;


    // --- Swing Timers ---
    if (this.player.isSwinging) {
      this.player.swingTimer--;
      if (this.player.swingTimer <= 0) this.player.isSwinging = false;
    }
    if (this.computer.isSwinging) {
      this.computer.swingTimer--;
      if (this.computer.swingTimer <= 0) this.computer.isSwinging = false;
    }

    // --- Ball Physics ---
    if (this.ball.active) {
      this.ball.vy += this.gravity;
      // No friction! Perfect elastic bouncing
      
      this.ball.x += this.ball.vx;
      this.ball.y += this.ball.vy;

      // Wall Collision
      if (this.ball.x < this.ball.radius) {
        this.ball.x = this.ball.radius;
        this.ball.vx *= -1;
      }
      if (this.ball.x > this.canvas.width - this.ball.radius) {
        this.ball.x = this.canvas.width - this.ball.radius;
        this.ball.vx *= -1;
      }
      
      // Ceiling Collision
      if (this.ball.y < this.ball.radius) {
        this.ball.y = this.ball.radius;
        this.ball.vy *= -1;
      }

      // Net Collision
      if (this.ball.x > this.net.x - this.ball.radius && this.ball.x < this.net.x + this.net.width + this.ball.radius) {
        if (this.ball.y > this.net.y) {
          this.ball.vx *= -1; // 撞網反彈
          this.ball.x = this.ball.x < this.net.x ? this.net.x - this.ball.radius : this.net.x + this.net.width + this.ball.radius;
        }
      }
      
      // Player / AI Collision
      this.checkPlayerBallCollision(this.player);
      this.checkPlayerBallCollision(this.computer);

      // Ground Collision (Score!)
      if (this.ball.y > this.groundY - this.ball.radius) {
        this.ball.y = this.groundY - this.ball.radius;
        this.ball.vy = 0;
        this.ball.vx = 0;
        this.ball.active = false;
        
        if (this.ball.x < this.net.x) {
          this.compScore++;
          setTimeout(() => this.serve(false), 1500);
        } else {
          this.playerScore++;
          setTimeout(() => this.serve(true), 1500);
        }
        
        if (this.onScoreUpdate) this.onScoreUpdate(this.playerScore, this.compScore);
        
        if (this.playerScore >= this.maxScore || this.compScore >= this.maxScore) {
          this.isRunning = false;
          if (this.onGameOver) this.onGameOver(this.playerScore > this.compScore);
        }
      }
    }
  }

  playerHit() {
    if (!this.isRunning) return;
    this.player.isSwinging = true;
    this.player.swingTimer = 15;
    
    // 如果球在附近，進行殺球或挑球
    const dx = Math.abs(this.ball.x - (this.player.x + this.player.width/2));
    const dy = this.ball.y - this.player.y;
    
    if (dx < 80 && dy > -80 && dy < 80) {
      this.hitBall(this.player);
    }
  }

  hitBall(hitter) {
    hitter.isSwinging = true;
    hitter.swingTimer = 15;
    
    if (!hitter.isGrounded) {
      // 空中殺球 (Spike) - 經典皮卡丘排球直線下墜球
      this.ball.vx = hitter.isLeft ? 15 : -15;
      this.ball.vy = 10;
    } else {
      // 地上挑球
      this.ball.vx = hitter.isLeft ? 8 : -8;
      this.ball.vy = -15;
    }
    
    // 把球稍微移開避免重複碰撞
    this.ball.x = hitter.isLeft ? hitter.x + hitter.width + 10 : hitter.x - 10;
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Ground
    this.ctx.fillStyle = '#81c784';
    this.ctx.fillRect(0, this.groundY, this.canvas.width, this.canvas.height - this.groundY);

    // Net
    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(this.net.x, this.net.y, this.net.width, this.net.height);

    const drawPlayer = (p) => {
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(p.x, p.y, p.width, p.height);
      
      if (p.isSwinging) {
        this.ctx.fillStyle = '#fff';
        if (p.isLeft) {
          this.ctx.fillRect(p.x + p.width, p.y + 10, 20, 10);
        } else {
          this.ctx.fillRect(p.x - 20, p.y + 10, 20, 10);
        }
      }
    };

    drawPlayer(this.player);
    drawPlayer(this.computer);

    // Ball
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
