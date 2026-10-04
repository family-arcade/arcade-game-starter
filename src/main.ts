/**
 * Star Catch: wiring. Connects the rules (rules.ts), the drawing (draw.ts),
 * the keyboard and touch, the page, and the arcade kit.
 *
 * Play together works like this: the HOST runs the rules and sends a picture
 * of the world about 15 times a second. GUESTS only send what they are
 * pushing (their "input") and draw what the host sends.
 */

import './style.css';
import manifest from '../public/arcade.json';
import { arcade, type Person, type Player, type Room } from './arcade';
import { drawWorld, fitCanvas, type Spark, type View } from './game/draw';
import {
  HEIGHT,
  STEP,
  TIME_LIMIT,
  WIDTH,
  WIN_SCORE,
  addBlob,
  newWorld,
  removeBlob,
  startRound,
  step,
  type Input,
  type Inputs,
  type Seat,
  type World,
} from './game/rules';

// ── the page ──────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const stage = $('stage');
const overlay = $('overlay');
const hud = $('hud');
const live = $('live');
const whoButton = $<HTMLButtonElement>('who');
const backButton = $<HTMLButtonElement>('back');

$('title').textContent = manifest.title;
document.title = manifest.title;

// ── state ─────────────────────────────────────────────────────────────

const HOST = 'host';
const SNAPSHOT_EVERY = 1 / 15; // seconds between pictures of the world sent to guests
const INPUT_EVERY = 1 / 15;

let me: Player = { name: 'Player', colour: '#3d6bd6' };
let room: Room | null = null;
let world: World | null = null;
let meId = HOST;

const guestInputs: Inputs = {};
const keys = new Set<'left' | 'right' | 'up' | 'down'>();
let pointer: { x: number; y: number } | null = null;

const shown = new Map<string, { x: number; y: number }>();
const lastScores = new Map<string, number>();
let sparks: Spark[] = [];
let shake = 0;
let clock = 0;
let scale = 1;
let paused = false;

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
motionQuery.addEventListener('change', () => (reducedMotion = motionQuery.matches));

const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
const isGuest = () => room !== null && !room.isHost;
const seatOf = (p: Person | Player, id: string): Seat => ({ id, name: p.name, colour: p.colour });

function seatsFromRoom(r: Room): Seat[] {
  return r.people.map((p) => seatOf(p, p.id));
}

function freshWorld(): World {
  if (room?.isHost) return newWorld(randomSeed(), seatsFromRoom(room));
  return newWorld(randomSeed(), [seatOf(me, HOST)]);
}

// ── input: keyboard and touch ─────────────────────────────────────────

const KEY_MAP: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

function typingSomewhere(e: Event): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (e) => {
  const dir = KEY_MAP[e.code];
  if (!dir || e.ctrlKey || e.metaKey || e.altKey || typingSomewhere(e)) return;
  keys.add(dir);
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  const dir = KEY_MAP[e.code];
  if (dir) keys.delete(dir);
});
window.addEventListener('blur', () => keys.clear());

function worldPoint(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * WIDTH, y: ((e.clientY - r.top) / r.height) * HEIGHT };
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer = worldPoint(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (pointer) pointer = worldPoint(e);
});
const releasePointer = () => (pointer = null);
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

/** What this device is pushing right now: keys win, otherwise steer toward the finger. */
function localInput(): Input {
  if (keys.size > 0) {
    return { dx: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), dy: (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0) };
  }
  if (pointer) {
    const mine = shown.get(meId);
    if (mine) {
      const dx = pointer.x - mine.x;
      const dy = pointer.y - mine.y;
      const len = Math.hypot(dx, dy);
      const strength = Math.min(1, len / 40); // slows down as it arrives, so you can park under a star
      return len < 1 ? { dx: 0, dy: 0 } : { dx: (dx / len) * strength, dy: (dy / len) * strength };
    }
  }
  return { dx: 0, dy: 0 };
}

// ── together ──────────────────────────────────────────────────────────

function isWorld(v: unknown): v is World {
  const w = v as World | null;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  return (
    typeof w === 'object' &&
    w !== null &&
    (w.phase === 'ready' || w.phase === 'playing' || w.phase === 'over') &&
    finite(w.time) &&
    Array.isArray(w.blobs) &&
    w.blobs.length <= 5 &&
    w.blobs.every((b) => typeof b?.id === 'string' && typeof b.name === 'string' && typeof b.colour === 'string' && finite(b.x) && finite(b.y) && finite(b.score)) &&
    Array.isArray(w.stars) &&
    w.stars.length <= 20 &&
    w.stars.every((s) => finite(s?.x) && finite(s.y) && finite(s.id)) &&
    Array.isArray(w.winners)
  );
}

