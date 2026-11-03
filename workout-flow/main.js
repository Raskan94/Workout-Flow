'use strict';
const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild } = require('obsidian');

const DEFAULTS = { volume: 0.8, countdown: 3, vibrate: true, wave: 'square' };

/* ---------- Audio ---------- */

// Un beep con attacco rapido, tenuta piena e rilascio breve: più udibile di un'onda sinusoidale.
function playBeep(ac, settings, freq, dur, delay) {
  if (!ac) return;
  try {
    const vol = settings.volume;
    if (!(vol > 0)) return;
    const wave = settings.wave || 'square';
    const scale = wave === 'square' ? 0.6 : wave === 'sawtooth' ? 0.5 : 1;
    const peak = Math.max(vol * scale, 0.0002);
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = wave;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.setValueAtTime(peak, t + Math.max(0.02, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}

/* ---------- Parsing ---------- */

function parseDuration(str) {
  const m = /^\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?\s*$/i.exec(str);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10);
}

const KEYS = {
  titolo: 'title', title: 'title',
  giri: 'rounds', round: 'rounds', rounds: 'rounds',
  rest: 'rest', riposo: 'rest',
  roundrest: 'roundRest', 'riposo giri': 'roundRest', 'pausa giri': 'roundRest',
  prep: 'prep', preparazione: 'prep',
  avviso: 'note', avvisi: 'note', nota: 'note', note: 'note',
  'titolo avvisi': 'notesTitle', 'titolo avviso': 'notesTitle',
};

function parseWorkout(source) {
  const cfg = { title: '', rounds: 1, rest: 15, roundRest: 30, prep: 5, notes: [], notesTitle: '', steps: [], errors: [] };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const kv = /^([A-Za-zÀ-ÿ ]+?)\s*:\s*(.*)$/.exec(line);
    const key = kv ? KEYS[kv[1].toLowerCase()] : null;
    if (key) {
      const val = kv[2].trim();
      if (key === 'title') cfg.title = val;
      else if (key === 'notesTitle') cfg.notesTitle = val;
      else if (key === 'note') val.split(';').map((t) => t.trim()).filter(Boolean).forEach((t) => cfg.notes.push(t));
      else if (key === 'rounds') {
        const n = parseInt(val, 10);
        if (n >= 1) cfg.rounds = n; else cfg.errors.push(`Numero di giri non valido: "${val}"`);
      } else {
        const d = parseDuration(val);
        if (d === null) cfg.errors.push(`Durata non valida in "${line}" (usa es. 30s, 1m, 1m30s)`);
        else cfg[key] = d;
      }
      continue;
    }

    // Esercizio
    const text = line.replace(/^[-*+]\s*(\[.\]\s*)?/, '');
    const ci = text.indexOf(':');
    const namePart = ci >= 0 ? text.slice(0, ci) : text;
    const paramPart = ci >= 0 ? text.slice(ci + 1) : '';
    let name = namePart.trim();
    let target = null;
    const lm = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(namePart);
    if (lm) { target = lm[1].trim(); name = (lm[2] || lm[1]).trim(); }

    const step = { name, target, kind: null, secs: 0, reps: 0, rest: null, perSide: false, notes: [] };
    // Avvisi tra virgolette (possono contenere virgole): avviso "Glutei contratti"
    const stripped = paramPart.replace(/(?:avviso|nota)\s*[:=]?\s*["“]([^"”]+)["”]/gi, (_, t) => { step.notes.push(t.trim()); return ''; });
    for (let p of stripped.split(/[,|;]/)) {
      p = p.trim();
      if (!p) continue;
      // Avviso senza virgolette: avviso Glutei contratti
      const nm = /^(?:avviso|nota)\s*[:=]?\s*(.+)$/i.exec(p);
      if (nm) { step.notes.push(nm[1].trim()); continue; }
      // "per lato" (anche "per gamba" / "per braccio"): l'esercizio viene fatto due volte, sinistra e destra
      if (/^(?:per|a)\s+(?:lato|gamba|braccio)$/i.test(p)) { step.perSide = true; continue; }
      const ps = /^(.+?)\s+(?:per|a)\s+(?:lato|gamba|braccio)$/i.exec(p);
      if (ps) { step.perSide = true; p = ps[1].trim(); }
      let m = /^(?:rest|riposo)\s+(.+)$/i.exec(p);
      if (m) {
        const d = parseDuration(m[1]);
        if (d === null) cfg.errors.push(`Riposo non valido in "${line}"`); else step.rest = d;
        continue;
      }
      const d = parseDuration(p);
      if (d !== null) { step.kind = 'timed'; step.secs = d; continue; }
      m = /^(\d+)\s*(?:x|rip|reps?|ripetizioni)?\.?$/i.exec(p);
      if (m) { step.kind = 'reps'; step.reps = parseInt(m[1], 10); continue; }
      cfg.errors.push(`Non capisco "${p}" in "${line}"`);
    }
    if (!step.kind) { cfg.errors.push(`Manca durata o ripetizioni in "${line}" (es. "30s" oppure "12 rip")`); continue; }
    if (step.perSide) {
      // Due passaggi di fila: nessun riposo tra i lati; il riposo (se indicato) vale dopo il lato destro.
      cfg.steps.push(Object.assign({}, step, { name: `${step.name} (sinistra)`, rest: 0 }));
      cfg.steps.push(Object.assign({}, step, { name: `${step.name} (destra)` }));
    } else {
      cfg.steps.push(step);
    }
  }
  if (!cfg.steps.length) cfg.errors.push('Nessun esercizio trovato.');
  return cfg;
}

function buildItems(cfg) {
  const items = [];
  const n = cfg.steps.length;
  if (cfg.prep > 0) items.push({ kind: 'prep', secs: cfg.prep });
  for (let r = 1; r <= cfg.rounds; r++) {
    for (let i = 0; i < n; i++) {
      const s = cfg.steps[i];
      items.push(s.kind === 'timed'
        ? { kind: 'timed', secs: s.secs, step: s, round: r, index: i }
        : { kind: 'reps', reps: s.reps, step: s, round: r, index: i });
      const last = r === cfg.rounds && i === n - 1;
      if (!last) {
        const fallback = i === n - 1 ? cfg.roundRest : cfg.rest;
        const rs = s.rest !== null ? s.rest : fallback;
        if (rs > 0) items.push({ kind: 'rest', secs: rs, step: s, round: r, index: i });
      }
    }
  }
  return items;
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
}
function fmtLabel(sec) {
  return sec < 60 ? `${sec}s` : fmt(sec);
}

/* ---------- Runner ---------- */

const PHASE_LABEL = { idle: 'Pronto', prep: 'Preparati', timed: 'Lavoro', rest: 'Riposo', reps: 'Ripetizioni', done: 'Finito' };

class Runner {
  constructor(plugin, el, cfg, sourcePath) {
    this.plugin = plugin;
    this.cfg = cfg;
    this.sourcePath = sourcePath;
    this.items = buildItems(cfg);
    this.state = 'idle'; // idle | running | paused | waiting | done
    this.idx = -1;
    this.cur = null;
    this.endAt = 0;
    this.remainingMs = 0;
    this.lastBeepSec = null;
    this.shownSec = null;
    this.scrolledIdx = null;
    this.rows = [];
    this.ac = null;
    this.wake = null;
    this.build(el);
    this.timerId = window.setInterval(() => this.tick(), 200);
    this.update();
  }

  build(el) {
    this.root = el.createDiv({ cls: 'wk-timer' });
    if (this.cfg.title) this.root.createDiv({ cls: 'wk-meta', text: this.cfg.title });
    this.badge = this.root.createDiv({ cls: 'wk-badge' });
    this.nameEl = this.root.createDiv({ cls: 'wk-name' });
    this.bigEl = this.root.createDiv({ cls: 'wk-big' });
    this.metaEl = this.root.createDiv({ cls: 'wk-meta' });
    this.nextEl = this.root.createDiv({ cls: 'wk-next' });
    this.notesEl = this.root.createDiv({ cls: 'wk-notes' });
    const row = this.root.createDiv({ cls: 'wk-buttons' });
    this.mainBtn = row.createEl('button', { cls: 'mod-cta' });
    this.doneBtn = row.createEl('button', { cls: 'wk-done', text: 'Fatto' });
    this.skipBtn = row.createEl('button', { text: 'Salta' });
    this.resetBtn = row.createEl('button', { text: 'Reset' });
    this.mainBtn.addEventListener('click', () => this.onMain());
    this.doneBtn.addEventListener('click', () => this.onDone());
    this.skipBtn.addEventListener('click', () => this.skip());
    this.resetBtn.addEventListener('click', () => this.reset());
    this.buildList();
  }

  // Elenco di tutti i passaggi in sequenza, ognuno con il proprio tempo.
  buildList() {
    this.listEl = this.root.createDiv({ cls: 'wk-list' });
    let lastRound = 0;
    this.items.forEach((it) => {
      if (it.round && it.round !== lastRound && this.cfg.rounds > 1) {
        lastRound = it.round;
        this.listEl.createDiv({ cls: 'wk-round', text: `Giro ${it.round}/${this.cfg.rounds}` });
      }
      const row = this.listEl.createDiv({ cls: `wk-row wk-row-${it.kind}` });
      const mark = row.createSpan({ cls: 'wk-mark' });
      const label = row.createSpan({ cls: 'wk-label' });
      const val = row.createSpan({ cls: 'wk-val' });
      label.setText(it.kind === 'prep' ? 'Preparazione' : it.kind === 'rest' ? 'Riposo' : it.step.name);
      this.rows.push({ row, mark, val });
    });
  }

  rowValue(it, active) {
    if (it.kind === 'reps') return `${it.reps} rip`;
    if (active && (this.state === 'running' || this.state === 'paused')) {
      return fmtLabel(Math.ceil(this.remainingMs / 1000));
    }
    return fmtLabel(it.secs);
  }

  updateList() {
    const st = this.state;
    const live = st === 'running' || st === 'paused' || st === 'waiting';
    this.rows.forEach((r, i) => {
      const it = this.items[i];
      const active = live && i === this.idx;
      const done = st === 'done' || (st !== 'idle' && i < this.idx);
      r.row.toggleClass('wk-active', active);
      r.row.toggleClass('wk-past', done);
      r.mark.setText(done ? '✓' : active ? '▶' : '·');
      r.val.setText(this.rowValue(it, active));
    });
    if (st === 'idle') {
      this.scrolledIdx = null;
      this.listEl.scrollTop = 0;
    } else if (live && this.scrolledIdx !== this.idx && this.rows[this.idx]) {
      this.scrolledIdx = this.idx;
      const el = this.rows[this.idx].row;
      this.listEl.scrollTop = Math.max(0, el.offsetTop - this.listEl.clientHeight / 2);
    }
  }

  /* --- audio --- */
  ensureAudio() {
    try {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ac = new AC();
      }
      if (this.ac && this.ac.resume) this.ac.resume();
    } catch (e) { /* ignore */ }
  }
  beep(freq, dur = 0.25, delay = 0) {
    playBeep(this.ac, this.plugin.settings, freq, dur, delay);
  }
  buzz(pattern) {
    try {
      if (this.plugin.settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* ignore */ }
  }
  cue(kind) {
    if (kind === 'timed') { this.beep(1200, 0.25); this.beep(1200, 0.25, 0.32); this.buzz([150, 80, 150]); }
    else if (kind === 'reps') { this.beep(880, 0.25); this.beep(1175, 0.35, 0.3); this.buzz([250]); }
    else if (kind === 'rest') { this.beep(523, 0.7); this.buzz([350]); }
    else if (kind === 'prep') { this.beep(660, 0.2); }
    else if (kind === 'done') { this.beep(660, 0.25); this.beep(880, 0.25, 0.3); this.beep(1175, 0.6, 0.6); this.buzz([200, 100, 200, 100, 500]); }
  }

  async lock() {
    try {
      if (navigator.wakeLock && !this.wake) this.wake = await navigator.wakeLock.request('screen');
    } catch (e) { /* ignore */ }
  }
  unlock() {
    try { if (this.wake) this.wake.release(); } catch (e) { /* ignore */ }
    this.wake = null;
  }

  /* --- state machine --- */
  onMain() {
    if (this.state === 'idle') this.start();
    else if (this.state === 'done') { this.reset(); this.start(); }
    else if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  start() {
    this.ensureAudio();
    this.lock();
    this.enter(0);
  }
  pause() {
    if (this.state !== 'running') return;
    this.remainingMs = Math.max(0, this.endAt - Date.now());
    this.state = 'paused';
    this.update();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ensureAudio();
    this.endAt = Date.now() + this.remainingMs;
    this.state = 'running';
    this.update();
  }
  onDone() {
    if (this.state !== 'waiting') return;
    this.enter(this.idx + 1);
  }
  skip() {
    if (this.state === 'idle' || this.state === 'done') return;
    this.enter(this.idx + 1);
  }
  reset() {
    this.state = 'idle';
    this.idx = -1;
    this.cur = null;
    this.unlock();
    this.update();
  }
  enter(i) {
    this.idx = i;
    this.lastBeepSec = null;
    this.shownSec = null;
    if (i >= this.items.length) { this.finish(); return; }
    const it = this.items[i];
    this.cur = it;
    if (it.kind === 'reps') {
      this.state = 'waiting'; // il timer resta fermo finché non premi Fatto
      this.cue('reps');
    } else {
      this.state = 'running';
      this.remainingMs = it.secs * 1000;
      this.endAt = Date.now() + this.remainingMs;
      this.cue(it.kind);
    }
    this.update();
  }
  finish() {
    this.state = 'done';
    this.cur = null;
    this.cue('done');
    this.unlock();
    this.update();
  }
  tick() {
    if (this.state !== 'running') return;
    const ms = this.endAt - Date.now();
    if (ms <= 0) { this.enter(this.idx + 1); return; }
    this.remainingMs = ms;
    const sec = Math.ceil(ms / 1000);
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.bigEl.setText(fmt(sec));
      const r = this.rows[this.idx];
      if (r) r.val.setText(this.rowValue(this.items[this.idx], true));
      if (sec >= 1 && sec <= this.plugin.settings.countdown && sec !== this.lastBeepSec) {
        this.lastBeepSec = sec;
        this.beep(880, 0.18);
      }
    }
  }

  // Avvisi generali del blocco + quelli specifici dell'esercizio corrente
  // (durante preparazione e riposo, quelli del prossimo esercizio, così li leggi prima di partire).
  renderNotes() {
    this.notesEl.empty();
    if (this.state === 'done') return;
    const it = this.cur;
    let step = null;
    if (it) {
      if (it.kind === 'timed' || it.kind === 'reps') step = it.step;
      else { const nx = this.nextWork(this.idx); step = nx ? nx.step : null; }
    }
    const extra = step ? step.notes : [];
    if (this.cfg.notesTitle && (this.cfg.notes.length || extra.length)) {
      this.notesEl.createDiv({ cls: 'wk-notes-title', text: this.cfg.notesTitle });
    }
    this.cfg.notes.forEach((t) => this.notesEl.createDiv({ cls: 'wk-note', text: t }));
    extra.forEach((t) => this.notesEl.createDiv({ cls: 'wk-note wk-note-extra', text: t }));
  }

  nextWork(fromIdx) {
    for (let j = fromIdx + 1; j < this.items.length; j++) {
      const it = this.items[j];
      if (it.kind === 'timed' || it.kind === 'reps') return it;
    }
    return null;
  }
  describe(it) {
    return it.kind === 'reps' ? `${it.reps} rip` : fmtLabel(it.secs);
  }
  setName(step, prefix) {
    this.nameEl.empty();
    if (!step) return;
    if (prefix) this.nameEl.createSpan({ text: prefix });
    if (step.target) {
      const a = this.nameEl.createEl('a', { cls: 'internal-link', text: step.name, href: step.target });
      a.setAttr('data-href', step.target);
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.plugin.app.workspace.openLinkText(step.target, this.sourcePath, true);
      });
    } else {
      this.nameEl.createSpan({ text: step.name });
    }
  }

  update() {
    const st = this.state;
    const it = this.cur;
    const phase = st === 'idle' ? 'idle' : st === 'done' ? 'done' : it.kind;
    this.root.dataset.phase = phase;
    this.badge.setText(PHASE_LABEL[phase]);
    this.nextEl.setText('');
    this.metaEl.setText('');

    if (st === 'idle') {
      this.setName(null);
      this.bigEl.setText('--');
      this.metaEl.setText(`${this.cfg.steps.length} esercizi × ${this.cfg.rounds} giri`);
    } else if (st === 'done') {
      this.setName(null);
      this.bigEl.setText('Completato');
    } else {
      const n = this.cfg.steps.length;
      if (it.kind === 'prep') {
        this.setName(null);
        this.bigEl.setText(fmt(Math.ceil(this.remainingMs / 1000)));
        const nx = this.nextWork(this.idx);
        if (nx) this.setName(nx.step, 'Si parte con: ');
      } else if (it.kind === 'rest') {
        const nx = this.nextWork(this.idx);
        this.setName(nx ? nx.step : null, 'Prossimo: ');
        this.bigEl.setText(fmt(Math.ceil(this.remainingMs / 1000)));
        this.metaEl.setText(`Giro ${it.round}/${this.cfg.rounds}`);
      } else {
        this.setName(it.step);
        this.bigEl.setText(it.kind === 'reps' ? `${it.reps} rip` : fmt(Math.ceil(this.remainingMs / 1000)));
        this.metaEl.setText(`Giro ${it.round}/${this.cfg.rounds} · Esercizio ${it.index + 1}/${n}`);
        const nx = this.nextWork(this.idx);
        if (nx) this.nextEl.setText(`Dopo: ${nx.step.name} (${this.describe(nx)})`);
      }
    }

    const active = st === 'running' || st === 'paused' || st === 'waiting';
    this.mainBtn.setText(st === 'idle' ? 'Inizia' : st === 'done' ? 'Ricomincia' : st === 'paused' ? 'Riprendi' : 'Pausa');
    this.mainBtn.toggleClass('wk-hidden', st === 'waiting');
    this.doneBtn.toggleClass('wk-hidden', st !== 'waiting');
    this.skipBtn.disabled = !active;
    this.resetBtn.disabled = st === 'idle';
    this.renderNotes();
    this.updateList();
  }

  destroy() {
    window.clearInterval(this.timerId);
    this.unlock();
    try { if (this.ac && this.ac.close) this.ac.close(); } catch (e) { /* ignore */ }
  }
}

