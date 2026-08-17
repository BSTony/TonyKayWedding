import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { PikaPhysics, PikaUserInput } from './physics.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use(express.json());

// 健康檢查 (Cloud Run / Render 專用)
app.get('/', (req, res) => {
  res.json({
    service: 'Badminton Realtime Cloud Physics Server',
    status: 'online',
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

const wss = new WebSocketServer({ server });

/**
 * 房間資料結構
 * rooms[roomId] = {
 *   roomId: string,
 *   p1: { ws, uid, name },
 *   p2: { ws, uid, name },
 *   physics: PikaPhysics,
 *   p1Input: PikaUserInput,
 *   p2Input: PikaUserInput,
 *   p1Raw: { left, right, up, down, powerHit },
 *   p2Raw: { left, right, up, down, powerHit },
 *   s1: 0,
 *   s2: 0,
 *   maxScore: 5,
 *   roundState: 'playing', // 'playing' | 'scoring' | 'game_over'
 *   loopTimer: NodeJS.Timeout,
 *   lastActivity: number
 * }
 */
const rooms = {};

// 創建或重設房間物理實例
function initRoomGame(room) {
  room.physics = new PikaPhysics(false, false);
  room.p1Input = new PikaUserInput();
  room.p2Input = new PikaUserInput();
  room.p1Raw = { left: false, right: false, up: false, down: false, powerHit: 0 };
  room.p2Raw = { left: false, right: false, up: false, down: false, powerHit: 0 };
  room.s1 = 0;
  room.s2 = 0;
  room.roundState = 'playing';
  room.lastActivity = Date.now();

  if (room.loopTimer) {
    clearInterval(room.loopTimer);
  }

  // 30 FPS 固定步長物理計算循環 (33.33ms)
  const FIXED_STEP_MS = 1000 / 30;

  room.loopTimer = setInterval(() => {
    runRoomPhysicsStep(room);
  }, FIXED_STEP_MS);

  console.log(`[Room ${room.roomId}] 🚀 雲端 30 FPS 權威物理引擎啟動！`);
}

// 執行單一物理幀
function runRoomPhysicsStep(room) {
  if (!room || room.roundState !== 'playing' || !room.physics) return;

  const p1 = room.physics.player1;
  const p2 = room.physics.player2;
  const b = room.physics.ball;

  // 轉換 P1 輸入
  room.p1Input.xDirection = 0;
  if (room.p1Raw.left)  room.p1Input.xDirection = -1;
  if (room.p1Raw.right) room.p1Input.xDirection = 1;
  room.p1Input.yDirection = 0;
  if (room.p1Raw.up)    room.p1Input.yDirection = -1;
  if (room.p1Raw.down)  room.p1Input.yDirection = 1;
  room.p1Input.powerHit = room.p1Raw.powerHit ? 1 : 0;
  if (room.p1Raw.powerHit && p1.state === 0 && room.p1Input.yDirection === 1 && room.p1Input.xDirection === 0) {
    room.p1Input.xDirection = 1;
  }
  if (room.p1Raw.powerHit > 0) room.p1Raw.powerHit--;

  // 轉換 P2 輸入
  room.p2Input.xDirection = 0;
  if (room.p2Raw.left)  room.p2Input.xDirection = -1;
  if (room.p2Raw.right) room.p2Input.xDirection = 1;
  room.p2Input.yDirection = 0;
  if (room.p2Raw.up)    room.p2Input.yDirection = -1;
  if (room.p2Raw.down)  room.p2Input.yDirection = 1;
  room.p2Input.powerHit = room.p2Raw.powerHit ? 1 : 0;
  if (room.p2Raw.powerHit && p2.state === 0 && room.p2Input.yDirection === 1 && room.p2Input.xDirection === 0) {
    room.p2Input.xDirection = -1;
  }
  if (room.p2Raw.powerHit > 0) room.p2Raw.powerHit--;

  const prevPunchRadius = b.punchEffectRadius;

  // 雲端權威物理推進！
  const isBallTouchingGround = room.physics.runEngineForNextFrame([room.p1Input, room.p2Input]);

  let punchEvent = null;
  if (b.punchEffectRadius > 0 && prevPunchRadius === 0) {
    punchEvent = { x: b.punchEffectX, y: b.punchEffectY, isPower: b.isPowerHit };
    b.punchEffectRadius = 0;
  }

  // 判定球落地得分 (雲端唯一裁判)
  if (isBallTouchingGround) {
    b.isPowerHit = false;
    punchEvent = { x: b.x, y: 252, isPower: false };

    const ballX = b.x;
    if (ballX < 216) {
      room.s2++;
    } else {
      room.s1++;
    }

    if (room.s1 >= room.maxScore || room.s2 >= room.maxScore) {
      room.roundState = 'game_over';
      broadcastToRoom(room, {
        t: 'game_over',
        s1: room.s1,
        s2: room.s2,
        winner: room.s1 >= room.maxScore ? 'p1' : 'p2'
      });
      clearInterval(room.loopTimer);
      return;
    } else {
      room.roundState = 'scoring';
      setTimeout(() => {
        if (!rooms[room.roomId]) return;
        const p2Serve = ballX < 216;
        room.physics.player1.initializeForNewRound();
        room.physics.player2.initializeForNewRound();
        room.physics.ball.initializeForNewRound(p2Serve);
        room.roundState = 'playing';
      }, 1200);
    }
  }

  // 廣播給雙方玩家
  broadcastToRoom(room, {
    t: 's', // state
    p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
    p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
    b: {
      x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit,
      px: b.previousX, py: b.previousY, ppx: b.previousPreviousX, ppy: b.previousPreviousY
    },
    s1: room.s1,
    s2: room.s2,
    round: room.roundState,
    punch: punchEvent
  });
}

function broadcastToRoom(room, data) {
  const msg = JSON.stringify(data);
  if (room.p1 && room.p1.ws && room.p1.ws.readyState === WebSocket.OPEN) {
    room.p1.ws.send(msg);
  }
  if (room.p2 && room.p2.ws && room.p2.ws.readyState === WebSocket.OPEN) {
    room.p2.ws.send(msg);
  }
}

// WebSocket 連線處理
wss.on('connection', (ws) => {
  let myRoomId = null;
  let myRole = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const type = data.type || data.t;

      if (type === 'join') {
        const { roomId, role, uid, name, maxScore } = data;
        myRoomId = roomId;
        myRole = role;

        if (!rooms[roomId]) {
          rooms[roomId] = {
            roomId,
            p1: null,
            p2: null,
            maxScore: maxScore || 5
          };
        }

        const room = rooms[roomId];
        room[role] = { ws, uid, name };

        ws.send(JSON.stringify({ t: 'joined', role, roomId }));
        console.log(`[Room ${roomId}] 玩家加入: ${role} (${name || uid})`);

        // 當兩位玩家都已加入，自動開始遊戲
        if (room.p1 && room.p2) {
          initRoomGame(room);
          broadcastToRoom(room, { t: 'start', maxScore: room.maxScore });
        }
      } else if (type === 'input') {
        if (myRoomId && rooms[myRoomId] && data.input) {
          const room = rooms[myRoomId];
          if (myRole === 'p1') {
            room.p1Raw = { ...data.input };
          } else if (myRole === 'p2') {
            room.p2Raw = { ...data.input };
          }
        }
      } else if (type === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
      }
    } catch (err) {
      console.error('[WS Message Error]', err);
    }
  });

  ws.on('close', () => {
    if (myRoomId && rooms[myRoomId]) {
      const room = rooms[myRoomId];
      console.log(`[Room ${myRoomId}] 玩家斷線: ${myRole}`);
      if (room[myRole] && room[myRole].ws === ws) {
        room[myRole] = null;
      }
      // 如果兩位玩家都離開超過 30 秒，清除房間
      if (!room.p1 && !room.p2) {
        if (room.loopTimer) clearInterval(room.loopTimer);
        delete rooms[myRoomId];
        console.log(`[Room ${myRoomId}] 房間已釋放清理。`);
      }
    }
  });
});

// 每 60 秒清理閒置過期房間
setInterval(() => {
  const now = Date.now();
  for (const rid in rooms) {
    const room = rooms[rid];
    if (now - room.lastActivity > 1000 * 60 * 10) { // 10 分鐘無活動
      if (room.loopTimer) clearInterval(room.loopTimer);
      delete rooms[rid];
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`🏸 婚禮羽毛球雲端物理伺服器已啟動！Port: ${PORT}`);
});
