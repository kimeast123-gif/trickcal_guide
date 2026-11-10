'use strict';
// ============================================================================
// TEST25 (FIX8.3) Mobile 360° Virtual Joystick, Controller Options &
// Landscape/Portrait View Mode State Machine (`WEB_PORTRAIT` / `GAME_LANDSCAPE` / `GAME_PAUSED`)
// - Reuses unified logical input router: `pressInput(code, sourceId)`, `releaseInput(code, sourceId)`, `releaseAllInputs(reason)`.
// - Replaces the 3 directional buttons on mobile with a single 360° virtual joystick (`#vjoy-base` + `#vjoy-knob`)
//   mapping angle/vector to `ArrowLeft`, `ArrowRight`, and `ArrowDown` (simultaneous down-left / down-right supported;
//   upward drag never triggers jump).
// - Provides persistent user options (`localStorage` key `dudu_mobile_ctrl_prefs_v1`):
//   1. `stickPosition`: `'bottom'` (기본 좌하단/우하단) | `'top'` (좌상단/우상단, HUD 비침범 오프셋)
//   2. `buttonSwap` ('버튼 좌우 배치 바꾸기'): `'normal'` (기본) | `'swapped'` (반전: 스틱 우측 / 점프·대시 좌측)
//   3. `stickSize`: `'small'` | `'medium'` | `'large'`
// - Implements strict 3-state view machine (`WEB_PORTRAIT`, `GAME_LANDSCAPE`, `GAME_PAUSED`) + idempotent `ensurePaused(reason)`:
//   * `WEB_PORTRAIT`: pauses active game without toggle bug, releases all inputs, unlocks page scroll & restores scrollY,
//     shows non-blocking inline notice inside `#game`.
//   * `GAME_LANDSCAPE`: locks page scroll, activates CSS landscape focus mode (`100vw × visualViewport.height`, 16:9 contain),
//     prevents browser touch pan/zoom inside `#game`, and requires explicit user click to resume after portrait pause.
// ============================================================================

const inputSourceMap = new Map(); // Map<logicalCode, Set<sourceId>>
const MOBILE_PREFS_KEY = 'dudu_mobile_ctrl_prefs_v1';

const mobilePrefs = {
  stickPosition: 'bottom', // 'bottom' | 'top'
  buttonSwap: 'normal',    // 'normal' | 'swapped'
  stickSize: 'medium'      // 'small' | 'medium' | 'large'
};

const mobileUIState = {
  viewMode: 'PC_DEFAULT',       // 'WEB_PORTRAIT' | 'GAME_LANDSCAPE' | 'GAME_PAUSED' | 'PC_DEFAULT'
  fullscreenMode: 'inline',     // 'native' | 'css_focus' | 'inline'
  lastPauseReason: null,        // 'portrait' | 'manual' | 'blur' | 'visibility' | 'options' | 'fullscreen_exit' | null
  pausedByPortrait: false,
  scrollLocked: false,
  savedScrollY: 0,
  joyActive: false,
  joyPointerId: null,
  joyVector: { dx: 0, dy: 0, nx: 0, ny: 0, angleDeg: 0 },
  activeStickDirs: { left: false, right: false, down: false },
  prefs: mobilePrefs
};
window.__mobileUIState = mobileUIState;

