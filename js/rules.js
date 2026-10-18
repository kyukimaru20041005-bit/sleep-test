// 入力(気分・行動・体調)からサウンド設定を作る、単純な対応ルール。
// 「AI」ではない。ここに書かれた数値は根拠のある研究値ではなく、すべて仮の値。
// 実際に使いながら MOOD_RULES / BEHAVIOR_RULES / CONDITION_RULES の数値を調整していく想定。

// 2026-10-18: 実機で聞いた結果「音量が大きすぎる」「ノイズの質感が気になる(耳につくサー音)」
// とのフィードバックを受け、全体的に音量を下げ、ビートの開始周波数を
// α波帯域(8〜13Hz、リラックス状態)寄りにして、そこからθ波・δ波(入眠〜睡眠)へ
// 下げていく設計に変更。ノイズ自体の質感はsound.js側のローパスフィルターで調整する。
const BASE_SETTINGS = {
  carrier: 200,     // モノーラルビートの基準周波数 (Hz)
  beatStart: 9,     // うなりの開始周波数 (Hz) = α波帯域
  beatEnd: 3,       // うなりの終了周波数 (Hz) = θ波〜δ波帯域
  rampMin: 30,      // うなりが beatStart→beatEnd に変化する時間 (分)
  noiseType: 'pink',
  toneVol: 20,      // ビート音量 (0-100)
  noiseVol: 30,     // ノイズ音量 (0-100)
  vol: 40,          // 全体音量 (0-100)
  fadeMin: 45,      // フェードアウト開始 (分, 0=しない)
  beatEnabled: true,
};

// 気分: ベースとなる設定を上書きする。選択は1つだけ。
const MOOD_RULES = {
  '落ち着いている': { beatStart: 9, beatEnd: 3, rampMin: 20, noiseType: 'pink', toneVol: 20, noiseVol: 28 },
  '不安・考えごと': { beatStart: 10, beatEnd: 3, rampMin: 35, noiseType: 'brown', toneVol: 18, noiseVol: 32 },
  'イライラ': { beatStart: 11, beatEnd: 4, rampMin: 30, noiseType: 'pink', toneVol: 15, noiseVol: 34 },
  '疲れている': { beatStart: 8, beatEnd: 1.5, rampMin: 15, noiseType: 'pink', toneVol: 18, noiseVol: 25 },
  '興奮している': { beatStart: 11, beatEnd: 2, rampMin: 40, noiseType: 'brown', toneVol: 15, noiseVol: 32 },
};

// 直近2時間の行動: 複数選択可。差分(delta)をベースに足し込む。
const BEHAVIOR_RULES = {
  'スマホ・PC': { rampMin: +10, noiseVol: +5, note: '画面の刺激を考慮し、クールダウン時間を延長' },
  '運動': { rampMin: +5, note: '興奮が残っている可能性を考慮' },
  '飲酒': { vol: -10, note: '聴覚が敏感になりやすいため音量を控えめに' },
  'カフェイン': { rampMin: +15, fadeMin: +15, note: '覚醒作用を考慮し長めに' },
  '入浴': { rampMin: -5, note: '体が温まり入眠しやすいためクールダウンを短縮' },
  '食事': {},
  '特になし': {},
};

// 体調: 最後に適用する補正。
const CONDITION_RULES = {
  '良い': {},
  '普通': {},
  'だるい': { vol: -10, toneVol: -5, note: '体調を考慮し音量を全体的に控えめに' },
  '頭痛・不調': { beatEnabled: false, noiseVol: +10, note: '低周波の刺激を避けるためビートを無効化し、ノイズのみに' },
};

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * input = {
 *   mood: string,            // MOOD_RULES のキーのいずれか
 *   behaviors: string[],     // BEHAVIOR_RULES のキーの配列(複数可)
 *   condition: string,       // CONDITION_RULES のキーのいずれか
 * }
 * 戻り値: { settings, notes }
 *   settings: sound.js にそのまま渡せる設定
 *   notes: 「なぜその設定になったか」を画面に表示するための説明文の配列
 */
function deriveSoundSettings(input) {
  const settings = Object.assign({}, BASE_SETTINGS);
  const notes = [];

  const mood = MOOD_RULES[input.mood];
  if (mood) {
    Object.assign(settings, mood);
    notes.push(`気分「${input.mood}」に合わせた設定を適用`);
  }

  (input.behaviors || []).forEach(b => {
    const rule = BEHAVIOR_RULES[b];
    if (!rule) return;
    if (rule.rampMin) settings.rampMin += rule.rampMin;
    if (rule.fadeMin) settings.fadeMin += rule.fadeMin;
    if (rule.noiseVol) settings.noiseVol += rule.noiseVol;
    if (rule.vol) settings.vol += rule.vol;
    if (rule.note) notes.push(`「${b}」: ${rule.note}`);
  });

  const cond = CONDITION_RULES[input.condition];
  if (cond) {
    if (cond.vol) settings.vol += cond.vol;
    if (cond.toneVol) settings.toneVol += cond.toneVol;
    if (cond.noiseVol) settings.noiseVol += cond.noiseVol;
    if (cond.beatEnabled === false) settings.beatEnabled = false;
    if (cond.note) notes.push(`体調「${input.condition}」: ${cond.note}`);
  }

  settings.rampMin = clamp(settings.rampMin, 5, 60);
  settings.fadeMin = clamp(settings.fadeMin, 0, 90);
  settings.toneVol = clamp(settings.toneVol, 0, 100);
  settings.noiseVol = clamp(settings.noiseVol, 0, 100);
  settings.vol = clamp(settings.vol, 0, 100);

  return { settings, notes };
}

/**
 * A/Bテスト: 設定でONのとき、一定確率でビートなし(ノイズのみ)の夜にする。
 * どちらだったかは night.js 側で記録するだけで、画面には表示しない。
 */
function applyAbTest(settings, abEnabled, probability = 0.3) {
  const isNoBeatNight = abEnabled && Math.random() < probability;
  if (isNoBeatNight) {
    settings = Object.assign({}, settings, { beatEnabled: false });
  }
  return { settings, isNoBeatNight };
}

/**
 * 90分サイクルに基づく推奨起床時刻。
 * 入眠までの目安15分 + 90分 x サイクル数(4〜6)。あくまで目安。
 */
function recommendWakeTimes(sleepStartDate) {
  const fallAsleepMin = 15;
  const cycles = [4, 5, 6];
  return cycles.map(n => {
    const t = new Date(sleepStartDate.getTime() + (fallAsleepMin + 90 * n) * 60000);
    return { cycles: n, time: t };
  });
}
