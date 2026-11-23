import Phaser from "phaser";

/**
 * Talesreach audio: music (by mood, crossfaded, loaded only when needed),
 * looping ambience layers, and short sound effects. Three volume sliders
 * (music / ambience / effects) are saved on this device.
 *
 * Phones block sound until the first tap; Phaser unlocks on that tap and we
 * start whatever should be playing at that moment.
 */

export type Mood = "tavern" | "day" | "night" | "forest" | "combat";
export type AmbienceLayer = "forest" | "rain" | "fire";
export type Surface = "grass" | "wood";

const MUSIC: Record<Mood, string[]> = {
  tavern: ["audio/music/tavern-old-tower-inn.mp3", "audio/music/tavern-crowded-pub.mp3"],
  day: ["audio/music/day-a-new-town.mp3"],
  night: ["audio/music/night-lament.mp3"],
  forest: ["audio/music/forest-dark-forest.mp3"],
  combat: ["audio/music/combat-battle-theme-a.mp3"],
};

const AMBIENCE: Record<AmbienceLayer, string> = {
  forest: "audio/ambience/forest-day.mp3",
  rain: "audio/ambience/rain.mp3",
  fire: "audio/ambience/fire.mp3",
};

/** Short effects: small, preloaded with the game. */
export const SFX = {
  click: "audio/sfx/ui-click.mp3",
  open: "audio/sfx/ui-open.mp3",
  close: "audio/sfx/ui-close.mp3",
  confirm: "audio/sfx/ui-confirm.mp3",
  error: "audio/sfx/ui-error.mp3",
  select: "audio/sfx/ui-select.mp3",
  coins: "audio/sfx/coins.mp3",
  coins2: "audio/sfx/coins-2.mp3",
  doorOpen: "audio/sfx/door-open.mp3",
  doorClose: "audio/sfx/door-close.mp3",
  cloth: "audio/sfx/cloth.mp3",
  page: "audio/sfx/page.mp3",
  jingleQuest: "audio/sfx/jingle-quest.mp3",
  jingleWelcome: "audio/sfx/jingle-welcome.mp3",
  ...Object.fromEntries(
    [0, 1, 2, 3, 4].flatMap((i) => [
      [`stepGrass${i}`, `audio/sfx/step-grass-${i}.mp3`],
      [`stepWood${i}`, `audio/sfx/step-wood-${i}.mp3`],
    ]),
  ),
} as Record<string, string>;
export type SfxName = keyof typeof SFX;

export interface AudioSettings {
  music: number;
  ambience: number;
  effects: number;
  muted: boolean;
}

