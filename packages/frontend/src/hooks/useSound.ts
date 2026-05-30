import { useCallback, useRef } from 'react';

import buttonUrl from '../../../content/button.wav?url';
import defeatUrl from '../../../content/defeat.wav?url';
import disarmUrl from '../../../content/disarm.wav?url';
import explosionUrl from '../../../content/explosion.wav?url';
import lockedCellUrl from '../../../content/locked_cell.wav?url';
import plantMineUrl from '../../../content/plant_mine.wav?url';
import scanUrl from '../../../content/scan.wav?url';
import victoryUrl from '../../../content/victory.wav?url';

export type SoundName =
  | 'button'
  | 'defeat'
  | 'disarm'
  | 'explosion'
  | 'locked_cell'
  | 'plant_mine'
  | 'scan'
  | 'victory';

// Базовая громкость для каждого звука (в дБ). Отрицательные значения = тише.
const BASE_GAIN_DB: Record<SoundName, number> = {
  button: -9,
  defeat: -10,
  disarm: -9,
  explosion: -7,
  locked_cell: -6,
  plant_mine: -9,
  scan: -5,
  victory: -10,
};

// Диапазон случайной вариации к базовой громкости.
const GAIN_VARIATION_DB = 1;

type SoundBuffers = Partial<Record<SoundName, AudioBuffer>>;

const SOUND_URLS: Record<SoundName, string> = {
  button: buttonUrl,
  defeat: defeatUrl,
  disarm: disarmUrl,
  explosion: explosionUrl,
  locked_cell: lockedCellUrl,
  plant_mine: plantMineUrl,
  scan: scanUrl,
  victory: victoryUrl,
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export interface UseSoundOptions {
  /** Ref на флаг «звук выключен». Читается на момент воспроизведения. */
  mutedRef: React.MutableRefObject<boolean>;
  /** Ref на множитель громкости (0..2). Читается на момент воспроизведения. */
  volumeRef: React.MutableRefObject<number>;
}

export function useSound({ mutedRef, volumeRef }: UseSoundOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<SoundBuffers>({});
  const loadingRef = useRef<Partial<Record<SoundName, Promise<void>>>>({});

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const loadSound = useCallback(async (name: SoundName) => {
    if (buffersRef.current[name]) return;
    if (loadingRef.current[name]) return loadingRef.current[name];

    const loading = (async () => {
      const context = getAudioContext();
      const response = await fetch(SOUND_URLS[name]);
      const arrayBuffer = await response.arrayBuffer();
      buffersRef.current[name] = await context.decodeAudioData(arrayBuffer);
    })();

    loadingRef.current[name] = loading;
    await loading;
  }, [getAudioContext]);

  const preload = useCallback(() => {
    (Object.keys(SOUND_URLS) as SoundName[]).forEach((name) => {
      void loadSound(name);
    });
  }, [loadSound]);

  const play = useCallback((name: SoundName) => {
    if (mutedRef.current) return;

    void (async () => {
      try {
        const context = getAudioContext();
        if (context.state === 'suspended') await context.resume();
        await loadSound(name);

        const buffer = buffersRef.current[name];
        if (!buffer || mutedRef.current) return;

        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();

        source.buffer = buffer;
        source.playbackRate.value = randomBetween(0.97, 1.03);

        filter.type = 'lowpass';
        filter.frequency.value = randomBetween(8000, 18000);
        filter.Q.value = randomBetween(0.25, 1.2);

        const panner = context.createStereoPanner();
        panner.pan.value = randomBetween(-0.05, 0.05);

        const baseDb = BASE_GAIN_DB[name];
        const baseGain = dbToGain(baseDb + randomBetween(-GAIN_VARIATION_DB, GAIN_VARIATION_DB));
        // volumeRef.current — пользовательский множитель 0..2
        gain.gain.value = baseGain * volumeRef.current;

        source.connect(filter);
        filter.connect(panner);
        panner.connect(gain);
        gain.connect(context.destination);
        source.start();
      } catch (error) {
        console.warn('[sound] failed to play', name, error);
      }
    })();
  }, [getAudioContext, loadSound, mutedRef, volumeRef]);

  // Отложенное воспроизведение (например, для победы/поражения с задержкой 0.5с).
  const playDelayed = useCallback((name: SoundName, delayMs: number) => {
    window.setTimeout(() => play(name), delayMs);
  }, [play]);

  return { play, playDelayed, preload };
}
