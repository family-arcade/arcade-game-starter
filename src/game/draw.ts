/**
 * Star Catch: drawing. Takes a world and paints it on a canvas; changes nothing.
 * Coordinates are the world's (600 x 720); the canvas is scaled to fit.
 */

import { BLOB_RADIUS, HEIGHT, STAR_RADIUS, WIDTH, type World } from './rules';

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds left */
  life: number;
  colour: string;
}

export interface View {
  world: World;
  /** where each blob is drawn (a guest smooths these between snapshots) */
  shown: Map<string, { x: number; y: number }>;
  /** the id of the blob this device controls */
  meId: string;
  sparks: Spark[];
  /** screen shake in pixels; always 0 when reduced motion is on */
  shake: number;
  reducedMotion: boolean;
  /** seconds since the page opened, for twinkling */
  clock: number;
  /** CSS pixels per world unit, so labels stay readable on a small screen */
  scale: number;
}

/** Make the canvas sharp on this screen and return the CSS pixels per world unit. */
export function fitCanvas(canvas: HTMLCanvasElement, availW: number, availH: number): number {
  const scale = Math.max(0.1, Math.min(availW / WIDTH, availH / HEIGHT));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${Math.floor(WIDTH * scale)}px`;
  canvas.style.height = `${Math.floor(HEIGHT * scale)}px`;
  const w = Math.floor(WIDTH * scale * dpr);
  const h = Math.floor(HEIGHT * scale * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return scale;
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rotation: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = rotation + (i * Math.PI) / 5 - Math.PI / 2;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function drawWorld(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, view: View): void {
  const { world, reducedMotion } = view;
  const k = canvas.width / WIDTH;
  ctx.setTransform(k, 0, 0, k, 0, 0);

  // night sky
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, '#0d1230');
  sky.addColorStop(1, '#27336b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  if (view.shake > 0 && !reducedMotion) {
    ctx.translate((Math.random() - 0.5) * view.shake * 2, (Math.random() - 0.5) * view.shake * 2);
  }

  // ground
  ctx.fillStyle = '#1b2650';
  ctx.fillRect(0, HEIGHT - 18, WIDTH, 18);

  // stars
  for (const s of world.stars) {
    const twinkle = reducedMotion ? 1 : 1 + Math.sin(view.clock * 6 + s.id) * 0.08;
    const spin = reducedMotion ? 0 : view.clock * 1.5 + s.id;
    ctx.fillStyle = '#ffd54a';
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2;
    starPath(ctx, s.x, s.y, STAR_RADIUS * twinkle * 1.15, spin);
    ctx.fill();
    ctx.stroke();
  }

  // blobs
  const label = Math.max(16 / view.scale, 14);
  const tags: Array<{ x0: number; x1: number; y: number }> = [];
  for (const b of world.blobs) {
    const at = view.shown.get(b.id) ?? b;
    ctx.fillStyle = b.colour;
    ctx.strokeStyle = b.id === view.meId ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = b.id === view.meId ? 5 : 3;
    ctx.beginPath();
    ctx.arc(at.x, at.y, BLOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#fff';
    for (const dx of [-9, 9]) {
      ctx.beginPath();
      ctx.arc(at.x + dx, at.y - 6, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#10152e';
    for (const dx of [-9, 9]) {
      ctx.beginPath();
      ctx.arc(at.x + dx, at.y - 5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // name tag
    ctx.font = `700 ${label}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = b.id === view.meId ? `${b.name} (you)` : b.name;
    const w = ctx.measureText(text).width + 14;
    let ty = at.y - BLOB_RADIUS - label * 0.9;
    const tx = Math.min(Math.max(at.x, w / 2 + 2), WIDTH - w / 2 - 2);
    // two name tags never sit on top of each other: the later one moves up
    for (let tries = 0; tries < 4; tries++) {
      const clash = tags.find((t) => tx - w / 2 < t.x1 && tx + w / 2 > t.x0 && Math.abs(ty - t.y) < label * 1.5);
      if (!clash) break;
      ty = clash.y - label * 1.6;
    }
    tags.push({ x0: tx - w / 2, x1: tx + w / 2, y: ty });
    ctx.fillStyle = 'rgba(8,10,25,0.78)';
    ctx.beginPath();
    ctx.roundRect(tx - w / 2, ty - label * 0.75, w, label * 1.5, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, tx, ty + 1);
  }

  // sparkles
  for (const p of view.sparks) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