const DEFAULTS: AudioSettings = { music: 0.5, ambience: 0.6, effects: 0.8, muted: false };
const STORAGE_KEY = "talesreach.audio";
const FADE_MS = 1500;

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const clamp = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : d);
    return {
      music: clamp(parsed.music, DEFAULTS.music),
      ambience: clamp(parsed.ambience, DEFAULTS.ambience),
      effects: clamp(parsed.effects, DEFAULTS.effects),
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Load the small effects with the game (call from a scene's preload). */
export function preloadSfx(scene: Phaser.Scene) {
  for (const [name, url] of Object.entries(SFX)) scene.load.audio(`sfx:${name}`, url);
}

type AnySound = Phaser.Sound.BaseSound & { volume: number };

class AudioManager {
  settings: AudioSettings = loadSettings();
  private scene: Phaser.Scene | null = null;
  private mood: Mood | null = null;
  private trackIndex = 0;
  private music: AnySound | null = null;
  private currentKey = "";
  private ambience = new Map<AmbienceLayer, { sound: AnySound | null; level: number }>();
  private listeners = new Set<(s: AudioSettings) => void>();

  /** Bind to a long-lived scene (its loader and tweens are used for lazy music). */
  attach(scene: Phaser.Scene) {
    this.scene = scene;
    if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.restart());
    else this.restart();
  }

  get unlocked(): boolean {
    return !!this.scene && !this.scene.sound.locked;
  }

  // ---------- music ----------
  setMood(mood: Mood) {
    if (this.mood === mood) return;
    this.mood = mood;
    this.trackIndex = 0;
    this.playTrack();
  }

  /** Play a specific track of a mood (e.g. the bard's requested song), even if the mood is already playing. */
  playSong(mood: Mood, index: number) {
    this.mood = mood;
    this.trackIndex = index;
    this.playTrack(true);
  }

  private playTrack(force = false) {
    const scene = this.scene;
    const mood = this.mood;
    if (!scene || !mood || scene.sound.locked) return;
    const list = MUSIC[mood];
    const url = list[this.trackIndex % list.length]!;
    const key = `music:${url}`;
    this.withAudio(key, url, () => {
      if (this.mood !== mood) return; // mood changed while loading
      if (!force && this.music && this.currentKey === key) return;
      this.currentKey = key;
      const loop = list.length === 1;
      const next = scene.sound.add(key, { loop, volume: 0 }) as AnySound;
      if (!loop) {
        next.once(Phaser.Sound.Events.COMPLETE, () => {
          if (this.music !== next) return;
          this.trackIndex++;
          this.playTrack();
        });
      }
      next.play();
      this.fadeTo(next, this.musicVolume());
      const old = this.music;
      this.music = next;
      if (old) this.fadeTo(old, 0, () => old.destroy());
    });
  }

  // ---------- ambience ----------
  /** Set how loud each ambience layer is (0..1); layers not listed fade out. */
  setAmbience(levels: Partial<Record<AmbienceLayer, number>>) {
    const scene = this.scene;
    for (const layer of Object.keys(AMBIENCE) as AmbienceLayer[]) {
      const level = levels[layer] ?? 0;
      const entry = this.ambience.get(layer) ?? { sound: null, level: 0 };
      entry.level = level;
      this.ambience.set(layer, entry);
      // Remembered even before audio is ready; restart() plays it once sound is allowed.
      if (!scene || scene.sound.locked) continue;
      if (level > 0 && !entry.sound) {
        const url = AMBIENCE[layer];
        this.withAudio(`amb:${layer}`, url, () => {
          if (entry.sound) return;
          entry.sound = scene.sound.add(`amb:${layer}`, { loop: true, volume: 0 }) as AnySound;
          entry.sound.play();
          this.fadeTo(entry.sound, this.ambienceVolume(entry.level));
        });
      } else if (entry.sound) {
        this.fadeTo(entry.sound, this.ambienceVolume(level));
      }
    }
  }

  // ---------- effects ----------
  play(name: SfxName, opts: { volume?: number; detune?: number } = {}) {
    const scene = this.scene;
    if (!scene || scene.sound.locked || this.settings.muted || this.settings.effects <= 0) return;
    const key = `sfx:${name}`;
    if (!scene.cache.audio.exists(key)) return;
    scene.sound.play(key, {
      volume: this.settings.effects * (opts.volume ?? 1),
      detune: opts.detune ?? 0,
    });
  }

  /** A footstep on a surface, with a little random variety. */
  footstep(surface: Surface, volume = 0.35) {
    const i = Math.floor(Math.random() * 5);
    this.play((surface === "wood" ? `stepWood${i}` : `stepGrass${i}`) as SfxName, {
      volume,
      detune: (Math.random() - 0.5) * 200,
    });
  }

  // ---------- settings ----------
  set(partial: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Private mode or storage blocked: settings just won't be remembered.
    }
    if (this.music) this.music.volume = this.musicVolume();
    for (const entry of this.ambience.values()) {
      if (entry.sound) entry.sound.volume = this.ambienceVolume(entry.level);
    }
    for (const fn of this.listeners) fn(this.settings);
  }

  onChange(fn: (s: AudioSettings) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private musicVolume() {
    return this.settings.muted ? 0 : this.settings.music * 0.6;
  }

  private ambienceVolume(level: number) {
    return this.settings.muted ? 0 : this.settings.ambience * level * 0.7;
  }

  /** Called once the phone allows sound: start what should already be playing. */
  private restart() {
    const mood = this.mood;
    this.mood = null;
    if (mood) this.setMood(mood);
    const levels = Object.fromEntries([...this.ambience].map(([k, v]) => [k, v.level]));
    this.setAmbience(levels);
  }

  /** Load an audio file on demand (music/ambience are not part of the first download). */
  private withAudio(key: string, url: string, ready: () => void) {
    const scene = this.scene;
    if (!scene) return;
    if (scene.cache.audio.exists(key)) return ready();
    // The loader runs one batch at a time: wait for the current batch, then load ours.
    if (scene.load.isLoading()) {
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => this.withAudio(key, url, ready));
      return;
    }
    scene.load.audio(key, url);
    scene.load.once(`filecomplete-audio-${key}`, ready);
    scene.load.start();
  }

  private fadeTo(sound: AnySound, volume: number, done?: () => void) {
    const scene = this.scene;
    if (!scene) return;
    scene.tweens.killTweensOf(sound);
    scene.tweens.add({ targets: sound, volume, duration: FADE_MS, onComplete: () => done?.() });
  }
}

export const audio = new AudioManager();
