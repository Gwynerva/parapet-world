/**
 * Screens and menus: the title (name entry and Play), pause, settings (controls, perspective
 * strength, volume, touch buttons) and the hub menu (teleport to discovered hubs, the wardrobe
 * limited to unlocked looks, the district's leaderboards).
 */
import { COSTUMES, HAIRS, type Look, type WorldIndex } from '@parapet-world/schemas';
import { ACTIONS, ACTION_LABEL, type Action } from './input.ts';
import {
  COSTUME_NAMES,
  DIFFICULTY,
  HAIR_NAMES,
  difficultyOf,
  formatSteps,
  unlocked,
  type Profile,
  type Settings,
} from './profile.ts';
import { UNLOCKS } from '@parapet-world/schemas';
import { h } from './ui.ts';

export interface Leaderboard {
  top: { name: string; steps: number }[];
  /** The player's best, if any. */
  mine?: number;
  /** Where the entries come from. */
  source: 'server' | 'local';
}

export interface MenuHost {
  readonly profile: Profile;
  readonly world: WorldIndex;
  /** Lines shown under the title (content source, missing pieces, online status). */
  titleNotes(): string[];
  /** The perspective strength the content uses by default (the slider's maximum). */
  readonly maxPerspective: number;
  play(name: string): void;
  resume(): void;
  quitToTitle(): void;
  teleport(hub: number): void;
  setLook(look: Look): void;
  settingsChanged(s: Settings): void;
  leaderboard(route: number): Leaderboard;
  /** The next key pressed goes to `cb` instead of the game (rebinding). */
  captureKey(cb: (code: string) => void): void;
  /** The hub the runner stands in (-1 none). */
  readonly hubHere: number;
  /** Whether the on-screen buttons are shown (the controls overlay explains those then). */
  touchActive(): boolean;
  /** The controls overlay was read. */
  helpSeen(): void;
}

export type MenuKind = 'title' | 'pause' | 'settings' | 'hub' | 'help';

export class Menus {
  readonly root: HTMLDivElement;
  private readonly host: MenuHost;
  open: MenuKind | null = null;
  private back: MenuKind | null = null;
  private hubTab: 'teleport' | 'wardrobe' | 'boards' = 'teleport';

  constructor(host: MenuHost) {
    this.host = host;
    this.root = h('div', { class: 'menus' });
  }

  close(): void {
    this.open = null;
    this.root.replaceChildren();
  }

  show(kind: MenuKind, back: MenuKind | null = null): void {
    this.open = kind;
    this.back = back;
    const card = h('div', { class: 'card' });
    if (kind === 'title') this.title(card);
    else if (kind === 'pause') this.pause(card);
    else if (kind === 'settings') this.settings(card);
    else if (kind === 'help') this.help(card);
    else this.hub(card);
    this.root.replaceChildren(
      h('div', { class: kind === 'hub' ? 'screen side' : 'screen', role: 'dialog' }, card),
    );
    const first = card.querySelector<HTMLElement>('input[type=text], .btn.primary, .btn');
    first?.focus();
  }

