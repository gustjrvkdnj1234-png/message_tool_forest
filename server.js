'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const WORLD = { width: 1280, height: 800 };
const AVATARS = ['cat', 'dog', 'rabbit', 'bear'];
const DIRS = ['up', 'down', 'left', 'right'];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// ---------- 계정 (users.json → 메모리) ----------
const users = new Map();
for (const u of require('./users.json').users) {
  users.set(u.nick, { salt: Buffer.from(u.salt, 'hex'), hash: Buffer.from(u.hash, 'hex') });
}

function verifyPassword(nick, password) {
  const user = users.get(nick);
  if (!user) return false;
  const hash = crypto.scryptSync(password, user.salt, user.hash.length);
  return crypto.timingSafeEqual(hash, user.hash);
}

// ---------- 세션 ----------
const sessions = new Map(); // token -> { nick, expires }

function createSession(nick) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { nick, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  const s = typeof token === 'string' && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const { nick, password } = req.body || {};
  if (typeof nick !== 'string' || typeof password !== 'string' || !verifyPassword(nick, password)) {
    return res.status(401).json({ error: '닉네임 또는 비밀번호가 올바르지 않습니다.' });
  }
  res.json({ token: createSession(nick), nick, avatars: AVATARS });
});

const server = http.createServer(app);

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const players = new Map(); // nick -> { ws, nick, avatar, x, y, dir }

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptNick) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.nick !== exceptNick && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function publicPlayer(p) {
  return { id: p.nick, nick: p.nick, avatar: p.avatar, x: p.x, y: p.y, dir: p.dir };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

wss.on('connection', (ws) => {
  let player = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // 첫 메시지(join)가 5초 안에 오지 않으면 종료
  const joinTimer = setTimeout(() => { if (!player) ws.close(4001, 'join timeout'); }, 5000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (!player) {
      if (msg.type !== 'join') return;
      const session = getSession(msg.token);
      if (!session) return ws.close(4003, 'invalid session');
      const avatar = AVATARS.includes(msg.avatar) ? msg.avatar : AVATARS[0];

      // 같은 계정 중복 접속 → 이전 연결 종료
      const prev = players.get(session.nick);
      if (prev) {
        players.delete(session.nick);
        prev.ws.close(4000, 'replaced');
        broadcast({ type: 'player_leave', id: prev.nick });
      }

      clearTimeout(joinTimer);
      player = {
        ws,
        nick: session.nick,
        avatar,
        x: WORLD.width / 2 + Math.round((Math.random() - 0.5) * 200),
        y: WORLD.height / 2 + Math.round((Math.random() - 0.5) * 120),
        dir: 'down',
      };
      players.set(player.nick, player);

      send(ws, {
        type: 'init',
        you: publicPlayer(player),
        world: WORLD,
        players: [...players.values()].filter((p) => p !== player).map(publicPlayer),
        history: [],
      });
      broadcast({ type: 'player_join', ...publicPlayer(player) }, player.nick);
      console.log(`[join] ${player.nick} (${avatar}) — 접속자 ${players.size}명`);
      return;
    }

    if (msg.type === 'move') {
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
      player.x = clamp(Math.round(msg.x), 0, WORLD.width);
      player.y = clamp(Math.round(msg.y), 0, WORLD.height);
      if (DIRS.includes(msg.dir)) player.dir = msg.dir;
      broadcast({ type: 'move', id: player.nick, x: player.x, y: player.y, dir: player.dir }, player.nick);
    }
  });

  ws.on('close', () => {
    clearTimeout(joinTimer);
    // 중복 접속으로 교체된 경우 새 연결의 player를 지우지 않도록 확인
    if (player && players.get(player.nick) === player) {
      players.delete(player.nick);
      broadcast({ type: 'player_leave', id: player.nick });
      console.log(`[leave] ${player.nick} — 접속자 ${players.size}명`);
    }
  });
});

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30 * 1000);

// 만료 세션 정리
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
}, 10 * 60 * 1000);

// ---------- 시작 ----------
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('🌳 숲속 광장 메신저 서버 실행 중');
  console.log(`   이 PC:     http://localhost:${PORT}`);
  const lan = lanAddresses();
  if (lan.length === 0) console.log('   LAN 주소를 찾지 못했습니다 (네트워크 연결 확인).');
  for (const { name, address } of lan) console.log(`   다른 PC:   http://${address}:${PORT}   (${name})`);
  console.log('');
});