/* ---------- Plugin ---------- */

class WorkoutFlowPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.registerMarkdownCodeBlockProcessor('workout-flow', (source, el, ctx) => {
      const cfg = parseWorkout(source);
      if (cfg.errors.length) {
        const box = el.createDiv({ cls: 'wk-error' });
        cfg.errors.forEach((e) => box.createDiv({ text: e }));
      }
      if (!cfg.steps.length) return;
      const child = new MarkdownRenderChild(el);
      const runner = new Runner(this, el, cfg, ctx.sourcePath);
      child.onunload = () => runner.destroy();
      ctx.addChild(child);
    });
    this.addSettingTab(new WorkoutFlowSettings(this.app, this));
  }
}

class WorkoutFlowSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveData(s);
    containerEl.empty();
    new Setting(containerEl).setName('Volume dei beep')
      .addSlider((sl) => sl.setLimits(0, 1, 0.05).setValue(s.volume).setDynamicTooltip()
        .onChange(async (v) => { s.volume = v; await save(); }));
    new Setting(containerEl).setName('Tipo di suono')
      .setDesc('Squillante è il più udibile; morbido e dolce sono più discreti.')
      .addDropdown((d) => d
        .addOptions({ square: 'Squillante', triangle: 'Morbido', sine: 'Dolce' })
        .setValue(s.wave)
        .onChange(async (v) => { s.wave = v; await save(); }));
    new Setting(containerEl).setName('Prova il suono')
      .addButton((b) => b.setButtonText('Riproduci').onClick(() => {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          const ac = new AC();
          if (ac.resume) ac.resume();
          playBeep(ac, s, 1200, 0.25, 0);
          playBeep(ac, s, 1200, 0.25, 0.32);
          window.setTimeout(() => { try { ac.close(); } catch (e) { /* ignore */ } }, 1500);
        } catch (e) { /* ignore */ }
      }));
    new Setting(containerEl).setName('Conto alla rovescia (secondi)')
      .setDesc('Beep negli ultimi N secondi di ogni fase a tempo.')
      .addSlider((sl) => sl.setLimits(0, 10, 1).setValue(s.countdown).setDynamicTooltip()
        .onChange(async (v) => { s.countdown = v; await save(); }));
    new Setting(containerEl).setName('Vibrazione (se supportata)')
      .addToggle((t) => t.setValue(s.vibrate)
        .onChange(async (v) => { s.vibrate = v; await save(); }));
  }
}

module.exports = WorkoutFlowPlugin;
module.exports.parseWorkout = parseWorkout;
module.exports.buildItems = buildItems;
module.exports.Runner = Runner;
module.exports.playBeep = playBeep;
