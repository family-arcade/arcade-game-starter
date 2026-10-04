/**
 * Wiring: connects the page, the rules (game/rules.ts), the drawing
 * (game/draw.ts) and the arcade kit.
 *
 * Right now this is only the start page: the title, who is playing, and the
 * Play together button (so a family can check it works before building).
 * When you make the game, replace the start card with it and keep the
 * Play together button working.
 *
 * Play together: the HOST runs the rules and sends the world; GUESTS only send
 * their input and draw what the host sends (see AGENTS.md).
 */

import './style.css';
import manifest from '../public/arcade.json';
import { arcade, type Player, type Room } from './arcade';
import { createWorld, step, type Inputs, type World } from './game/rules';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const whoButton = $<HTMLButtonElement>('who');
const backButton = $<HTMLButtonElement>('back');
const hereLine = $('here');

$('title').textContent = manifest.title;
document.title = manifest.title;

let me: Player = { name: 'Player', colour: '#3d6bd6' };
let world: World = createWorld((Math.random() * 2 ** 32) >>> 0);

/** Run the example rules once, with one empty input per person here. */
function countPeople(ids: string[]): void {
  const inputs: Inputs = Object.fromEntries(ids.map((id) => [id, { dx: 0, dy: 0 }]));
  world = step(world, 0, inputs);
}

function showHere(room: Room | null): void {
  if (!room) {
    hereLine.textContent = '';
    return;
  }
  countPeople(room.people.map((p) => p.id));
  hereLine.textContent = world.here === 1 ? 'Just you so far. Friends can join with the code.' : `${world.here} people are here.`;
}

function onRoom(room: Room | null): void {
  whoButton.disabled = room !== null;
  whoButton.title = room ? 'Leave the room to change who is playing' : '';
  showHere(room);
  if (room) room.onPeople(() => showHere(room));
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
    });
  });

  if (arcade.cameFromArcade()) {
    backButton.hidden = false;
    backButton.addEventListener('click', () => arcade.backToArcade());
  }

  arcade.ui.togetherPanel($('together-slot')).onRoom(onRoom);
}

void start();