function syncBlobsWithPeople(r: Room): void {
  if (!world) return;
  let w = world;
  const present = new Set(r.people.map((p) => p.id));
  for (const b of w.blobs) if (!b.bot && !present.has(b.id)) w = removeBlob(w, b.id);
  for (const p of r.people) w = addBlob(w, seatOf(p, p.id));
  world = w;
  for (const id of Object.keys(guestInputs)) if (!present.has(id)) delete guestInputs[id];
}

function onRoom(next: Room | null): void {
  room = next;
  shown.clear();
  lastScores.clear();
  sparks = [];
  for (const id of Object.keys(guestInputs)) delete guestInputs[id];
  if (!next) {
    meId = HOST;
    world = freshWorld();
  } else if (next.isHost) {
    meId = HOST;
    world = freshWorld();
    next.onPeople(() => syncBlobsWithPeople(next));
    next.onMessage((msg, from) => {
      if (msg.t === 'input' && typeof msg.dx === 'number' && typeof msg.dy === 'number') {
        guestInputs[from] = { dx: msg.dx, dy: msg.dy };
      }
    });
  } else {
    world = null; // wait for the host's first picture
    meId = next.people.find((p) => p.me)?.id ?? '';
    next.onPeople((people) => (meId = people.find((p) => p.me)?.id ?? meId));
    next.onMessage((msg) => {
      if (msg.t === 'snap' && isWorld(msg.w)) world = msg.w;
    });
    next.onStatus((status) => {
      if (status === 'error') say('Lost the connection to the host.');
      refreshOverlay(true);
    });
  }
  whoButton.disabled = next !== null;
  whoButton.title = next ? 'Leave the room to change who is playing' : '';
  refreshOverlay(true);
}

// ── the screens on top of the game ────────────────────────────────────

function say(text: string): void {
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 50);
}

let overlayKey = '';
function refreshOverlay(force = false): void {
  const phase = world?.phase ?? 'waiting';
  const status = room?.status ?? 'connected';
  const key = `${phase}|${isGuest()}|${status}|${world?.winners.join(',') ?? ''}`;
  if (!force && key === overlayKey) return;
  overlayKey = key;

  overlay.replaceChildren();
  const add = (tag: 'h2' | 'p', text: string) => {
    const n = document.createElement(tag);
    n.textContent = text;
    overlay.append(n);
  };
  let primary: HTMLButtonElement | null = null;
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    overlay.append(b);
    primary = b;
  };
  const begin = () => {
    if (world) world = startRound(world);
    keys.clear();
    refreshOverlay();
  };

  if (!world) {
    add('h2', status === 'error' ? 'Connection lost' : 'Joining…');
    add('p', status === 'error' ? 'The host may have left. Use Leave in "Room" below, then try again.' : 'Waiting for the host.');
  } else if (world.phase === 'ready') {
    add('h2', 'Ready?');
    add('p', `Catch the falling stars. First to ${WIN_SCORE}, or the most after ${TIME_LIMIT} seconds, wins.`);
    if (isGuest()) add('p', 'Waiting for the host to start…');
    else button('Start', begin);
  } else if (world.phase === 'over') {
    const names = world.blobs.filter((b) => world!.winners.includes(b.id)).map((b) => b.name);
    const headline = names.length === 0 ? 'No stars caught' : names.length === 1 ? `${names[0]} wins!` : `${names.join(' and ')} tie!`;
    add('h2', headline);
    const wins = arcade.load<number>('wins') ?? 0;
    add('p', wins > 0 ? `Your wins so far: ${wins}` : 'Good game!');
    if (isGuest()) add('p', 'Waiting for the host to play again…');
    else button('Play again', begin);
  }
  overlay.hidden = world?.phase === 'playing';
  if (!overlay.hidden && primary && !document.querySelector('.ak-panel:not([hidden])')) (primary as HTMLButtonElement).focus();
}

let lastHud = '';
function refreshHud(): void {
  const parts = world ? world.blobs.map((b) => `${b.name}:${b.score}:${b.colour}`) : [];
  const left = world ? Math.max(0, Math.ceil(TIME_LIMIT - world.time)) : TIME_LIMIT;
  const key = `${parts.join('|')}#${left}`;
  if (key === lastHud) return;
  lastHud = key;
  hud.replaceChildren();
  for (const b of world?.blobs ?? []) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = b.colour;
    chip.append(dot, `${b.name} ${b.score}`);
    hud.append(chip);
  }
  const timer = document.createElement('span');
  timer.className = 'timer';
  timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  hud.append(timer);
}

// ── the game loop ─────────────────────────────────────────────────────

