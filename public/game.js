'use strict';

// Phaser 광장 씬. app.js가 Plaza.start()로 시작하고, 반환된 API로 다른 플레이어를 갱신한다.
(function () {
  const AVATARS = ['cat', 'dog', 'rabbit', 'bear'];
  const SPEED = 200;          // px/s
  const SEND_INTERVAL = 100;  // ms (≈10Hz)
  const EDGE = 24;            // 맵 가장자리 여백

  // 모든 클라이언트가 같은 맵을 그리도록 고정 시드 난수 사용
  function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  class PlazaScene extends Phaser.Scene {
    constructor(opts) {
      super('plaza');
      this.opts = opts;
      this.others = new Map(); // id -> { container, image, walkingUntil }
      this.lastSent = { x: null, y: null, t: 0 };
    }

    preload() {
      for (const a of AVATARS) this.load.svg(a, `assets/animals/${a}.svg`, { width: 64, height: 72 });
    }

    create() {
      const { world, you, players } = this.opts;
      this.world = world;
      this.drawMap(world);

      this.me = this.createAvatar(you);
      this.me.label.setColor('#2f7a57');
      this.myDir = you.dir;
      for (const p of players) this.addPlayer(p);

      this.cameras.main.setBounds(0, 0, world.width, world.height);
      this.cameras.main.startFollow(this.me.container, true, 0.15, 0.15);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D', false);

      // start() 이후 씬이 준비되기 전에 도착한 이벤트 처리
      this.ready = true;
      for (const fn of this.opts.pending.splice(0)) fn();
    }

    drawMap({ width, height }) {
      const rand = seededRandom(20261023);
      const g = this.add.graphics().setDepth(-1000);

      // 잔디
      g.fillStyle(0xbfe3a5).fillRect(0, 0, width, height);
      g.fillStyle(0xb2dc96);
      for (let i = 0; i < 90; i++) g.fillEllipse(rand() * width, rand() * height, 30 + rand() * 60, 16 + rand() * 24);

      // 가운데 모래 광장 + 길
      g.fillStyle(0xf3e2b8);
      g.fillRoundedRect(width / 2 - 40, 0, 80, height, 30);
      g.fillRoundedRect(0, height / 2 - 36, width, 72, 30);
      g.fillEllipse(width / 2, height / 2, 380, 260);
      g.lineStyle(3, 0xe6cf9c).strokeEllipse(width / 2, height / 2, 380, 260);

      // 연못
      g.fillStyle(0x8fcbe0).fillEllipse(width - 230, 170, 260, 150);
      g.fillStyle(0xb5e2f0).fillEllipse(width - 245, 160, 190, 100);
      g.lineStyle(4, 0x7ab7cc).strokeEllipse(width - 230, 170, 260, 150);

      // 꽃
      const flowerColors = [0xffb5c5, 0xfff1a8, 0xd7c4f5, 0xffffff];
      for (let i = 0; i < 70; i++) {
        const x = rand() * width, y = rand() * height;
        if (Math.abs(x - width / 2) < 220 && Math.abs(y - height / 2) < 160) continue;
        g.fillStyle(flowerColors[i % flowerColors.length]).fillCircle(x, y, 4);
        g.fillStyle(0xffd36e).fillCircle(x, y, 1.6);
      }

      // 나무 (y 기준 깊이 정렬되도록 각각 별도 Graphics)
      const trees = [
        [90, 90], [200, 60], [140, 210], [80, 700], [220, 740], [1180, 690], [1060, 740],
        [380, 120], [900, 620], [330, 620], [1200, 420], [60, 450], [760, 90],
      ];
      for (const [x, y] of trees) {
        const t = this.add.graphics({ x, y }).setDepth(y);
        t.fillStyle(0x000000, 0.12).fillEllipse(0, 2, 56, 14);
        t.fillStyle(0xb98a5e).fillRoundedRect(-7, -26, 14, 28, 5);
        t.fillStyle(0x7cc28a).fillCircle(0, -48, 30);
        t.fillStyle(0x8fd19c).fillCircle(-14, -56, 18).fillCircle(12, -62, 16);
        t.fillStyle(0xff9e9e).fillCircle(-12, -40, 4).fillCircle(14, -48, 4).fillCircle(2, -66, 4);
      }
    }

    createAvatar(p) {
      const image = this.add.image(0, 0, AVATARS.includes(p.avatar) ? p.avatar : 'cat').setOrigin(0.5, 0.95);
      const label = this.add.text(0, 8, p.nick, {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#4a3b35',
        backgroundColor: 'rgba(255,253,247,0.85)',
        padding: { x: 6, y: 2 },
      }).setOrigin(0.5, 0);
      const container = this.add.container(p.x, p.y, [image, label]).setDepth(p.y);
      return { container, image, label, walkingUntil: 0 };
    }

    addPlayer(p) {
      if (this.others.has(p.id)) this.removePlayer(p.id);
      this.others.set(p.id, this.createAvatar(p));
    }

    removePlayer(id) {
      const o = this.others.get(id);
      if (!o) return;
      o.container.destroy();
      this.others.delete(id);
    }

    movePlayer({ id, x, y, dir }) {
      const o = this.others.get(id);
      if (!o) return;
      this.tweens.killTweensOf(o.container);
      this.tweens.add({ targets: o.container, x, y, duration: SEND_INTERVAL + 20, ease: 'Linear' });
      o.walkingUntil = this.time.now + 200;
      if (dir === 'left' || dir === 'right') o.image.setFlipX(dir === 'right');
    }

    animate(a, walking, time) {
      a.image.y = walking ? -Math.abs(Math.sin(time / 70)) * 4 : 0;
      a.image.rotation = walking ? Math.sin(time / 70) * 0.06 : 0;
      a.container.setDepth(a.container.y);
    }

    update(time, delta) {
      let vx = 0, vy = 0;
      if (!isTyping()) {
        if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
        if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
        if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;
      }

      const c = this.me.container;
      const moving = vx !== 0 || vy !== 0;
      if (moving) {
        const len = Math.hypot(vx, vy);
        const step = (SPEED * delta) / 1000;
        c.x = Phaser.Math.Clamp(c.x + (vx / len) * step, EDGE, this.world.width - EDGE);
        c.y = Phaser.Math.Clamp(c.y + (vy / len) * step, EDGE * 2.5, this.world.height - EDGE);
        this.myDir = vx < 0 ? 'left' : vx > 0 ? 'right' : vy < 0 ? 'up' : 'down';
        if (vx !== 0) this.me.image.setFlipX(vx > 0);
      }
      this.animate(this.me, moving, time);

      // 위치가 바뀌었을 때만 ≈10Hz로 서버 전송
      const x = Math.round(c.x), y = Math.round(c.y);
      if ((x !== this.lastSent.x || y !== this.lastSent.y) && time - this.lastSent.t >= SEND_INTERVAL) {
        this.lastSent = { x, y, t: time };
        this.opts.onMove({ x, y, dir: this.myDir });
      }

      for (const o of this.others.values()) this.animate(o, time < o.walkingUntil, time);
    }
  }

  window.Plaza = {
    // opts: { parent, world, you, players, onMove(pos) }
    start(opts) {
      const pending = [];
      const scene = new PlazaScene({ ...opts, pending });
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: opts.parent,
        backgroundColor: '#bfe3a5',
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        scene,
      });
      const whenReady = (fn) => (scene.ready ? fn() : pending.push(fn));
      return {
        addPlayer: (p) => whenReady(() => scene.addPlayer(p)),
        removePlayer: (id) => whenReady(() => scene.removePlayer(id)),
        movePlayer: (m) => whenReady(() => scene.movePlayer(m)),
        destroy: () => game.destroy(true),
      };
    },
  };
})();