function pressInput(code, sourceId = 'touch') {
  if (!code) return;
  let sources = inputSourceMap.get(code);
  if (!sources) {
    sources = new Set();
    inputSourceMap.set(code, sources);
  }
  const wasEmpty = sources.size === 0;
  sources.add(sourceId);

  if (wasEmpty) {
    keys.add(code);
    if (typeof p !== 'undefined' && p.guardStun > 0) return;

    if (code === 'Space') {
      if (state !== 'playing') return;
      if (keys.has('ArrowDown') && p.ground && p.on?.thin && !p.on?.dropThroughDisabled) {
        p.drop = p.on; p.y += 3; p.ground = false; p.on = null; p.coyote = 0; p.jumps = 1; p.vy = 70; p.buffer = 0; p.jumpHeld = false;
        lookDownHold = 0;
      } else {
        p.buffer = 0.12;
      }
    } else if (code === 'ShiftLeft') {
      if (state === 'playing') dashRequest = true;
    } else if (code === 'KeyR') {
      if (state !== 'playing') return;
      if (typeof gameMode !== 'undefined' && gameMode === 'challenge') {
        if (typeof retryChallengeStage === 'function') retryChallengeStage();
      } else {
        if (typeof chooseSection === 'function') chooseSection(checkpoint);
      }
    } else if (code === 'Escape') {
      if (typeof pause === 'function') pause();
    }
  }
}

function releaseInput(code, sourceId = 'touch') {
  if (!code) return;
  const sources = inputSourceMap.get(code);
  if (sources) {
    sources.delete(sourceId);
    if (sources.size === 0) {
      keys.delete(code);
      if (code === 'Space' && typeof p !== 'undefined') {
        if (p.hold < (p.jumps === 2 ? 0.22 : 0.24)) p.jumpCut = true;
        p.jumpHeld = false;
      }
    }
  } else {
    keys.delete(code);
  }
}

function resetJoystickVisualAndState() {
  mobileUIState.joyActive = false;
  mobileUIState.joyPointerId = null;
  mobileUIState.joyVector = { dx: 0, dy: 0, nx: 0, ny: 0, angleDeg: 0 };
  mobileUIState.activeStickDirs = { left: false, right: false, down: false };
  const baseEl = typeof $ === 'function' ? $('vjoy-base') : document.getElementById('vjoy-base');
  const knobEl = typeof $ === 'function' ? $('vjoy-knob') : document.getElementById('vjoy-knob');
  if (baseEl) {
    baseEl.classList.remove('active');
    baseEl.setAttribute('data-dir-left', 'false');
    baseEl.setAttribute('data-dir-right', 'false');
    baseEl.setAttribute('data-dir-down', 'false');
  }
  if (knobEl) {
    knobEl.style.transform = 'translate3d(0px, 0px, 0px)';
  }
}

function releaseAllInputs(reason = 'reset') {
  inputSourceMap.clear();
  if (typeof keys !== 'undefined') keys.clear();
  if (typeof p !== 'undefined') {
    p.jumpHeld = false;
  }
  if (typeof dashRequest !== 'undefined') {
    dashRequest = false;
  }
  resetJoystickVisualAndState();
  document.querySelectorAll('.vbtn').forEach(btn => btn.classList.remove('active'));
}

// Idempotent pause helper: NEVER resumes gameplay if already paused!
function ensurePaused(reason = 'manual') {
  releaseAllInputs(reason);
  if (typeof state === 'undefined') return false;

  if (state === 'playing') {
    state = 'paused';
    mobileUIState.lastPauseReason = reason;
    if (reason === 'portrait') {
      mobileUIState.pausedByPortrait = true;
    }
    const subtitle = reason === 'portrait'
      ? '화면을 가로로 돌린 뒤 아래 버튼을 눌러 이어서 플레이하세요.'
      : '아직 못 가본 발판이 있나요?<br>뒤로 돌아가도 괜찮아요.';
    const btnLabel = reason === 'portrait' ? '계속 플레이 →' : '계속 모험하기';
    if (typeof modal === 'function') {
      modal('잠깐 쉬어가요', '두두도 숨 고르는 중', subtitle, btnLabel);
    }
    syncMobileViewMode();
    return true;
  }

  if (state === 'opening' || state === 'ending' || state === 'popup') {
    if (typeof scenePaused !== 'undefined') scenePaused = true;
    mobileUIState.lastPauseReason = reason;
    if (reason === 'portrait') mobileUIState.pausedByPortrait = true;
    syncMobileViewMode();
    return true;
  }

  if (state === 'paused') {
    // Already paused — keep paused and only update reason if portrait
    if (reason === 'portrait') {
      mobileUIState.pausedByPortrait = true;
      mobileUIState.lastPauseReason = 'portrait';
    }
    syncMobileViewMode();
    return false;
  }
  return false;
}

