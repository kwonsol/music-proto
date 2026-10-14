// 원곡 박자·샘플 후보를 브라우저와 같은 코드로 오프라인 확인하는 스크립트.
// 사용법 (macOS):
//   afconvert -f WAVE -d LEI16@44100 public/dj/song.mp3 /tmp/song.wav
//   node scripts/dj-analyze.ts /tmp/song.wav
import { readFileSync } from 'node:fs';
import { estimateTempo, onsetEnvelope, pickOnsets, rankSlices, toMono } from '../src/dj/audio/analysis.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dj-analyze.ts <16bit PCM wav>');
  process.exit(1);
}
const buf = readFileSync(path);
let p = 12;
let channels = 2;
let sr = 44100;
let data: Buffer | null = null;
while (p < buf.length) {
  const id = buf.toString('ascii', p, p + 4);
  const size = buf.readUInt32LE(p + 4);
  if (id === 'fmt ') {
    channels = buf.readUInt16LE(p + 10);
    sr = buf.readUInt32LE(p + 12);
  } else if (id === 'data') {
    data = buf.subarray(p + 8, p + 8 + size);
  }
  p += 8 + size + (size % 2);
}
if (!data) throw new Error('no data chunk');
const frames = data.length / 2 / channels;
const chans = Array.from({ length: channels }, () => new Float32Array(frames));
for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) chans[c][i] = data.readInt16LE((i * channels + c) * 2) / 32768;

const mono = toMono(chans);
const onset = onsetEnvelope(mono, sr);
const tempo = estimateTempo(onset);
const onsets = pickOnsets(onset);
const beat = 60 / tempo.bpm;
console.log('duration', (frames / sr).toFixed(3), 's  sr', sr);
console.log('tempo', tempo);
console.log('onsets', onsets.length, onsets.slice(0, 16).map((o) => o.time.toFixed(3)).join(' '));
// 박 격자와 실제 타격 시작점의 오차 분포
const errs = onsets
  .filter((o) => o.strength > 0.3)
  .map((o) => {
    const ph = (o.time - tempo.firstBeat) / (beat / 2);
    return (ph - Math.round(ph)) * (beat / 2) * 1000;
  });
console.log('strong onsets vs 1/2-beat grid (ms):', errs.map((e) => e.toFixed(0)).join(' '));
const a = rankSlices(mono, sr, onsets, tempo, { length: beat / 2 })[0];
console.log('stutterA', a);
console.log('stutterB', rankSlices(mono, sr, onsets, tempo, { length: beat, avoid: [a.start], preferBright: -1 })[0]);
console.log('echo', rankSlices(mono, sr, onsets, tempo, { length: beat / 4, avoid: [a.start], preferBright: 1 })[0]);
