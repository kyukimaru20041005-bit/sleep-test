// モノーラルビート + ノイズの生成。Web Audio API の自動化(linearRampToValueAtTime など)で
// 音量・周波数の変化をあらかじめ予約しておくことで、JavaScript が一時的に止まっても
// 音声エンジン側でスケジュールが進む(ことを期待している。実機未確認)。

function makeNoiseBuffer(ctx, type, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);

  if (type === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  // pink (デフォルト)
  let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    p0 = 0.99886 * p0 + w * 0.0555179;
    p1 = 0.99332 * p1 + w * 0.0750759;
    p2 = 0.96900 * p2 + w * 0.1538520;
    p3 = 0.86650 * p3 + w * 0.3104856;
    p4 = 0.55000 * p4 + w * 0.5329522;
    p5 = -0.7616 * p5 - w * 0.0168980;
    d[i] = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + w * 0.5362) * 0.11;
    p6 = w * 0.115926;
  }
  return buf;
}

/**
 * settings: rules.js の deriveSoundSettings() が返す settings と同じ形
 * 戻り値: { stop() } — 呼ぶと即座にすべて停止する
 */
function startSound(ctx, settings) {
  const now = ctx.currentTime;
  const vol = settings.vol / 100;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(vol, now + 10); // 10秒フェードイン

  if (settings.fadeMin > 0) {
    const fadeStart = now + settings.fadeMin * 60;
    master.gain.setValueAtTime(vol, fadeStart);
    master.gain.linearRampToValueAtTime(0, fadeStart + 300); // 5分かけてフェードアウト
  }
  master.connect(ctx.destination);

  const oscs = [];
  if (settings.beatEnabled) {
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.5 * (settings.toneVol / 100);
    toneGain.connect(master);

    const rampSec = Math.max(1, settings.rampMin * 60);
    const o1 = ctx.createOscillator();
    o1.frequency.value = settings.carrier;
    const o2 = ctx.createOscillator();
    o2.frequency.setValueAtTime(settings.carrier + settings.beatStart, now);
    o2.frequency.linearRampToValueAtTime(settings.carrier + settings.beatEnd, now + rampSec);
    o1.connect(toneGain);
    o2.connect(toneGain);
    o1.start();
    o2.start();
    oscs.push(o1, o2);
  }

  const noiseBuf = makeNoiseBuffer(ctx, settings.noiseType, 30);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = settings.noiseVol / 100;
  noiseSrc.connect(noiseGain);
  noiseGain.connect(master);
  noiseSrc.start();

  function stop() {
    oscs.forEach(o => { try { o.stop(); } catch (e) {} });
    try { noiseSrc.stop(); } catch (e) {}
  }

  return { stop };
}