  private title(card: HTMLDivElement): void {
    const p = this.host.profile;
    const name = h('input', {
      type: 'text',
      maxlength: 16,
      placeholder: 'Your name',
      value: p.name,
      'aria-label': 'Name',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const go = (): void => {
      const n = name.value.trim().replace(/\s+/g, ' ').slice(0, 16);
      if (!n) {
        name.focus();
        return;
      }
      this.host.play(n);
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    card.append(
      h('h1', {}, 'Parapet World'),
      h('p', { class: 'lead' }, 'Run the rooftops, the warehouses, the factory and the sewer.'),
      h(
        'div',
        { class: 'field' },
        name,
        h('button', { class: 'btn primary', onclick: go }, 'Play'),
      ),
      h(
        'div',
        { class: 'grid2' },
        h('button', { class: 'btn', onclick: () => this.show('settings', 'title') }, 'Settings'),
      ),
      h('div', { class: 'notes' }, this.host.titleNotes().join('\n')),
    );
    (card.querySelector('.notes') as HTMLElement).style.whiteSpace = 'pre-line';
  }

  private pause(card: HTMLDivElement): void {
    card.append(
      h('h2', {}, 'Paused'),
      h(
        'div',
        { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => this.host.resume() }, 'Resume'),
        this.host.hubHere >= 0
          ? h('button', { class: 'btn', onclick: () => this.show('hub') }, 'Hub menu')
          : null,
        h('button', { class: 'btn', onclick: () => this.show('help', 'pause') }, 'Controls'),
        h('button', { class: 'btn', onclick: () => this.show('settings', 'pause') }, 'Settings'),
        h('button', { class: 'btn', onclick: () => this.host.quitToTitle() }, 'Back to the title'),
      ),
      h('p', { class: 'notes' }, 'Esc resumes.'),
    );
  }

  private settings(card: HTMLDivElement): void {
    const s = this.host.profile.settings,
      changed = (): void => this.host.settingsChanged(s);
    const keyName = (code: string): string =>
      code
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Arrow/, '') || code;
    const bindRow = (a: Action): HTMLDivElement => {
      const b = h('button', { class: 'btn mono' }, keyName(s.bindings[a]));
      b.addEventListener('click', () => {
        b.textContent = 'press a key';
        this.host.captureKey((code) => {
          if (code !== 'Escape') {
            s.bindings[a] = code;
            changed();
          }
          b.textContent = keyName(s.bindings[a]);
        });
      });
      return h('div', { class: 'row' }, h('span', {}, ACTION_LABEL[a]), b);
    };
    const max = this.host.maxPerspective;
    const persp = h('input', {
      type: 'range',
      min: 0,
      max,
      step: 0.01,
      value: Math.min(s.perspective, max),
      'aria-label': 'Perspective strength',
    });
    const perspV = h(
      'span',
      { class: 'mono' },
      `${Math.round(Math.min(s.perspective, max) * 100)}%`,
    );
    persp.addEventListener('input', () => {
      s.perspective = +persp.value;
      perspV.textContent = `${Math.round(s.perspective * 100)}%`;
      changed();
    });
    const vol = h('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      value: s.volume,
      'aria-label': 'Volume',
    });
    const volV = h('span', { class: 'mono' }, `${Math.round(s.volume * 100)}%`);
    vol.addEventListener('input', () => {
      s.volume = +vol.value;
      volV.textContent = `${Math.round(s.volume * 100)}%`;
      changed();
    });
    const touch = h(
      'select',
      { 'aria-label': 'Touch buttons' },
      h('option', { value: 'auto' }, 'on touch screens'),
      h('option', { value: 'on' }, 'always'),
      h('option', { value: 'off' }, 'never'),
    );
    touch.value = s.touch;
    touch.addEventListener('change', () => {
      s.touch = touch.value as Settings['touch'];
      changed();
    });
    card.append(
      h('h2', {}, 'Settings'),
      h('h3', {}, 'Controls'),
      h('p', {}, 'Arrows and WASD always work; a gamepad works as it is.'),
      ...ACTIONS.map(bindRow),
      h('h3', {}, 'Picture'),
      h('div', { class: 'slider' }, h('span', {}, 'Perspective'), persp, perspV),
      h('p', {}, 'Lower it for motion comfort; 0 is flat.'),
      h('h3', {}, 'Sound'),
      h('div', { class: 'slider' }, h('span', {}, 'Volume'), vol, volV),
      h('h3', {}, 'Touch buttons'),
      h('div', { class: 'row' }, h('span', {}, 'Show'), touch),
      h(
        'div',
        { class: 'stack', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: () => this.goBack() }, 'Done'),
      ),
    );
  }

  /**
   * The controls: the moves and how to make them, for the keyboard (with the player's bindings)
   * or the on-screen buttons. Shown by itself on the first play, and from the pause menu.
   */
  private help(card: HTMLDivElement): void {
    const b = this.host.profile.settings.bindings,
      touch = this.host.touchActive(),
      key = (code: string): string =>
        code
          .replace(/^Key/, '')
          .replace(/^Digit/, '')
          .replace(/^Arrow/, '') || code;
    const k = (...names: string[]): HTMLSpanElement =>
      h('span', { class: 'keys' }, ...names.map((n) => h('span', { class: 'kbd' }, n)));
    const L = touch ? '◀' : '←',
      Rt = touch ? '▶' : '→',
      U = touch ? '▲' : '↑',
      D = touch ? '▼' : '↓',
      A = touch ? 'A' : key(b.action);
    const row = (keys: HTMLSpanElement, what: string, note = ''): HTMLElement[] => [
      keys,
      h('span', { class: 'what' }, what, note ? h('small', {}, ` ${note}`) : null),
    ];
    const rows: HTMLElement[] = [
      ...row(k(L, Rt), 'Run', touch ? '' : `(also ${key(b.left)} ${key(b.right)})`),
      ...row(k(U), 'Jump', touch ? '' : `(also ${key(b.up)})`),
      ...row(k(U), 'Wall run: jump into a high wall while running, hold to keep going up'),
      ...row(k(Rt, Rt), 'Tiger jump: let go of forward while running fast, press it again'),
      ...row(k(D), 'Roll: tap just before landing to roll out of a big drop'),
      ...row(k(D), 'Slide under a low ceiling while running; drop through planks'),
      ...row(k(U), 'Ledges: jump at a ledge to grab it; up climbs, down drops, back jumps off'),
      ...row(k(U, D), 'Ladders: up or down at a ladder'),
      ...row(k(A), 'Front flip while running, back flip standing'),
    ];
    if (!touch) rows.push(...row(k('Esc'), 'Pause'), ...row(k('E'), 'Hub menu, inside a hub'));
    card.append(
      h('h2', {}, 'How to run'),
      h('p', {}, touch ? 'The buttons hold like keys.' : 'Arrows or WASD; a gamepad works too.'),
      h('div', { class: 'help' }, ...rows),
      h(
        'div',
        { class: 'stack', style: 'margin-top:16px' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              this.host.helpSeen();
              this.goBack();
            },
          },
          'Got it',
        ),
      ),
    );
  }

  /** Escape or Done: back to the menu that opened this one, else closes. */
  goBack(): void {
    if (this.open === 'title') return;
    if (this.back) this.show(this.back);
    else this.host.resume();
  }

  private hub(card: HTMLDivElement): void {
    const host = this.host,
      w = host.world,
      here = w.hubs[host.hubHere],
      tab = (id: typeof this.hubTab, label: string): HTMLButtonElement =>
        h(
          'button',
          {
            class: this.hubTab === id ? 'btn on' : 'btn',
            onclick: () => {
              this.hubTab = id;
              this.show('hub', this.back);
            },
          },
          label,
        );
    card.append(
      h('h2', {}, here ? here.name : 'Hub'),
      h(
        'div',
        { class: 'tabs' },
        tab('teleport', 'Teleport'),
        tab('wardrobe', 'Wardrobe'),
        tab('boards', 'Leaderboards'),
      ),
    );
    if (this.hubTab === 'teleport') {
      const list = h('div', { class: 'stack' });
      w.hubs.forEach((hub, i) => {
        const known = host.profile.hubs.includes(hub.id),
          isHere = i === host.hubHere;
        list.append(
          h(
            'div',
            { class: 'row' },
            h('span', {}, known ? hub.name : 'Undiscovered hub'),
            h(
              'button',
              { class: 'btn', disabled: !known || isHere, onclick: () => host.teleport(i) },
              isHere ? 'Here' : 'Go',
            ),
          ),
        );
      });
      card.append(list);
      // the district's clues for finds not yet found
      const clues = w.finds.filter(
        (f) => here && f.district === here.district && !host.profile.finds.includes(f.id),
      );
      if (clues.length) {
        card.append(h('h3', {}, 'Rumours'), ...clues.map((f) => h('p', {}, f.clue)));
      }
    } else if (this.hubTab === 'wardrobe') {
      const finds = host.profile.finds.length,
        u = unlocked(finds),
        look = host.profile.look,
        need = (id: string): string => {
          const x = UNLOCKS.find((k) => k.id === id);
          return x ? `${x.finds} finds` : '';
        };
      const costumes = h('div', { class: 'grid2' });
      for (const c of COSTUMES) {
        const open = u.costumes.includes(c);
        costumes.append(
          h(
            'button',
            {
              class: look.costume === c ? 'btn on' : 'btn',
              disabled: !open,
              onclick: () => {
                host.setLook({ ...look, costume: c });
                this.show('hub', this.back);
              },
            },
            open ? COSTUME_NAMES[c] : `${COSTUME_NAMES[c]} (${need(c)})`,
          ),
        );
      }
      const hairs = h('div', { class: 'grid2' });
      for (const hr of HAIRS) {
        const open = u.hairs.includes(hr);
        hairs.append(
          h(
            'button',
            {
              class: look.hair === hr ? 'btn on' : 'btn',
              disabled: !open,
              onclick: () => {
                host.setLook({ ...look, hair: hr });
                this.show('hub', this.back);
              },
            },
            open ? HAIR_NAMES[hr] : `${HAIR_NAMES[hr]} (${need(hr)})`,
          ),
        );
      }
      card.append(
        h('p', {}, `Finds: ${finds} / ${w.finds.length}. Finds unlock costumes and hair.`),
        h('h3', {}, 'Costume'),
        costumes,
        h('h3', {}, 'Hair'),
        hairs,
      );
    } else {
      const routes = w.routes
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !here || r.district === here.district);
      if (!routes.length) card.append(h('p', {}, 'No time trials in this district yet.'));
      for (const { r, i } of routes) {
        const b = host.leaderboard(i);
        const level = difficultyOf(r);
        card.append(
          h('h3', {}, r.name, h('span', { class: `pill d${level}` }, DIFFICULTY[level] ?? '')),
        );
        if (!b.top.length) card.append(h('p', {}, 'No times yet.'));
        b.top.forEach((e, k) =>
          card.append(
            h(
              'div',
              { class: 'row' },
              h('span', {}, `${k + 1}. ${e.name}`),
              h('span', { class: 'mono' }, formatSteps(e.steps)),
            ),
          ),
        );
        card.append(
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'k' }, b.source === 'local' ? 'Your best (offline)' : 'Your best'),
            h('span', { class: 'mono' }, b.mine ? formatSteps(b.mine) : '-'),
          ),
        );
      }
    }
    card.append(
      h(
        'div',
        { class: 'stack', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: () => this.host.resume() }, 'Close'),
      ),
    );
  }
}