window.pressInput = pressInput;
window.releaseInput = releaseInput;
window.releaseAllInputs = releaseAllInputs;
window.ensurePaused = ensurePaused;

// Load & Save Controller Preferences
function loadMobilePrefs() {
  try {
    const raw = localStorage.getItem(MOBILE_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.stickPosition === 'bottom' || parsed.stickPosition === 'top')) {
        mobilePrefs.stickPosition = parsed.stickPosition;
      }
      if (parsed && (parsed.buttonSwap === 'normal' || parsed.buttonSwap === 'swapped')) {
        mobilePrefs.buttonSwap = parsed.buttonSwap;
      }
      if (parsed && (parsed.stickSize === 'small' || parsed.stickSize === 'medium' || parsed.stickSize === 'large')) {
        mobilePrefs.stickSize = parsed.stickSize;
      }
    }
  } catch (e) {
    // Ignore storage errors in private mode
  }
  applyMobilePrefsToDOM();
}

function saveMobilePrefs() {
  try {
    localStorage.setItem(MOBILE_PREFS_KEY, JSON.stringify(mobilePrefs));
  } catch (e) {
    // Ignore storage errors in private mode
  }
  applyMobilePrefsToDOM();
}

function applyMobilePrefsToDOM() {
  const ctrlEl = typeof $ === 'function' ? $('mobileControls') : document.getElementById('mobileControls');
  if (ctrlEl) {
    ctrlEl.setAttribute('data-stick-pos', mobilePrefs.stickPosition);
    ctrlEl.setAttribute('data-btn-swap', mobilePrefs.buttonSwap);
    ctrlEl.setAttribute('data-stick-size', mobilePrefs.stickSize);
  }
  // Update button labels in settings dialog so '상단/하단' reflects current left/right side clearly
  const isSwapped = mobilePrefs.buttonSwap === 'swapped';
  const btnBottom = document.getElementById('optStickBottom');
  const btnTop = document.getElementById('optStickTop');
  if (btnBottom) btnBottom.textContent = isSwapped ? '우하단 (기본)' : '좌하단 (기본)';
  if (btnTop) btnTop.textContent = isSwapped ? '우상단' : '좌상단';

  document.querySelectorAll('[data-opt-stick-pos]').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-opt-stick-pos') === mobilePrefs.stickPosition);
  });
  document.querySelectorAll('[data-opt-btn-swap]').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-opt-btn-swap') === mobilePrefs.buttonSwap);
  });
  document.querySelectorAll('[data-opt-stick-size]').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-opt-stick-size') === mobilePrefs.stickSize);
  });
}

function setMobilePref(key, value) {
  if (key === 'stickPosition' && (value === 'bottom' || value === 'top')) {
    mobilePrefs.stickPosition = value;
  } else if (key === 'buttonSwap' && (value === 'normal' || value === 'swapped')) {
    mobilePrefs.buttonSwap = value;
  } else if (key === 'stickSize' && (value === 'small' || value === 'medium' || value === 'large')) {
    mobilePrefs.stickSize = value;
  }
  saveMobilePrefs();
}
window.setMobilePref = setMobilePref;

// Detect whether current viewport is a mobile/tablet environment
function isMobileOrTabletViewport() {
  const w = window.innerWidth || document.documentElement.clientWidth || 1280;
  const h = window.innerHeight || document.documentElement.clientHeight || 720;
  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const coarse = window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches);
  const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  return Boolean(coarse || (touchCapable && maxDim <= 1366) || minDim <= 900 || w <= 1024);
}

function updateVisualViewportVars() {
  const vv = window.visualViewport;
  const vvw = vv ? Math.round(vv.width) : window.innerWidth;
  const vvh = vv ? Math.round(vv.height) : window.innerHeight;
  document.documentElement.style.setProperty('--vvw', `${vvw}px`);
  document.documentElement.style.setProperty('--vvh', `${vvh}px`);
}

