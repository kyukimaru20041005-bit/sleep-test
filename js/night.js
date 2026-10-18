// 夜間モード(黒画面)と、画面の前面維持・復帰処理。
// iOS Safari の制約(CLAUDE.md 4章)を前提に、
// - visibilitychange で前面に戻ったら AudioContext.resume() と WakeLock 再取得
// - 有機ELの焼き付けを避けるため、時計はほぼ真っ黒・1分ごとに位置を変える
// を行う。

const Night = (() => {
  let wakeLock = null;
  let clockTimer = null;
  let controlsHideTimer = null;
  let audioCtx = null;
  let soundHandle = null;
  let dim = true;
  let els = {};
  let onStop = null; // 「停止」ボタンが押されたときのコールバック

  function cacheEls() {
    els = {
      screen: document.getElementById('nightScreen'),
      clock: document.getElementById('nightClock'),
      controls: document.getElementById('nightControls'),
      stopBtn: document.getElementById('stopNightBtn'),
      brightnessBtn: document.getElementById('brightnessBtn'),
      status: document.getElementById('nightStatus'),
    };
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
      // 取得に失敗しても動作は続ける(仕様 4章-5)
      console.warn('wakeLock error', e);
    }
  }

  function moveClock() {
    const d = new Date();
    els.clock.textContent =
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    els.clock.style.left = (10 + Math.random() * 60) + '%';
    els.clock.style.top = (15 + Math.random() * 60) + '%';
  }

  function showControlsTemporarily() {
    els.controls.style.display = 'block';
    clearTimeout(controlsHideTimer);
    controlsHideTimer = setTimeout(() => {
      els.controls.style.display = 'none';
    }, 10000);
  }

  function toggleBrightness() {
    dim = !dim;
    els.clock.style.opacity = dim ? '0.15' : '0.5';
  }

  async function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!wakeLock) await requestWakeLock();
    if (audioCtx && audioCtx.state !== 'running') {
      try { await audioCtx.resume(); } catch (e) { /* 実機では失敗することがある */ }
    }
  }

  /**
   * opts = { ctx, sound, onStop }
   * ctx: AudioContext, sound: sound.js の startSound() が返した { stop }
   */
  async function enter(opts) {
    cacheEls();
    audioCtx = opts.ctx;
    soundHandle = opts.sound;
    onStop = opts.onStop;

    els.screen.style.display = 'block';
    els.controls.style.display = 'none';
    dim = true;
    els.clock.style.opacity = '0.15';

    moveClock();
    clockTimer = setInterval(moveClock, 60000);

    els.screen.onclick = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      showControlsTemporarily();
    };
    els.stopBtn.onclick = () => exit('manual');
    els.brightnessBtn.onclick = toggleBrightness;

    document.addEventListener('visibilitychange', handleVisibilityChange);

    await requestWakeLock();
  }

  function exit(reason) {
    clearInterval(clockTimer);
    clearTimeout(controlsHideTimer);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    els.screen.style.display = 'none';

    if (soundHandle) { try { soundHandle.stop(); } catch (e) {} }
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }

    if (onStop) onStop(reason);
  }

  /**
   * ページ読み込み時に呼ぶ。URL に ?wake=1 が付いていたら、
   * 進行中の夜レコードを完了させて record を返す(なければ null)。
   * 処理後は URL から ?wake=1 を取り除く(再読み込みで二重処理しないため)。
   */
  async function handleWakeQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get('wake') !== '1') return null;

    history.replaceState(null, '', location.pathname);

    const active = await Storage.getActiveNight();
    if (!active) return null;

    const wakeTime = Date.now();
    const record = await Storage.completeNight(active.id, {
      wakeTime,
      wakeSource: 'shortcut',
    });
    return record;
  }

  return { enter, exit, handleWakeQuery };
})();
