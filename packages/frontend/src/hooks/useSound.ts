import { useCallback, useEffect, useRef, useState } from 'react';

import clickUrl from '../../../content/click.wav?url';
import explosionUrl from '../../../content/explosion.wav?url';
import scanUrl from '../../../content/scan.wav?url';

type SoundName = 'click' | 'explosion' | 'scan';

type SoundBuffers = Partial<Record<SoundName, AudioBuffer>>;

const SOUND_URLS: Record<SoundName, string> = {
  click: clickUrl,
  explosion: explosionUrl,
  scan: scanUrl,
};

const STORAGE_KEY = 'minesweeper_sound_muted';

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function useSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<SoundBuffers>({});
  const loadingRef = useRef<Partial<Record<SoundName, Promise<void>>>>({});
  const mutedRef = useRef(false);

  const [muted, setMuted] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  useEffect(() => {
    mutedRef.current = muted;
    localStorage.setItem(STORAGE_KEY, String(muted));
  }, [muted]);

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
        source.playbackRate.value = randomBetween(0.9, 1.1);

        filter.type = 'lowpass';
        filter.frequency.value = randomBetween(6500, 18000);
        filter.Q.value = randomBetween(0.25, 1.4);

        const panner = context.createStereoPanner();
        panner.pan.value = randomBetween(-0.08, 0.08);

        gain.gain.value = dbToGain(randomBetween(-4, 3));

        source.connect(filter);
        filter.connect(panner);
        panner.connect(gain);
        gain.connect(context.destination);
        source.start();
      } catch (error) {
        console.warn('[sound] failed to play', name, error);
      }
    })();
  }, [getAudioContext, loadSound]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  return { muted, play, preload, toggleMuted };
}