function lockLandscapePageScroll() {
  if (!mobileUIState.scrollLocked) {
    mobileUIState.savedScrollY = window.scrollY || window.pageYOffset || 0;
    mobileUIState.scrollLocked = true;
  }
  document.documentElement.classList.add('mobile-landscape-lock');
  document.body.classList.add('mobile-game-landscape');
  document.body.classList.remove('mobile-web-portrait');
}

function unlockPortraitPageScroll() {
  const wasLocked = mobileUIState.scrollLocked;
  const targetY = mobileUIState.savedScrollY || 0;
  document.documentElement.classList.remove('mobile-landscape-lock');
  document.body.classList.remove('mobile-game-landscape');
  document.body.classList.add('mobile-web-portrait');
  mobileUIState.scrollLocked = false;
  if (wasLocked) {
    window.scrollTo(0, targetY);
  }
}

// State Machine: WEB_PORTRAIT / GAME_LANDSCAPE / GAME_PAUSED
function syncMobileViewMode() {
  updateVisualViewportVars();
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 720;
  const isMobile = isMobileOrTabletViewport();
  const isPortrait = isMobile && (h > w);
  const rotatePrompt = typeof $ === 'function' ? $('portraitWarning') : document.getElementById('portraitWarning');

  document.body.classList.toggle('is-mobile-device', isMobile);

  if (!isMobile) {
    // PC Default layout
    if (rotatePrompt) rotatePrompt.hidden = true;
    document.documentElement.classList.remove('mobile-landscape-lock');
    document.body.classList.remove('mobile-game-landscape', 'mobile-web-portrait');
    mobileUIState.scrollLocked = false;
    mobileUIState.viewMode = (typeof state !== 'undefined' && state === 'paused') ? 'GAME_PAUSED' : 'PC_DEFAULT';
    mobileUIState.fullscreenMode = document.fullscreenElement ? 'native' : 'inline';
    return mobileUIState.viewMode;
  }

  if (isPortrait) {
    // Transition into WEB_PORTRAIT
    const prevMode = mobileUIState.viewMode;
    mobileUIState.viewMode = 'WEB_PORTRAIT';
    mobileUIState.fullscreenMode = 'inline';
    if (rotatePrompt) rotatePrompt.hidden = false;

    // Exit native fullscreen if somehow still active in portrait
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    // Unlock page scrolling & restore previous scrollY without jumping to top
    unlockPortraitPageScroll();

    // Pause gameplay idempotently & release all inputs
    if (prevMode !== 'WEB_PORTRAIT' || (typeof state !== 'undefined' && state === 'playing')) {
      ensurePaused('portrait');
    } else {
      releaseAllInputs('portrait');
    }
    return mobileUIState.viewMode;
  }

  // Mobile Landscape: GAME_LANDSCAPE (or GAME_PAUSED inside landscape container if paused)
  if (rotatePrompt) rotatePrompt.hidden = true;
  lockLandscapePageScroll();
  mobileUIState.fullscreenMode = (document.fullscreenElement || document.webkitFullscreenElement) ? 'native' : 'css_focus';

  // CRITICAL: Returning from WEB_PORTRAIT to Landscape NEVER auto-resumes gameplay!
  // The player must explicitly click '계속 플레이 →' / '계속 모험하기' to resume.
  if (typeof state !== 'undefined' && state === 'paused') {
    mobileUIState.viewMode = 'GAME_PAUSED';
  } else {
    mobileUIState.viewMode = 'GAME_LANDSCAPE';
  }
  return mobileUIState.viewMode;
}
window.syncMobileViewMode = syncMobileViewMode;

