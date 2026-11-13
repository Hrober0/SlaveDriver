let audio: AudioContext | null = null;

/** Synthesized whip crack: a very short high-passed noise burst. `vol` in 0..1. */
export function playCrack(vol: number): void {
  try {
    audio = audio || new AudioContext();
    const len = Math.floor(audio.sampleRate * 0.09);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (audio.sampleRate * 0.008));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const hp = audio.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const gain = audio.createGain();
    gain.gain.value = 0.25 + vol * 0.75;
    src.connect(hp).connect(gain).connect(audio.destination);
    src.start();
  } catch { /* audio unavailable */ }
}

/** Says `text` in a randomly pitched voice, interrupting the previous line. */
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15 + Math.random() * 0.3;
    u.pitch = 0.8 + Math.random() * 0.8;
    speechSynthesis.speak(u);
  } catch { /* no TTS available (common on Linux without speech-dispatcher) */ }
}
