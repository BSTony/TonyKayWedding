import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, get } from 'firebase/database';
import { PikaPhysics, PikaUserInput } from './physics.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Firebase RTDB 設定 (與前端完全相同)
const firebaseConfig = {
  apiKey: "AIzaSyDxa_23r4kv_iRFFMp-9IYjNN6D6ryz6mI",
  authDomain: "tonykaywendding.firebaseapp.com",
  databaseURL: "https://tonykaywendding-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tonykaywendding",
  storageBucket: "tonykaywendding.firebasestorage.app",
  messagingSenderId: "313808662625",
  appId: "1:313808662625:web:38ec4853fc53e5844fba20"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// 雲端房間物理實例表
const activeFirebaseRooms = {};

console.log('⚡ 雲端物理裁判伺服器正在連線至 Firebase RTDB...');

// 監聽 Firebase 排位賽房間 (作為 24/7 雲端權威物理裁判)
onValue(ref(db, 'rankedRooms'), (snapshot) => {
  const rooms = snapshot.val();
  if (!rooms) return;

  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room && room.status === 'playing') {
      if (!activeFirebaseRooms[roomId]) {
        startServerRoomSimulation(roomId, room);
      }
    } else {
      if (activeFirebaseRooms[roomId]) {
        stopServerRoomSimulation(roomId);
      }
    }
  }
});

function startServerRoomSimulation(roomId, roomData) {
  console.log(`[Firebase Cloud Room ${roomId}] 🚀 雲端伺服器接管權威物理計算 (30 FPS)！`);

  const physics = new PikaPhysics(false, false);
  const p1Input = new PikaUserInput();
  const p2Input = new PikaUserInput();

  const roomState = {
    roomId,
    physics,
    p1Input,
    p2Input,
    p1Raw: { left: false, right: false, up: false, down: false, powerHit: 0 },
    p2Raw: { left: false, right: false, up: false, down: false, powerHit: 0 },
    s1: 0,
    s2: 0,
    maxScore: roomData.maxScore || 5,
    roundState: 'playing',
    loopTimer: null,
    lastWriteTime: 0
  };

  // 標記此房間由雲端伺服器權威託管 (兩端玩家均不需當主機)
  update(ref(db, `rankedRooms/${roomId}`), { serverHost: true }).catch(() => {});

  // 監聽 1P 輸入
  const unsubsP1 = onValue(ref(db, `rankedRooms/${roomId}/p1Input`), (snap) => {
    const inp = snap.val();
    if (inp) roomState.p1Raw = { ...inp };
  });

  // 監聽 2P 輸入
  const unsubsP2 = onValue(ref(db, `rankedRooms/${roomId}/guestInput`), (snap) => {
    const inp = snap.val();
    if (inp) roomState.p2Raw = { ...inp };
  });

  roomState.unsubs = [unsubsP1, unsubsP2];

  // 30 FPS 物理循環 (33.33ms)
  roomState.loopTimer = setInterval(() => {
    if (roomState.roundState !== 'playing') return;

    const p1 = physics.player1;
    const p2 = physics.player2;
    const b = physics.ball;

    // 處理 1P 輸入
    p1Input.xDirection = 0;
    if (roomState.p1Raw.left)  p1Input.xDirection = -1;
    if (roomState.p1Raw.right) p1Input.xDirection = 1;
    p1Input.yDirection = 0;
    if (roomState.p1Raw.up)    p1Input.yDirection = -1;
    if (roomState.p1Raw.down)  p1Input.yDirection = 1;
    p1Input.powerHit = roomState.p1Raw.powerHit ? 1 : 0;
    if (roomState.p1Raw.powerHit && p1.state === 0 && p1Input.yDirection === 1 && p1Input.xDirection === 0) {
      p1Input.xDirection = 1;
    }
    if (roomState.p1Raw.powerHit > 0) roomState.p1Raw.powerHit--;

    // 處理 2P 輸入
    p2Input.xDirection = 0;
    if (roomState.p2Raw.left)  p2Input.xDirection = -1;
    if (roomState.p2Raw.right) p2Input.xDirection = 1;
    p2Input.yDirection = 0;
    if (roomState.p2Raw.up)    p2Input.yDirection = -1;
    if (roomState.p2Raw.down)  p2Input.yDirection = 1;
    p2Input.powerHit = roomState.p2Raw.powerHit ? 1 : 0;
    if (roomState.p2Raw.powerHit && p2.state === 0 && p2Input.yDirection === 1 && p2Input.xDirection === 0) {
      p2Input.xDirection = -1;
    }
    if (roomState.p2Raw.powerHit > 0) roomState.p2Raw.powerHit--;

    const prevPunch = b.punchEffectRadius;
    const isTouchingGround = physics.runEngineForNextFrame([p1Input, p2Input]);

    let punchEvent = null;
    if (b.punchEffectRadius > 0 && prevPunch === 0) {
      punchEvent = { x: b.punchEffectX, y: b.punchEffectY, isPower: b.isPowerHit };
      b.punchEffectRadius = 0;
    }

    if (isTouchingGround) {
      b.isPowerHit = false;
      punchEvent = { x: b.x, y: 252, isPower: false };

      const ballX = b.x;
      if (ballX < 216) {
        roomState.s2++;
      } else {
        roomState.s1++;
      }

      if (roomState.s1 >= roomState.maxScore || roomState.s2 >= roomState.maxScore) {
        roomState.roundState = 'game_over';
        set(ref(db, `rankedRooms/${roomId}/state`), {
          p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
          p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
          b: { x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit },
          s1: roomState.s1,
          s2: roomState.s2,
          round: 'game_over',
          punch: punchEvent
        }).catch(() => {});
        stopServerRoomSimulation(roomId);
        return;
      } else {
        roomState.roundState = 'scoring';
        setTimeout(() => {
          if (!activeFirebaseRooms[roomId]) return;
          const p2Serve = ballX < 216;
          physics.player1.initializeForNewRound();
          physics.player2.initializeForNewRound();
          physics.ball.initializeForNewRound(p2Serve);
          roomState.roundState = 'playing';
        }, 1200);
      }
    }

    const now = Date.now();
    if (now - roomState.lastWriteTime > 40 || punchEvent || isTouchingGround) {
      roomState.lastWriteTime = now;
      set(ref(db, `rankedRooms/${roomId}/state`), {
        p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
        p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
        b: {
          x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit,
          px: b.previousX, py: b.previousY, ppx: b.previousPreviousX, ppy: b.previousPreviousY
        },
        s1: roomState.s1,
        s2: roomState.s2,
        round: roomState.roundState,
        punch: punchEvent
      }).catch(() => {});
    }
  }, 1000 / 30);

  activeFirebaseRooms[roomId] = roomState;
}

function stopServerRoomSimulation(roomId) {
  const room = activeFirebaseRooms[roomId];
  if (room) {
    if (room.loopTimer) clearInterval(room.loopTimer);
    if (room.unsubs) room.unsubs.forEach(u => typeof u === 'function' && u());
    delete activeFirebaseRooms[roomId];
    console.log(`[Firebase Cloud Room ${roomId}] 房間物理計算結束釋放。`);
  }
}

app.get('/', (req, res) => {
  res.json({
    service: 'Badminton Realtime Cloud Physics Server',
    status: 'online',
    firebaseRooms: Object.keys(activeFirebaseRooms).length,
    timestamp: new Date().toISOString()
  });
});

server.listen(PORT, () => {
  console.log(`🏸 婚禮羽毛球雲端物理伺服器已啟動！Port: ${PORT}`);
});