// Browser-Aware Fullscreen / Landscape Focus Mode Handler (User Gesture Only)
async function requestGameFullscreenOrFocus(triggerSource = 'button') {
  const gameEl = typeof $ === 'function' ? $('game') : document.getElementById('game');
  if (!gameEl) return { mode: 'inline', nativeSupported: false };

  // Toggle off if already in native fullscreen and user clicked the #full button
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl && (triggerSource === 'hud_btn' || triggerSource === 'opt_btn')) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (e) {}
    releaseAllInputs('fullscreen_exit');
    syncMobileViewMode();
    return { mode: mobileUIState.fullscreenMode, nativeSupported: true };
  }

  // Try Native Fullscreen API once inside user gesture (Android Chrome / Desktop)
  const reqFs = gameEl.requestFullscreen || gameEl.webkitRequestFullscreen;
  let nativeSuccess = false;
  if (reqFs) {
    try {
      await reqFs.call(gameEl);
      nativeSuccess = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    } catch (err) {
      nativeSuccess = false;
    }
  }

  // Optionally try orientation lock if supported (never fail if rejected)
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    try {
      await screen.orientation.lock('landscape');
    } catch (e) {
      // Orientation lock is optional and unsupported on iOS Safari / desktop
    }
  }

  // Whether native fullscreen succeeded (Android Chrome) or is unsupported/blocked (iPhone Safari),
  // ensure CSS landscape focus mode is active on mobile landscape without looping requests!
  updateVisualViewportVars();
  if (isMobileOrTabletViewport() && window.innerWidth >= window.innerHeight) {
    lockLandscapePageScroll();
  }
  mobileUIState.fullscreenMode = nativeSuccess ? 'native' : (isMobileOrTabletViewport() ? 'css_focus' : 'inline');
  syncMobileViewMode();
  return { mode: mobileUIState.fullscreenMode, nativeSupported: Boolean(reqFs), nativeSuccess };
}
window.requestGameFullscreenOrFocus = requestGameFullscreenOrFocus;