let last = performance.now();
let acc = 0;
let sinceSnapshot = 0;
let sinceInput = 0;
let sentInput = { dx: 0, dy: 0 };
let previousPhase = '';

function recordWin(w: World): void {
  if (w.winners.includes(meId)) {
    try {
      arcade.save('wins', (arcade.load<number>('wins') ?? 0) + 1);
    } catch (e) {
      console.warn(e);
    }
  }
  const names = w.blobs.filter((b) => w.winners.includes(b.id)).map((b) => b.name);
  say(names.length ? `${names.join(' and ')} won.` : 'Nobody caught a star.');
}

function effects(dt: number): void {
  if (!world) return;
  for (const b of world.blobs) {
    const before = lastScores.get(b.id);
    lastScores.set(b.id, b.score);
    if (before === undefined || b.score <= before) continue;
    if (reducedMotion) continue; // no sparkles and no shaking
    const at = shown.get(b.id) ?? b;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 120;
      sparks.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, colour: i % 2 ? '#ffd54a' : b.colour });
    }
    if (b.id === meId) shake = 5;
  }
  sparks = sparks.filter((p) => (p.life -= dt) > 0);
  for (const p of sparks) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  shake = reducedMotion ? 0 : Math.max(0, shake - dt * 30);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused) return;
  clock += dt;

  const input = localInput();

  if (world && !isGuest()) {
    // Solo or host: run the rules in fixed 1/60 second steps.
    acc += dt;
    const inputs: Inputs = { ...guestInputs, [HOST]: input };
    while (acc >= STEP) {
      world = step(world, STEP, inputs);
      acc -= STEP;
    }
    if (room?.isHost) {
      sinceSnapshot += dt;
      if (sinceSnapshot >= SNAPSHOT_EVERY) {
        sinceSnapshot = 0;
        room.send({ t: 'snap', w: world });
      }
    }
  } else if (room && !room.isHost) {
    // Guest: tell the host what we are pushing.
    sinceInput += dt;
    const changed = input.dx !== sentInput.dx || input.dy !== sentInput.dy;
    if (sinceInput >= INPUT_EVERY && (changed || sinceInput > 0.5)) {
      sinceInput = 0;
      sentInput = input;
      room.send({ t: 'input', dx: input.dx, dy: input.dy });
    }
  }

  if (!world) {
    refreshOverlay();
    drawEmpty();
    return;
  }

  // Where to draw each blob. Guests glide between the host's pictures.
  const glide = 1 - Math.exp(-dt * 25);
  for (const b of world.blobs) {
    const at = shown.get(b.id);
    if (!at || !isGuest()) shown.set(b.id, { x: b.x, y: b.y });
    else {
      at.x += (b.x - at.x) * glide;
      at.y += (b.y - at.y) * glide;
    }
  }
  for (const id of [...shown.keys()]) if (!world.blobs.some((b) => b.id === id)) shown.delete(id);

  if (world.phase !== previousPhase) {
    if (world.phase === 'over' && previousPhase === 'playing') recordWin(world);
    previousPhase = world.phase;
  }

  effects(dt);
  refreshOverlay();
  refreshHud();

  const view: View = { world, shown, meId, sparks, shake, reducedMotion, clock, scale };
  drawWorld(ctx, canvas, view);
}

function drawEmpty(): void {
  const k = canvas.width / WIDTH;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#0d1230';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

// ── start up ──────────────────────────────────────────────────────────

function resize(): void {
  const board = $('board');
  const style = getComputedStyle(board);
  const border = parseFloat(style.borderLeftWidth) * 2;
  scale = fitCanvas(canvas, stage.clientWidth - border - 2, stage.clientHeight - border - 2);
}

function showWho(): void {
  whoButton.replaceChildren(Object.assign(document.createElement('span'), { className: 'long', textContent: 'Playing as ' }), me.name);
  whoButton.setAttribute('aria-label', `Playing as ${me.name}. Change player`);
}

async function start(): Promise<void> {
  me = await arcade.ui.ensurePlayer(document.body);
  showWho();
  whoButton.addEventListener('click', () => {
    void arcade.ui.playerPicker(document.body).then((p) => {
      me = p;
      showWho();
      if (!room) {
        world = freshWorld();
        refreshOverlay(true);
      }
    });
  });

  if (arcade.cameFromArcade()) {
    backButton.hidden = false;
    backButton.addEventListener('click', () => arcade.backToArcade());
  }

  // Play together in one line: the kit's panel makes or joins a room for us.
  arcade.ui.togetherPanel($('together-slot')).onRoom(onRoom);

  world = freshWorld();
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  resize();
  refreshOverlay(true);

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    last = performance.now();
    acc = 0;
    keys.clear();
    pointer = null;
  });
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

void start();
