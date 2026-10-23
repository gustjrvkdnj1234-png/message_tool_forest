'use strict';

(function () {
  const AVATAR_NAMES = { cat: '고양이', dog: '강아지', rabbit: '토끼', bear: '곰' };

  const $ = (id) => document.getElementById(id);
  const state = { token: null, nick: null, avatar: null, ws: null, plaza: null, players: new Map() };

  function show(screen) {
    for (const s of ['login', 'avatar', 'plaza']) $(`screen-${s}`).hidden = s !== screen;
  }

  // ---------- 1. 로그인 ----------
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    err.hidden = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: $('login-nick').value.trim(), password: $('login-pw').value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인 실패');
      state.token = data.token;
      state.nick = data.nick;
      $('login-pw').value = '';
      showAvatarPicker(data.avatars);
    } catch (ex) {
      err.textContent = ex.message === 'Failed to fetch' ? '서버에 연결할 수 없습니다.' : ex.message;
      err.hidden = false;
    }
  });

  // ---------- 2. 아바타 선택 ----------
  function showAvatarPicker(avatars) {
    $('avatar-nick').textContent = state.nick;
    const list = $('avatar-list');
    list.replaceChildren();
    for (const a of avatars) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-option';
      btn.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.src = `assets/animals/${a}.svg`;
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = AVATAR_NAMES[a] || a;
      btn.append(img, name);
      btn.addEventListener('click', () => {
        state.avatar = a;
        for (const b of list.children) b.setAttribute('aria-pressed', String(b === btn));
        $('avatar-confirm').disabled = false;
      });
      list.append(btn);
    }
    show('avatar');
  }

  $('avatar-confirm').addEventListener('click', () => {
    if (state.avatar) connect();
  });

  // ---------- 3. 광장 (WebSocket) ----------
  function setStatus(text, bad) {
    const el = $('conn-status');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  function send(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
  }

  function renderPlayerList() {
    const ul = $('player-list');
    ul.replaceChildren();
    for (const p of state.players.values()) {
      const li = document.createElement('li');
      if (p.nick === state.nick) li.className = 'me';
      const img = document.createElement('img');
      img.src = `assets/animals/${p.avatar}.svg`;
      img.alt = AVATAR_NAMES[p.avatar] || '';
      const name = document.createElement('span');
      name.textContent = p.nick === state.nick ? `${p.nick} (나)` : p.nick;
      li.append(img, name);
      ul.append(li);
    }
    $('player-count').textContent = state.players.size;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    state.ws = ws;

    ws.addEventListener('open', () => send({ type: 'join', token: state.token, avatar: state.avatar }));

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'init':
          state.players.clear();
          state.players.set(msg.you.id, msg.you);
          for (const p of msg.players) state.players.set(p.id, p);
          show('plaza');
          state.plaza = Plaza.start({
            parent: 'game',
            world: msg.world,
            you: msg.you,
            players: msg.players,
            onMove: (pos) => send({ type: 'move', ...pos }),
          });
          renderPlayerList();
          setStatus('🟢 연결됨');
          break;
        case 'player_join':
          state.players.set(msg.id, msg);
          state.plaza.addPlayer(msg);
          renderPlayerList();
          break;
        case 'player_leave':
          state.players.delete(msg.id);
          state.plaza.removePlayer(msg.id);
          renderPlayerList();
          break;
        case 'move':
          state.plaza.movePlayer(msg);
          break;
      }
    });

    ws.addEventListener('close', (e) => {
      if (state.ws !== ws) return;
      if (e.code === 4003) {
        alert('세션이 만료되었습니다. 다시 로그인해 주세요.');
        location.reload();
      } else if (e.code === 4000) {
        setStatus('⚠️ 다른 창에서 같은 계정으로 접속해 연결이 종료되었습니다.', true);
      } else {
        setStatus('🔴 서버 연결이 끊겼습니다. 새로고침해 주세요.', true);
      }
    });
  }

  show('login');
  $('login-nick').focus();
})();
