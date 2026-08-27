// Author: Tony Hsieh
// Date: 2026-08-27
// Version: 1.4.0
import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { PikaPhysics, PikaUserInput } from './physics.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());

const DEFAULT_CLOUD_RUN_HTTP = 'https://badminton-server-308194662340.asia-east1.run.app';

function toWsUrl(url) {
  return String(url).trim().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/$/, '');
}

function getPublicWsUrlFromEnv() {
  const explicit = process.env.WS_PUBLIC_URL || process.env.PUBLIC_WS_URL || process.env.CLOUD_RUN_SERVICE_URL || process.env.SERVICE_URL;
  if (explicit) return toWsUrl(explicit);
  if (process.env.K_SERVICE) return toWsUrl(DEFAULT_CLOUD_RUN_HTTP);
  return toWsUrl(DEFAULT_CLOUD_RUN_HTTP);
}

let PUBLIC_WS_URL = getPublicWsUrlFromEnv();

function publishServerInfo(wsUrl) {
  if (!wsUrl) return;
  PUBLIC_WS_URL = toWsUrl(wsUrl);
  set(ref(db, 'serverInfo'), {
    wsUrl: PUBLIC_WS_URL,
    platform: 'gcp-cloud-run',
    updatedAt: Date.now()
  }).catch(() => {});
  for (const roomId of Object.keys(activeFirebaseRooms)) {
    update(ref(db, `rankedRooms/${roomId}`), { wsUrl: PUBLIC_WS_URL }).catch(() => {});
  }
}

app.use((req, res, next) => {
  if (!PUBLIC_WS_URL) {
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      publishServerInfo('wss://' + host);
    }
  }
  next();
});

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
const auth = getAuth(fbApp);

// 伺服器裁判以匿名身分取得 Firebase 授權
signInAnonymously(auth).then(() => {
  console.log('🔒 雲端伺服器已成功取得 Firebase 安全認證 (auth != null)');
  if (PUBLIC_WS_URL) publishServerInfo(PUBLIC_WS_URL);
}).catch(err => {
  console.warn('伺服器認證提示:', err.message);
});

// 雲端房間物理實例表
const activeFirebaseRooms = {};

console.log('⚡ 雲端物理裁判伺服器正在連線至 Firebase RTDB...');

// 監聽 Firebase 排位賽房間 (作為 24/7 雲端權威物理裁判)
onValue(ref(db, 'rankedRooms'), (snapshot) => {
  const rooms = snapshot.val();
  if (!rooms) return;

  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room && room.status === 'playing' && !room.abandoned) {
      // 忽略超過 3 分鐘前的舊廢棄房間
      const isFresh = room.createdAt && (now - room.createdAt < 3 * 60 * 1000);
      if (isFresh) {
        if (!activeFirebaseRooms[roomId]) {
          startServerRoomSimulation(roomId, room);
        }
      } else {
        // 舊房間自動結案
        update(ref(db, `rankedRooms/${roomId}`), { status: 'stale_finished' }).catch(() => {});
        if (activeFirebaseRooms[roomId]) {
          stopServerRoomSimulation(roomId);
        }
      }
    } else {
      if (activeFirebaseRooms[roomId]) {
        stopServerRoomSimulation(roomId);
      }
    }
  }
});