// 360° Virtual Joystick Direction Solver
function updateJoystickFromPoint(clientX, clientY) {
  const baseEl = typeof $ === 'function' ? $('vjoy-base') : document.getElementById('vjoy-base');
  const knobEl = typeof $ === 'function' ? $('vjoy-knob') : document.getElementById('vjoy-knob');
  if (!baseEl || !knobEl) return;

  const rect = baseEl.getBoundingClientRect();
  const radius = Math.max(32, rect.width * 0.5);
  const cx = rect.left + radius;
  const cy = rect.top + radius;

  const rawDx = clientX - cx;
  const rawDy = clientY - cy;
  const dist = Math.hypot(rawDx, rawDy);
  const maxKnobDist = radius * 0.62;
  const clampScale = dist > maxKnobDist ? (maxKnobDist / dist) : 1.0;
  const kx = rawDx * clampScale;
  const ky = rawDy * clampScale;

  knobEl.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0px)`;

  const nx = rawDx / radius;
  const ny = rawDy / radius;
  const normDist = dist / radius;
  const angleDeg = (Math.atan2(rawDy, rawDx) * 180 / Math.PI + 360) % 360;

  mobileUIState.joyVector = {
    dx: Number(rawDx.toFixed(1)),
    dy: Number(rawDy.toFixed(1)),
    nx: Number(nx.toFixed(3)),
    ny: Number(ny.toFixed(3)),
    angleDeg: Number(angleDeg.toFixed(1))
  };

  // Deadzone & Hysteresis Thresholds
  const deadZone = 0.18;
  const prev = mobileUIState.activeStickDirs;
  const hEnter = 0.20, hExit = 0.14;
  const dEnter = 0.34, dExit = 0.25;

  let wantLeft = false;
  let wantRight = false;
  let wantDown = false;

  if (normDist >= deadZone) {
    if (prev.left) {
      wantLeft = nx < -hExit;
    } else {
      wantLeft = nx < -hEnter;
    }
    if (prev.right) {
      wantRight = nx > hExit;
    } else {
      wantRight = nx > hEnter;
    }
    if ( wantLeft && wantRight ) {
      wantLeft = nx < 0;
      wantRight = nx > 0;
    }
    // Downward input (look-down / platform drop-through); upward movement NEVER activates ArrowDown or Space
    if (prev.down) {
      wantDown = ny > dExit;
    } else {
      wantDown = ny > dEnter;
    }
  }

  // Strictly release previous direction keys BEFORE pressing new direction keys!
  if (prev.left && !wantLeft) releaseInput('ArrowLeft', 'vjoy');
  if (prev.right && !wantRight) releaseInput('ArrowRight', 'vjoy');
  if (prev.down && !wantDown) releaseInput('ArrowDown', 'vjoy');

  if (!prev.left && wantLeft) pressInput('ArrowLeft', 'vjoy');
  if (!prev.right && wantRight) pressInput('ArrowRight', 'vjoy');
  if (!prev.down && wantDown) pressInput('ArrowDown', 'vjoy');

  mobileUIState.activeStickDirs = { left: wantLeft, right: wantRight, down: wantDown };
  baseEl.setAttribute('data-dir-left', String(wantLeft));
  baseEl.setAttribute('data-dir-right', String(wantRight));
  baseEl.setAttribute('data-dir-down', String(wantDown));
}
window.updateJoystickFromPoint = updateJoystickFromPoint;

function endJoystickTracking() {
  const prev = mobileUIState.activeStickDirs;
  if (prev.left) releaseInput('ArrowLeft', 'vjoy');
  if (prev.right) releaseInput('ArrowRight', 'vjoy');
  if (prev.down) releaseInput('ArrowDown', 'vjoy');
  resetJoystickVisualAndState();
}

function openMobileSettingsModal() {
  if (typeof state !== 'undefined' && state === 'playing') {
    ensurePaused('options');
  } else {
    releaseAllInputs('options');
  }
  applyMobilePrefsToDOM();
  const modalEl = document.getElementById('mobileSettingsModal');
  if (modalEl) modalEl.hidden = false;
}

function closeMobileSettingsModal() {
  const modalEl = document.getElementById('mobileSettingsModal');
  if (modalEl) modalEl.hidden = true;
}

window.openMobileSettingsModal = openMobileSettingsModal;
window.closeMobileSettingsModal = closeMobileSettingsModal;

let mobileControlsInitialized = false;

function setupMobileControls() {
  if (mobileControlsInitialized) return;
  mobileControlsInitialized = true;

  loadMobilePrefs();

  // 1. Setup 360° Virtual Joystick (#vjoy-base)
  const joyBase = document.getElementById('vjoy-base');
  if (joyBase) {
    joyBase.addEventListener('pointerdown', e => {
      if (mobileUIState.viewMode === 'WEB_PORTRAIT') return;
      e.preventDefault();
      e.stopPropagation();
      try { joyBase.setPointerCapture(e.pointerId); } catch (err) {}
      mobileUIState.joyActive = true;
      mobileUIState.joyPointerId = e.pointerId;
      joyBase.classList.add('active');
      updateJoystickFromPoint(e.clientX, e.clientY);
    });

    joyBase.addEventListener('pointermove', e => {
      if (!mobileUIState.joyActive || e.pointerId !== mobileUIState.joyPointerId) return;
      e.preventDefault();
      e.stopPropagation();
      updateJoystickFromPoint(e.clientX, e.clientY);
    });

    const onJoyEnd = e => {
      if (!mobileUIState.joyActive || (e.pointerId !== undefined && e.pointerId !== mobileUIState.joyPointerId)) return;
      e.preventDefault();
      endJoystickTracking();
    };

    joyBase.addEventListener('pointerup', onJoyEnd);
    joyBase.addEventListener('pointercancel', onJoyEnd);
    joyBase.addEventListener('lostpointercapture', onJoyEnd);
  }

  // 2. Setup Action Buttons (Jump, Dash) & Legacy fallback buttons
  const bindings = [
    { el: document.getElementById('vbtn-jump'), code: 'Space' },
    { el: document.getElementById('vbtn-dash'), code: 'ShiftLeft' },
    { el: document.getElementById('vbtn-left'), code: 'ArrowLeft' },
    { el: document.getElementById('vbtn-right'), code: 'ArrowRight' },
    { el: document.getElementById('vbtn-down'), code: 'ArrowDown' }
  ];

  bindings.forEach(({ el, code }) => {
    if (!el) return;
    const activePointers = new Set();

    el.addEventListener('pointerdown', e => {
      if (mobileUIState.viewMode === 'WEB_PORTRAIT') return;
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      activePointers.add(e.pointerId);
      el.classList.add('active');
      pressInput(code, `touch_${e.pointerId}`);
    });

    const onPointerEnd = e => {
      if (activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
        releaseInput(code, `touch_${e.pointerId}`);
      }
      if (activePointers.size === 0) {
        el.classList.remove('active');
      }
    };

    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('lostpointercapture', onPointerEnd);
  });

  // Prevent browser default touch gestures inside #game ONLY when in GAME_LANDSCAPE
  const gameEl = document.getElementById('game');
  if (gameEl) {
    gameEl.addEventListener('contextmenu', e => {
      if (isMobileOrTabletViewport()) e.preventDefault();
    });
  }

  // 3. Wire Mobile Controller Settings UI
  const optBtn = document.getElementById('mobileOptBtn');
  const modalOptBtn = document.getElementById('modalMobileOptBtn');
  const closeOptBtn = document.getElementById('closeMobileOptBtn');
  const confirmOptBtn = document.getElementById('confirmMobileOptBtn');
  const optFsBtn = document.getElementById('optToggleFullscreenBtn');
  const landscapeFocusBtn = document.getElementById('landscapeFocusBtn');

  if (optBtn) optBtn.addEventListener('click', e => { e.stopPropagation(); openMobileSettingsModal(); });
  if (modalOptBtn) modalOptBtn.addEventListener('click', e => { e.stopPropagation(); openMobileSettingsModal(); });
  if (closeOptBtn) closeOptBtn.addEventListener('click', e => { e.stopPropagation(); closeMobileSettingsModal(); });
  if (confirmOptBtn) confirmOptBtn.addEventListener('click', e => { e.stopPropagation(); closeMobileSettingsModal(); });
  if (optFsBtn) optFsBtn.addEventListener('click', e => { e.stopPropagation(); requestGameFullscreenOrFocus('opt_btn'); });
  if (landscapeFocusBtn) landscapeFocusBtn.addEventListener('click', e => { e.stopPropagation(); requestGameFullscreenOrFocus('modal_btn'); });

  document.querySelectorAll('[data-opt-stick-pos]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setMobilePref('stickPosition', btn.getAttribute('data-opt-stick-pos'));
    });
  });
  document.querySelectorAll('[data-opt-btn-swap]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setMobilePref('buttonSwap', btn.getAttribute('data-opt-btn-swap'));
    });
  });
  document.querySelectorAll('[data-opt-stick-size]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setMobilePref('stickSize', btn.getAttribute('data-opt-stick-size'));
    });
  });

  // 4. Touch on story cutscene to advance
  const storyEl = document.getElementById('story');
  if (storyEl) {
    storyEl.addEventListener('pointerdown', e => {
      if (typeof storyAdvance === 'function') storyAdvance();
    });
  }

  // 5. Orientation, Resize, Fullscreen & Visibility Listeners (Single Registered Instance)
  const onViewportChange = () => {
    syncMobileViewMode();
  };

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportChange);
  }
  document.addEventListener('fullscreenchange', () => {
    releaseAllInputs('fullscreenchange');
    syncMobileViewMode();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    releaseAllInputs('fullscreenchange');
    syncMobileViewMode();
  });

  syncMobileViewMode();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMobileControls);
} else {
  setupMobileControls();
}
