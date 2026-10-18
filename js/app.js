// 画面遷移と全体のつなぎ込み。

let currentNightId = null;
let currentSettings = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function collectInput() {
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const condition = document.querySelector('input[name="condition"]:checked').value;
  const behaviors = Array.from(document.querySelectorAll('input[name="behavior"]:checked')).map(el => el.value);
  const plannedWakeTime = document.getElementById('plannedWakeTime').value;
  return { mood, condition, behaviors, plannedWakeTime };
}

function fillConfirmFields(settings) {
  document.getElementById('s_carrier').value = settings.carrier;
  document.getElementById('s_beatStart').value = settings.beatStart;
  document.getElementById('s_beatEnd').value = settings.beatEnd;
  document.getElementById('s_rampMin').value = settings.rampMin;
  document.getElementById('s_beatEnabled').checked = settings.beatEnabled;
  document.getElementById('s_noiseType').value = settings.noiseType;
  document.getElementById('s_toneVol').value = settings.toneVol;
  document.getElementById('s_noiseVol').value = settings.noiseVol;
  document.getElementById('s_vol').value = settings.vol;
  document.getElementById('s_fadeMin').value = settings.fadeMin;
}

function readConfirmFields() {
  return {
    carrier: +document.getElementById('s_carrier').value,
    beatStart: +document.getElementById('s_beatStart').value,
    beatEnd: +document.getElementById('s_beatEnd').value,
    rampMin: +document.getElementById('s_rampMin').value,
    beatEnabled: document.getElementById('s_beatEnabled').checked,
    noiseType: document.getElementById('s_noiseType').value,
    toneVol: +document.getElementById('s_toneVol').value,
    noiseVol: +document.getElementById('s_noiseVol').value,
    vol: +document.getElementById('s_vol').value,
    fadeMin: +document.getElementById('s_fadeMin').value,
  };
}

function renderWakeRecommend() {
  const list = document.getElementById('wakeRecommend');
  list.innerHTML = '';
  recommendWakeTimes(new Date()).forEach(({ cycles, time }) => {
    const li = document.createElement('li');
    const hm = time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    li.textContent = `${cycles}サイクル: ${hm} 頃`;
    list.appendChild(li);
  });
}

function goToConfirm() {
  const input = collectInput();
  const { settings: ruleSettings, notes } = deriveSoundSettings(input);
  const abEnabled = document.getElementById('abTestToggle').checked;
  const { settings, isNoBeatNight } = applyAbTest(ruleSettings, abEnabled);

  currentSettings = { settings, input, isNoBeatNight };

  const notesEl = document.getElementById('settingNotes');
  notesEl.innerHTML = '';
  notes.forEach(n => {
    const li = document.createElement('li');
    li.textContent = n;
    notesEl.appendChild(li);
  });
  if (!notes.length) {
    const li = document.createElement('li');
    li.textContent = '特に補正はありません(標準設定)';
    notesEl.appendChild(li);
  }

  fillConfirmFields(settings);
  renderWakeRecommend();
  showScreen('screenConfirm');
}

async function startNight() {
  const settings = readConfirmFields();
  const { input, isNoBeatNight } = currentSettings;

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
  } catch (e) { /* 対応していない端末では何もしない */ }
  await ctx.resume();

  const startTime = Date.now();
  currentNightId = await Storage.saveNightStart({
    startTime,
    input,
    settings,
    isNoBeatNight,
  });

  const soundHandle = startSound(ctx, settings);
  await Night.enter({ ctx, sound: soundHandle, onStop: onNightStop });
}

async function onNightStop(reason) {
  if (currentNightId != null) {
    const wakeTime = Date.now();
    const record = await Storage.completeNight(currentNightId, { wakeTime, wakeSource: reason });
    if (record) await showWakeSummaryFromRecord(record);
  }
  currentNightId = null;
}

function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

async function showWakeSummaryFromRecord(record) {
  const hm = t => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const box = document.getElementById('wakeSummary');
  box.innerHTML = `
    <p>就寝: ${hm(record.startTime)}<br>
    起床: ${hm(record.wakeTime)}<br>
    睡眠時間: ${formatDuration(record.wakeTime - record.startTime)}</p>`;
  showScreen('screenWake');
}

function initHelpScreen() {
  const url = location.origin + location.pathname.replace(/index\.html$/, '') + '?wake=1';
  document.getElementById('wakeUrl').textContent = url;
}

function wireEvents() {
  document.getElementById('toConfirmBtn').onclick = goToConfirm;
  document.getElementById('backToInputBtn').onclick = () => showScreen('screenInput');
  document.getElementById('startNightBtn').onclick = startNight;
  document.getElementById('helpBtn').onclick = () => showScreen('screenHelp');
  document.getElementById('helpBackBtn').onclick = () => showScreen('screenInput');
  document.getElementById('wakeToInputBtn').onclick = () => showScreen('screenInput');

  const abToggle = document.getElementById('abTestToggle');
  abToggle.checked = localStorage.getItem('abTestEnabled') === '1';
  abToggle.onchange = () => localStorage.setItem('abTestEnabled', abToggle.checked ? '1' : '0');
}

async function init() {
  wireEvents();
  initHelpScreen();

  const wokenRecord = await Night.handleWakeQuery();
  if (wokenRecord) {
    await showWakeSummaryFromRecord(wokenRecord);
  } else {
    showScreen('screenInput');
  }
}

document.addEventListener('DOMContentLoaded', init);
