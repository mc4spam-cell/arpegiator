// Application Arpegiator : DOM, audio WebAudio, clavier à l'écran, export MIDI.
// Le moteur pur est dans engine.js. On reste sans dépendance ni étape de build.

(function () {
  const E = window.Engine;
  const T = (k, ...args) => (window.i18n ? window.i18n.t(k, ...args) : k);

  // État global.
  const state = {
    playing: false,
    bpm: 110,
    steps: 16,
    rate: "1/16",
    order: "up",
    octaves: 1,
    swing: 0,
    pattern: E.defaultPattern(16),
    chords: [           // liste d'accords de la grille ; chacun = { root (pc), quality, octave }.
      { root: 0, quality: "maj", octave: 4 },
    ],
    chordIdx: 0,        // accord en cours de lecture.
    meter: "4/4",
    lastFreq: null,     // dernière fréquence jouée, pour le glide.
  };

  // --- Audio ------------------------------------------------------------------

  let ac = null;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  // Petit synthé additif : sinus + triangle avec enveloppe AR.
  // Si `glide` est vrai et qu'une note précédente existe, la fréquence rampe depuis elle.
  function playNote(midi, when, dur, vel, glide) {
    const ctx = audio();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const doGlide = glide && state.lastFreq && Math.abs(state.lastFreq - f) > 0.01;
    const from = doGlide ? state.lastFreq : f;
    // Glide audible : jusqu'à 2/3 de la durée, plafonné à 250 ms.
    const glideTime = Math.min(dur * 0.66, 0.25);
    const osc1 = ctx.createOscillator(); osc1.type = "sine";
    const osc2 = ctx.createOscillator(); osc2.type = "triangle";
    osc1.frequency.setValueAtTime(from, when);
    osc2.frequency.setValueAtTime(from * 2, when);
    if (doGlide) {
      osc1.frequency.exponentialRampToValueAtTime(f, when + glideTime);
      osc2.frequency.exponentialRampToValueAtTime(f * 2, when + glideTime);
    }
    const g = ctx.createGain();
    const amp = Math.max(0.02, (vel / 127) * 0.35);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(amp, when + 0.005);
    g.gain.exponentialRampToValueAtTime(amp * 0.4, when + Math.max(0.05, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.02);
    osc1.connect(g); osc2.connect(g); g.connect(ctx.destination);
    osc1.start(when); osc2.start(when);
    osc1.stop(when + dur + 0.05); osc2.stop(when + dur + 0.05);
    state.lastFreq = f;
  }

  // --- Boucle de lecture ------------------------------------------------------

  // On programme en avance par petits paquets, type look-ahead classique.
  let nextStepAt = 0;   // en secondes dans l'horloge audio.
  let stepIdx = 0;
  let timer = null;

  function beatsPerStep() { return E.RATES[state.rate] ?? 0.25; }
  function secPerBeat()   { return 60 / state.bpm; }

  function scheduler() {
    const ctx = audio();
    const horizon = ctx.currentTime + 0.1;
    while (state.playing && nextStepAt < horizon) {
      scheduleOneStep(stepIdx, nextStepAt);
      const dt = beatsPerStep() * secPerBeat();
      const sw = (stepIdx % 2 === 0) ? state.swing * dt * 0.5 : -state.swing * dt * 0.5;
      nextStepAt += dt + sw;
      stepIdx = (stepIdx + 1) % state.steps;
      // Fin du cycle : accord suivant.
      if (stepIdx === 0 && state.chords.length > 1) {
        state.chordIdx = (state.chordIdx + 1) % state.chords.length;
        const delay = Math.max(0, (nextStepAt - ctx.currentTime) * 1000);
        setTimeout(() => { renderChordList(); renderChordNotes(); }, delay);
      }
    }
  }

  function currentChord() {
    const c = state.chords[state.chordIdx % state.chords.length];
    return c ? buildChord(c.root, c.quality, c.octave) : [];
  }

  function scheduleOneStep(i, when) {
    const notes = currentChord();
    state.playCounter = (state.playCounter || 0) + 1;
    const events = E.renderPattern(notes, [state.pattern[i % state.pattern.length]], {
      rate: state.rate, order: state.order, steps: 1,
      octaves: state.octaves,
      offset: i,
      // Graine qui varie à chaque pas joué pour que `rand` change réellement.
      seed: state.playCounter * 2654435761 >>> 0,
      swing: 0,
    });
    for (const ev of events) {
      const dur = ev.dur * secPerBeat();
      playNote(ev.pitch, when, dur, ev.vel, ev.glide);
    }
    // Indicateur visuel.
    const delay = Math.max(0, (when - audio().currentTime) * 1000);
    setTimeout(() => highlightStep(i), delay);
  }

  function start() {
    if (state.playing) return;
    state.playing = true;
    stepIdx = 0;
    state.chordIdx = 0;
    state.lastFreq = null;
    state.playCounter = 0;
    nextStepAt = audio().currentTime + 0.05;
    timer = setInterval(scheduler, 25);
    renderChordList();
  }
  function stop() {
    state.playing = false;
    clearInterval(timer); timer = null;
    highlightStep(-1);
    renderChordList();
  }

  // --- Export MIDI ------------------------------------------------------------

  function exportMidi() {
    const notes = currentChord();
    if (!notes.length) { alert(T("alert_no_notes")); return; }
    const events = E.renderPattern(notes, state.pattern, {
      rate: state.rate, order: state.order, steps: state.steps,
      octaves: state.octaves, seed: 1, swing: state.swing,
    });
    const bytes = E.toSMF(events, { bpm: state.bpm, ppq: 480 });
    const blob = new Blob([bytes], { type: "audio/midi" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "arpegiator.mid";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- UI : grille de pas -----------------------------------------------------

  const grid = document.getElementById("steps-grid");

  // Fabrique un slider vertical personnalisé.
  // Appelle onChange(valeur) à chaque déplacement ; double-clic → defaultVal.
  function makeVSlider({ min, max, value, defaultVal, center, format, onChange }) {
    const el = document.createElement("div");
    el.className = "vs" + (center ? " center" : "");
    el.innerHTML = `<div class="fill"></div>`;
    const fill = el.firstChild;
    const paint = (v) => {
      const span = max - min;
      if (center) {
        const zero = (0 - min) / span; // position du zéro (0..1)
        const p = (v - min) / span;
        const top = Math.min(zero, p), bot = Math.max(zero, p);
        fill.style.bottom = (top * 100) + "%";
        fill.style.height = ((bot - top) * 100) + "%";
      } else {
        fill.style.bottom = "0";
        fill.style.height = ((v - min) / span * 100) + "%";
      }
    };
    paint(value);
    el.dataset.val = value;
    const label = document.createElement("div");
    label.className = "val";
    label.textContent = format(value);
    const set = (v) => {
      v = Math.max(min, Math.min(max, v));
      el.dataset.val = v;
      paint(v);
      label.textContent = format(v);
      onChange(v);
    };
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, startVal: +el.dataset.val };
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      const span = max - min;
      // 100 px = toute la plage.
      set(drag.startVal + (dy / 100) * span);
    });
    el.addEventListener("pointerup", () => { drag = null; });
    el.addEventListener("dblclick", () => set(defaultVal));
    return { el, label, set };
  }

  // Formats et snap par paramètre.
  const PARAMS = {
    pitch: { min: -7, max: 7, def: 0, center: true, snap: 1,
             fmt: (v) => (v >= 0 ? "+" : "") + Math.round(v) },
    octave:{ min: -2, max: 2, def: 0, center: true, snap: 1,
             fmt: (v) => (v >= 0 ? "+" : "") + Math.round(v) },
    duration:{ min: 0.25, max: 4, def: 1, center: false, snap: 0.25,
             fmt: (v) => v.toFixed(2) },
  };
  const snap = (v, s) => Math.round(v / s) * s;

  function buildGrid() {
    grid.innerHTML = "";

    // Ligne d'en-tête : num + ON par pas.
    const head = document.createElement("div");
    head.className = "lane head";
    head.innerHTML = `<div class="lbl">${T("lane_steps")}</div><div class="cells"></div>`;
    const headCells = head.querySelector(".cells");

    // Lignes de paramètres.
    const lanes = {};
    const laneEls = {};
    const FIELD = { pitch: "degree", octave: "octave", duration: "len" };
    for (const name of ["pitch", "octave", "duration"]) {
      const lane = document.createElement("div");
      lane.className = "lane " + name;
      lane.innerHTML = `<div class="lbl">${T("lane_" + name)}<button class="dice" title="${T("dice_title")}">⚄ ${T("dice")}</button></div><div class="cells"></div>`;
      lanes[name] = lane.querySelector(".cells");
      laneEls[name] = lane;
      lane.querySelector(".dice").addEventListener("click", () => {
        const p = PARAMS[name];
        const field = FIELD[name];
        for (let k = 0; k < state.steps; k++) {
          const st = state.pattern[k]; if (!st) continue;
          const v = p.min + Math.random() * (p.max - p.min);
          st[field] = snap(v, p.snap);
        }
        buildGrid();
      });
    }

    // Ligne de toggles R/G/T.
    const tog = document.createElement("div");
    tog.className = "lane toggles";
    tog.innerHTML = `<div class="lbl">${T("lane_flags")}</div><div class="cells"></div>`;
    const togCells = tog.querySelector(".cells");

    // Montage dans l'ordre final.
    grid.appendChild(head);
    grid.appendChild(laneEls.pitch);
    grid.appendChild(laneEls.octave);
    grid.appendChild(laneEls.duration);
    grid.appendChild(tog);

    // Remplissage par pas.
    for (let i = 0; i < state.steps; i++) {
      const st = state.pattern[i] || (state.pattern[i] = {
        on: true, degree: 0, octave: 0, vel: 100, gate: 0.9, len: 1,
        tie: false, rand: false, glide: false,
      });
      if (st.len == null) st.len = 1;

      // Entête de colonne.
      const h = document.createElement("div");
      h.className = "cell";
      h.innerHTML = `<div class="num">${i + 1}</div>`;
      const onBtn = document.createElement("button");
      onBtn.className = "on" + (st.on ? " active" : "");
      onBtn.textContent = T("step_on");
      onBtn.addEventListener("click", () => {
        st.on = !st.on;
        onBtn.classList.toggle("active", st.on);
        syncOff();
      });
      h.appendChild(onBtn);
      headCells.appendChild(h);

      // Cellule pitch.
      const pCell = document.createElement("div"); pCell.className = "cell";
      const pit = makeVSlider({
        ...PARAMS.pitch, value: st.degree,
        defaultVal: PARAMS.pitch.def,
        format: PARAMS.pitch.fmt,
        onChange: (v) => { st.degree = snap(v, PARAMS.pitch.snap); },
      });
      pCell.appendChild(pit.el); pCell.appendChild(pit.label);
      lanes.pitch.appendChild(pCell);

      // Cellule octave.
      const oCell = document.createElement("div"); oCell.className = "cell";
      const oct = makeVSlider({
        ...PARAMS.octave, value: st.octave,
        defaultVal: PARAMS.octave.def,
        format: PARAMS.octave.fmt,
        onChange: (v) => { st.octave = snap(v, PARAMS.octave.snap); },
      });
      oCell.appendChild(oct.el); oCell.appendChild(oct.label);
      lanes.octave.appendChild(oCell);

      // Cellule duration (len en pas).
      const dCell = document.createElement("div"); dCell.className = "cell";
      const dur = makeVSlider({
        ...PARAMS.duration, value: st.len,
        defaultVal: PARAMS.duration.def,
        format: PARAMS.duration.fmt,
        onChange: (v) => { st.len = snap(v, PARAMS.duration.snap); },
      });
      dCell.appendChild(dur.el); dCell.appendChild(dur.label);
      lanes.duration.appendChild(dCell);

      // Toggles.
      const tCell = document.createElement("div"); tCell.className = "cell";
      const mkTog = (cls, key, title) => {
        const b = document.createElement("button");
        b.className = cls + (st[key] ? " active" : "");
        b.textContent = cls.toUpperCase();
        b.title = title;
        b.addEventListener("click", () => { st[key] = !st[key]; b.classList.toggle("active", st[key]); });
        return b;
      };
      tCell.appendChild(mkTog("tie", "tie", T("tie_title")));
      tCell.appendChild(mkTog("rnd", "rand", T("rand_title")));
      tCell.appendChild(mkTog("gld", "glide", T("glide_title")));
      togCells.appendChild(tCell);

      // Lien entre ON et apparence grisée des sliders.
      pCell._vs = pit.el; oCell._vs = oct.el; dCell._vs = dur.el;
    }

    syncOff();

    function syncOff() {
      const kids = (cells) => cells.querySelectorAll(".cell");
      for (let i = 0; i < state.steps; i++) {
        const off = !state.pattern[i].on;
        for (const name of ["pitch", "octave", "duration"]) {
          const cell = kids(lanes[name])[i];
          if (cell && cell._vs) cell._vs.classList.toggle("off", off);
        }
      }
    }
  }

  function highlightStep(i) {
    const marks = grid.querySelectorAll(".vs");
    marks.forEach((c) => c.classList.remove("playing"));
    // Marque les 3 sliders de la colonne i.
    const lanes = grid.querySelectorAll(".lane");
    // lanes : head, pitch, octave, duration, toggles.
    for (let k = 1; k <= 3; k++) {
      const cells = lanes[k]?.querySelectorAll(".cell");
      const cell = cells?.[i];
      const vs = cell?.querySelector(".vs");
      if (vs) vs.classList.add("playing");
    }
  }

  // --- UI : constructeur d'accord --------------------------------------------

  // Intervalles en demi-tons depuis la tonique.
  const CHORD_QUALITIES = {
    maj:  [0, 4, 7],
    min:  [0, 3, 7],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    dim:  [0, 3, 6],
    aug:  [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    add9: [0, 4, 7, 14],
    maj9: [0, 4, 7, 11, 14],
    min9: [0, 3, 7, 10, 14],
  };
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  function buildChord(rootPc, quality, octave) {
    const root = (octave + 1) * 12 + rootPc; // MIDI : C-1 = 0, donc C4 = 60.
    const ivs = CHORD_QUALITIES[quality] || CHORD_QUALITIES.maj;
    return ivs.map((iv) => root + iv);
  }

  function renderChordNotes() {
    const el = document.getElementById("chord-notes");
    el.innerHTML = "";
    currentChord().forEach((m, i) => {
      const n = document.createElement("span");
      n.className = "n" + (i === 0 ? " root" : "");
      n.textContent = NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
      el.appendChild(n);
    });
  }

  // Rend la grille d'accords (une ligne par accord, boutons ajout/suppression).
  function renderChordList() {
    const el = document.getElementById("chord-list");
    el.innerHTML = "";
    state.chords.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "chord-row" + (i === state.chordIdx && state.playing ? " current" : "");
      row.innerHTML = `
        <span class="idx">${i + 1}</span>
        <select class="root">
          ${NOTE_NAMES.map((n, k) => `<option value="${k}" ${k === c.root ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        <select class="quality">
          ${Object.keys(CHORD_QUALITIES).map(q => `<option value="${q}" ${q === c.quality ? "selected" : ""}>${q}</option>`).join("")}
        </select>
        <label class="hint" style="margin:0">${T("oct_label")}
          <input type="number" class="oct" min="1" max="6" step="1" value="${c.octave}" style="width:50px">
        </label>
        <span class="hint" style="margin:0; font-variant-numeric: tabular-nums">${buildChord(c.root, c.quality, c.octave).map(m => NOTE_NAMES[m % 12]).join(" ")}</span>
        <button class="rnd add" title="${T("add_chord")}" aria-label="${T("add_chord")}">+</button>
        ${i === 0 ? "" : `<button class="rnd del" title="${T("delete_title")}" aria-label="${T("delete_title")}">−</button>`}
      `;
      row.querySelector(".root").addEventListener("change", (e) => {
        c.root = +e.target.value; renderChordList(); renderChordNotes();
      });
      row.querySelector(".quality").addEventListener("change", (e) => {
        c.quality = e.target.value; renderChordList(); renderChordNotes();
      });
      row.querySelector(".oct").addEventListener("change", (e) => {
        c.octave = Math.max(1, Math.min(6, +e.target.value || 4)); renderChordList(); renderChordNotes();
      });
      row.querySelector(".add").addEventListener("click", () => {
        state.chords.splice(i + 1, 0, { root: 0, quality: "maj", octave: 4 });
        renderChordList(); renderChordNotes();
      });
      row.querySelector(".del")?.addEventListener("click", () => {
        if (state.chords.length <= 1) return;
        state.chords.splice(i, 1);
        if (state.chordIdx >= state.chords.length) state.chordIdx = 0;
        renderChordList(); renderChordNotes();
      });
      el.appendChild(row);
    });
  }

  // Nombre de pas par signature (1/16 par pas).
  const METER_STEPS = { "3/4": 12, "4/4": 16, "5/8": 10, "7/8": 14 };
  function applyMeter() {
    const m = document.getElementById("meter").value;
    state.meter = m;
    const n = METER_STEPS[m] || 16;
    state.steps = n;
    document.getElementById("steps").value = n;
    while (state.pattern.length < n) {
      state.pattern.push({ on: true, degree: 0, octave: 0, vel: 100, gate: 0.9, len: 1, tie: false, rand: false, glide: false });
    }
    state.pattern.length = n;
    buildGrid();
  }

  // --- Fils des contrôles -----------------------------------------------------

  function bindControls() {
    const playBtn = document.getElementById("playToggle");
    playBtn.addEventListener("click", () => {
      if (state.playing) { stop(); playBtn.textContent = T("play"); }
      else { audio(); start(); playBtn.textContent = T("stop"); }
    });
    document.getElementById("bpm").addEventListener("input", (e) => { state.bpm = +e.target.value || 110; });
    document.getElementById("rate").addEventListener("change", (e) => { state.rate = e.target.value; });
    document.getElementById("order").addEventListener("change", (e) => { state.order = e.target.value; });
    document.getElementById("octaves").addEventListener("input", (e) => { state.octaves = +e.target.value || 1; });
    document.getElementById("swing").addEventListener("input", (e) => { state.swing = +e.target.value || 0; });
    document.getElementById("steps").addEventListener("change", (e) => {
      const n = Math.max(1, Math.min(48, +e.target.value || 16));
      state.steps = n;
      while (state.pattern.length < n) state.pattern.push({ on: true, degree: 0, octave: 0, vel: 100, gate: 0.8, tie: false });
      state.pattern.length = n;
      buildGrid();
    });
    document.getElementById("exportMidi").addEventListener("click", exportMidi);
    document.getElementById("meter").addEventListener("change", applyMeter);
  }

  // Flèches ‹/› sur la grille quand elle dépasse horizontalement.
  function bindScrollArrows() {
    const wrap = grid.parentElement;
    const left = wrap.querySelector(".scroll-arrow.left");
    const right = wrap.querySelector(".scroll-arrow.right");
    const update = () => {
      const max = grid.scrollWidth - grid.clientWidth;
      wrap.classList.toggle("has-left", grid.scrollLeft > 1);
      wrap.classList.toggle("has-right", grid.scrollLeft < max - 1);
    };
    const step = () => Math.max(96, grid.clientWidth * 0.6);
    left.addEventListener("click", () => grid.scrollBy({ left: -step() }));
    right.addEventListener("click", () => grid.scrollBy({ left:  step() }));
    grid.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Observe les changements de contenu (rebuilds de la grille).
    new MutationObserver(update).observe(grid, { childList: true, subtree: true });
    update();
  }

  // Au changement de langue : reconstruire tout le dynamique.
  function bindLangChange() {
    window.addEventListener("langchange", () => {
      buildGrid();
      renderChordList();
      renderChordNotes();
      const playBtn = document.getElementById("playToggle");
      if (playBtn) playBtn.textContent = T(state.playing ? "stop" : "play");
    });
  }

  // --- Démarrage --------------------------------------------------------------

  buildGrid();
  bindControls();
  bindScrollArrows();
  bindLangChange();
  renderChordList();
  renderChordNotes();
})();