function startServerRoomSimulation(roomId, roomData) {
  if (activeFirebaseRooms[roomId]) return; // 防止重複建立
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
  update(ref(db, `rankedRooms/${roomId}`), {
    serverHost: true,
    ...(PUBLIC_WS_URL ? { wsUrl: PUBLIC_WS_URL } : {})
  }).catch(() => {});

  // 監聽 1P 輸入 (Host 玩家，寫到 p1Input)
  const unsubsP1 = onValue(ref(db, `rankedRooms/${roomId}/p1Input`), (snap) => {
    const inp = snap.val();
    if (inp) roomState.p1Raw = { ...inp };
  });

  // 監聽 2P 輸入 (Guest 玩家，寫到 p2Input)
  const unsubsP2 = onValue(ref(db, `rankedRooms/${roomId}/p2Input`), (snap) => {
    const inp = snap.val();
    if (inp) roomState.p2Raw = { ...inp };
  });

  // 同時兼容舊版 guestInput key
  const unsubsP2Legacy = onValue(ref(db, `rankedRooms/${roomId}/guestInput`), (snap) => {
    const inp = snap.val();
    if (inp) roomState.p2Raw = { ...inp };
  });

  roomState.unsubs = [unsubsP1, unsubsP2, unsubsP2Legacy];

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
        const finalState = {
          p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
          p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
          b: { x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit },
          s1: roomState.s1,
          s2: roomState.s2,
          round: 'game_over',
          punch: punchEvent,
          ts: Date.now()
        };
        set(ref(db, `rankedRooms/${roomId}/state`), finalState).catch(() => {});
        // 標記房間結束
        update(ref(db, `rankedRooms/${roomId}`), { status: 'finished' }).catch(() => {});
        stopServerRoomSimulation(roomId);
        return;
      } else {
        roomState.roundState = 'scoring';
        const scoringState = {
          p1: { x: p1.x, y: p1.y, state: p1.state, frameNumber: p1.frameNumber, divingDirection: p1.divingDirection },
          p2: { x: p2.x, y: p2.y, state: p2.state, frameNumber: p2.frameNumber, divingDirection: p2.divingDirection },
          b: { x: b.x, y: 252, vx: 0, vy: 0, rot: b.rotation, power: false },
          s1: roomState.s1,
          s2: roomState.s2,
          round: 'scoring',
          punch: punchEvent,
          ts: Date.now()
        };
        set(ref(db, `rankedRooms/${roomId}/state`), scoringState).catch(() => {});

        setTimeout(() => {
          if (!activeFirebaseRooms[roomId]) return;
          const p2Serve = ballX < 216;
          physics.player1.initializeForNewRound();
          physics.player2.initializeForNewRound();
          physics.ball.initializeForNewRound(p2Serve);
          roomState.roundState = 'playing';

          const newRoundState = {
            p1: { x: physics.player1.x, y: physics.player1.y, state: physics.player1.state, frameNumber: physics.player1.frameNumber, divingDirection: physics.player1.divingDirection },
            p2: { x: physics.player2.x, y: physics.player2.y, state: physics.player2.state, frameNumber: physics.player2.frameNumber, divingDirection: physics.player2.divingDirection },
            b: { x: physics.ball.x, y: physics.ball.y, vx: physics.ball.xVelocity, vy: physics.ball.yVelocity, rot: physics.ball.rotation, power: false },
            s1: roomState.s1,
            s2: roomState.s2,
            round: 'playing',
            newRound: true,
            ts: Date.now()
          };
          set(ref(db, `rankedRooms/${roomId}/state`), newRoundState).catch(() => {});
        }, 1100);
      }
    }

    const now = Date.now();

    // 1. WebSocket 高速極速通道廣播 (10ms 零延遲直連)
    const sockets = wsRooms[roomId];
    if (sockets) {
      const wsPayload = JSON.stringify({
        t: 's',
        ts: now,
        p1: { x: p1.x, y: p1.y, s: p1.state, f: p1.frameNumber, d: p1.divingDirection },
        p2: { x: p2.x, y: p2.y, s: p2.state, f: p2.frameNumber, d: p2.divingDirection },
        b: {
          x: b.x, y: b.y, vx: b.xVelocity, vy: b.yVelocity, rot: b.rotation, power: b.isPowerHit,
          px: b.previousX, py: b.previousY
        },
        s1: roomState.s1,
        s2: roomState.s2,
        round: roomState.roundState,
        punch: punchEvent
      });
      if (sockets.p1 && sockets.p1.readyState === WebSocket.OPEN) sockets.p1.send(wsPayload);
      if (sockets.p2 && sockets.p2.readyState === WebSocket.OPEN) sockets.p2.send(wsPayload);
    }

    const hasWsClient = sockets && (
      (sockets.p1 && sockets.p1.readyState === WebSocket.OPEN) ||
      (sockets.p2 && sockets.p2.readyState === WebSocket.OPEN)
    );
    const rtdbInterval = hasWsClient ? 500 : 80;
    if (now - roomState.lastWriteTime > rtdbInterval || punchEvent || isTouchingGround) {
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
        punch: punchEvent,
        ts: now
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
    if (wsRooms[roomId]) delete wsRooms[roomId];
    console.log(`[Firebase Cloud Room ${roomId}] 房間物理計算結束釋放。`);
  }
}

// ── WebSocket 連線閘道 (極速直連通道) ──
const wss = new WebSocketServer({ server, perMessageDeflate: false });
const wsRooms = {};

wss.on('connection', (ws) => {
  let joinedRoomId = null;
  let clientRole = null;
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch (e) {}
    }
  }, 15000);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'join') {
        joinedRoomId = data.roomId;
        clientRole = data.role; // 'p1' 或 'p2'
        if (!wsRooms[joinedRoomId]) wsRooms[joinedRoomId] = {};
        wsRooms[joinedRoomId][clientRole] = ws;
      } else if (data.type === 'input') {
        const room = activeFirebaseRooms[joinedRoomId];
        if (room && data.input) {
          if (data.role === 'p1') room.p1Raw = { ...data.input };
          if (data.role === 'p2') room.p2Raw = { ...data.input };
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    if (joinedRoomId && wsRooms[joinedRoomId] && clientRole) {
      delete wsRooms[joinedRoomId][clientRole];
    }
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Badminton Realtime Cloud Physics Server',
    status: 'online',
    firebaseRooms: Object.keys(activeFirebaseRooms).length,
    wsUrl: PUBLIC_WS_URL,
    timestamp: new Date().toISOString()
  });
});

server.listen(PORT, () => {
  console.log(`🏸 婚禮羽毛球雲端物理伺服器已啟動！Port: ${PORT}`);
});
