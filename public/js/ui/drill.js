// Recognition Drill: rapid flash-ID of drone types from a zoomed EO/IR image, an
// acoustic signature and RF cues, with adaptive sampling of weak types. Each answer
// updates the trainee's recognition mastery.

import { h, mount, toast, isTyping } from '../core/dom.js';
import { TYPES, TYPE_KEYS } from '../sim/catalog.js';
import { Rng, randomSeed } from '../core/rng.js';
import { normaliseProfile, applyObservations } from '../ai/mastery.js';
import { gradeFor } from '../ai/scoring.js';
import { Turntable } from '../render/turntable.js';
import { playSignature } from '../render/audio.js';

const LEVELS = {
  easy: { name: 'Basic', time: 9, px: [110, 200], conditions: ['day', 'day', 'dusk'], fog: 0 },
  standard: { name: 'Standard', time: 6, px: [45, 120], conditions: ['day', 'dusk', 'night'], fog: 0.3 },
  hard: { name: 'Hard', time: 4, px: [18, 60], conditions: ['day', 'dusk', 'night', 'night'], fog: 0.6 },
};

const RF_CUE = {
  hop: 'Frequency-hopping bursts in 2.4 and 5.8 GHz',
  narrowhop: 'Narrow hops near 900 MHz, plus 2.4 GHz',
  analog: 'Wide continuous carrier at 5.8 GHz, plus 900 MHz control',
  datalink: 'Steady datalink in 0.9 and 2.4 GHz',
  mil: 'Wide steady military datalink at 1.3 GHz',
  none: 'No RF emission detected',
};

export async function render(main, app) {
  let tt = null;
  let timer = null;
  let keyHandler = null;
  const cleanup = () => {
    tt?.dispose();
    tt = null;
    clearInterval(timer);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
  };

  const setup = () => {
    cleanup();
    const count = h('select', {}, [10, 15, 20].map((n) => h('option', { value: n }, `${n} contacts`)));
    const level = h('select', {}, Object.entries(LEVELS).map(([k, v]) => h('option', { value: k, selected: k === 'standard' ? true : null }, v.name)));
    const mode = h('select', {},
      h('option', { value: 'visual' }, 'Visual (EO/IR) only'),
      h('option', { value: 'multi' }, 'Visual + acoustic + RF cues'),
      h('option', { value: 'blind' }, 'No image: acoustic + RF + kinematics only'));
    const adaptive = h('input', { type: 'checkbox', checked: true });
    mount(main, h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Recognition drill'), h('p', {}, 'Flash-identify drones from a zoomed EO/IR image at random aspect, range and light, with optional acoustic and RF cues. A 20-contact drill takes under 3 minutes, so trainees get far more repetitions than live drills allow.'))),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' },
          h('div', { class: 'grid g2' },
            h('label', { class: 'field' }, 'Length', count),
            h('label', { class: 'field' }, 'Difficulty', level),
            h('label', { class: 'field', style: { gridColumn: 'span 2' } }, 'Cue mode', mode)),
          h('label', { class: 'row secondary', style: { marginTop: '12px' } }, adaptive, 'Adaptive sampling: show more of the types I confuse'),
          h('div', { class: 'row', style: { marginTop: '14px' } },
            h('button', { class: 'btn primary', type: 'button', onclick: async () => {
              const tr = await app.requireTrainee();
              if (!tr) return;
              run({ n: Number(count.value), level: level.value, mode: mode.value, adaptive: adaptive.checked });
            } }, 'Start drill'))),
        h('div', { class: 'card' }, h('h3', {}, 'How it works'),
          h('ul', { class: 'coach-list secondary' },
            h('li', {}, 'Answer with the buttons or keys 1–9 before the timer runs out.'),
            h('li', {}, 'Thermal (IR) images appear at night. Hot motors, engines and batteries show white.'),
            h('li', {}, 'Each wrong answer shows the recognition cues for the correct type.'),
            h('li', {}, 'Results update your recognition mastery and feed the AI Director.'))))));
  };

  const run = ({ n, level, mode, adaptive }) => {
    cleanup();
    const L = LEVELS[level];
    const rng = new Rng(randomSeed());
    const prof = normaliseProfile(app.trainee.profile);
    const weights = Object.fromEntries(TYPE_KEYS.map((k) => [k, adaptive ? 0.5 + 2 * (1 - prof.skills[`cls.${k}`].p) : 1]));
    const qs = [];
    for (let i = 0; i < n; i++) {
      let type = rng.weighted(weights);
      if (qs.length && qs[qs.length - 1].type === type) type = rng.weighted(weights);
      const time = rng.pick(L.conditions);
      qs.push({
        type, time, thermal: time === 'night' || (time === 'dusk' && rng.chance(0.3)),
        px: rng.range(L.px[0], L.px[1]), yaw: rng.range(0, Math.PI * 2), pitch: rng.range(-0.25, 0.45), fog: rng.chance(0.3) ? L.fog : 0,
        speed: Math.round(rng.range(TYPES[type].speed[0], TYPES[type].speed[1])), alt: Math.round(rng.range(TYPES[type].alt[0], TYPES[type].alt[1])),
      });
    }
    const results = [];
    let qi = -1;
    let started = 0;
    let answered = false;
    const stage = h('div', { class: 'drill-stage' });
    const overlay = h('div', { class: 'overlay' });
    const bar = h('i', { style: { width: '100%' } });
    const cues = h('div', { class: 'evidence', style: { marginTop: '8px', minHeight: '40px' } });
    const feedback = h('div', { style: { minHeight: '48px', marginTop: '8px' } });
    const progress = h('span', { class: 'muted' });
    const buttons = TYPE_KEYS.map((k, i) => h('button', { class: 'btn', type: 'button', onclick: () => answer(k) }, h('kbd', {}, String(i + 1)), TYPES[k].name));
    mount(main, h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Recognition drill'), h('p', {}, `${L.name} · ${mode === 'visual' ? 'visual only' : mode === 'multi' ? 'multi-cue' : 'no image'}`)), progress),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' } },
        h('div', {}, stage, h('div', { class: 'drill-timer' }, bar), cues),
        h('div', {}, h('div', { class: 'answer-grid', style: { gridTemplateColumns: '1fr', marginTop: 0 } }, buttons), feedback))));
    stage.append(overlay);
    if (mode !== 'blind') tt = new Turntable(stage, { spin: false });
    else stage.append(h('div', { class: 'empty', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7d8a85' } }, 'No image: listen and read the RF and kinematic cues'));

    keyHandler = (e) => {
      if (isTyping(e)) return;
      if (/^[1-9]$/.test(e.key)) answer(TYPE_KEYS[Number(e.key) - 1]);
      if (e.key === 'Enter' && answered) next();
    };
    document.addEventListener('keydown', keyHandler);

    const next = () => {
      qi += 1;
      if (qi >= qs.length) return finish();
      answered = false;
      const q = qs[qi];
      buttons.forEach((b) => { b.classList.remove('correct', 'wrong'); b.disabled = false; });
      mount(feedback);
      progress.textContent = `Contact ${qi + 1} of ${qs.length}`;
      if (tt) tt.show(q.type, { time: q.time, thermal: q.thermal, fog: q.fog, apparentPx: q.px, yaw: q.yaw, pitch: q.pitch });
      overlay.textContent = `${q.thermal ? 'IR-WHT' : 'EO-TV'} · ${q.time.toUpperCase()}${q.fog ? ' · HAZE' : ''}`;
      const def = TYPES[q.type];
      const cueEls = [];
      if (mode !== 'visual') {
        cueEls.push(h('div', {}, 'RF: ', h('b', {}, RF_CUE[def.rf.pattern])));
        cueEls.push(h('div', {}, 'Kinematics: ', h('b', {}, `${q.speed} m/s at ${q.alt} m`)));
        if (def.acoustic) {
          cueEls.push(h('button', { class: 'btn sm', type: 'button', onclick: () => playSignature(q.type, { level: 0.8 }) }, '▶ Play acoustic signature'));
          playSignature(q.type, { level: 0.8, duration: 2 });
        } else cueEls.push(h('div', {}, 'Acoustic: ', h('b', {}, 'no motor or engine noise')));
      }
      mount(cues, cueEls);
      started = performance.now();
      clearInterval(timer);
      timer = setInterval(() => {
        const left = 1 - (performance.now() - started) / (L.time * 1000);
        bar.style.width = `${Math.max(0, left) * 100}%`;
        if (left <= 0 && !answered) answer(null);
      }, 50);
    };

    const answer = (k) => {
      if (answered) return;
      answered = true;
      clearInterval(timer);
      const q = qs[qi];
      const rt = (performance.now() - started) / 1000;
      const ok = k === q.type;
      results.push({ type: q.type, answer: k, ok, rt, conditions: q.time });
      buttons.forEach((b, i) => {
        b.disabled = true;
        if (TYPE_KEYS[i] === q.type) b.classList.add('correct');
        else if (TYPE_KEYS[i] === k) b.classList.add('wrong');
      });
      const def = TYPES[q.type];
      mount(feedback,
        h('p', {}, ok ? h('b', { style: { color: '#8be29a' } }, `✓ Correct · ${rt.toFixed(1)} s`) : h('b', { style: { color: '#ffb0a6' } }, k ? `✗ That was a ${def.name}` : `⏱ Time up. It was a ${def.name}`)),
        ok ? null : h('ul', { class: 'coach-list secondary', style: { fontSize: '13px' } }, def.cues.map((c) => h('li', {}, c))),
        h('button', { class: 'btn primary', type: 'button', onclick: next }, qi + 1 < qs.length ? 'Next (Enter)' : 'Finish'));
      if (ok) setTimeout(() => { if (answered && results.length === qi + 1) next(); }, 900);
    };

    const finish = async () => {
      cleanup();
      const correct = results.filter((r) => r.ok).length;
      const acc = Math.round((correct / results.length) * 100);
      const rts = results.filter((r) => r.ok).map((r) => r.rt);
      const confusion = {};
      for (const r of results) {
        const row = (confusion[r.type] ||= {});
        const c = r.answer || 'NONE';
        row[c] = (row[c] || 0) + 1;
      }
      const obs = results.map((r) => ({ skill: `cls.${r.type}`, correct: r.ok }));
      const { profile, deltas } = applyObservations(app.trainee.profile, obs, 'drill');
      const session = {
        traineeId: app.trainee.id, unitId: app.trainee.unitId, mode: 'drill', scenarioId: `drill-${level}-${mode}`,
        scenarioName: `Recognition drill (${L.name}, ${mode})`, scenarioKind: 'drill', difficulty: null,
        startedAt: new Date().toISOString(), duration: Math.round(results.reduce((a, r) => a + r.rt, 0)),
        score: { total: acc, grade: gradeFor(acc), classAccuracy: acc, classification: acc, confusion, medianDetection: null, threats: 0, defeated: 0 },
        results, deltas,
      };
      try {
        await app.store.saveSession(session);
        await app.store.updateTrainee(app.trainee.id, { profile });
        await app.refreshTrainee();
      } catch (err) {
        toast(`Could not save drill: ${err.message}`, 'bad');
      }
      const byType = TYPE_KEYS.map((k) => {
        const rs = results.filter((r) => r.type === k);
        return rs.length ? h('tr', {}, h('td', {}, TYPES[k].name), h('td', { class: 'num' }, `${rs.filter((r) => r.ok).length}/${rs.length}`),
          h('td', { class: 'secondary' }, rs.filter((r) => !r.ok).map((r) => (r.answer ? TYPES[r.answer].short : 'timeout')).join(', ') || '—')) : null;
      });
      mount(main, h('div', { class: 'page' },
        h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Drill results'))),
        h('div', { class: 'grid g2' },
          h('div', { class: 'card' },
            h('div', { class: 'hero' }, h('span', { class: 'figure' }, `${acc}%`), h('span', { class: `grade ${gradeFor(acc).key}` }, gradeFor(acc).name)),
            h('p', { class: 'secondary', style: { marginTop: '8px' } }, `${correct} of ${results.length} correct · median response ${rts.length ? rts.sort((a, b) => a - b)[Math.floor(rts.length / 2)].toFixed(1) : '—'} s`),
            h('h4', { style: { marginTop: '12px' } }, 'Recognition mastery change'),
            h('ul', { class: 'coach-list' }, deltas.map((d) => h('li', {}, `${TYPES[d.skill.slice(4)]?.name}: ${Math.round(d.before * 100)}% → ${Math.round(d.after * 100)}%`))),
            h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => run({ n, level, mode, adaptive }) }, 'Again'), h('button', { class: 'btn', type: 'button', onclick: setup }, 'Change settings'), h('a', { class: 'btn ghost', href: '#/library' }, 'Study the threat library'))),
          h('div', { class: 'card' }, h('h3', {}, 'By threat type'), h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', { class: 'num' }, 'Correct'), h('th', {}, 'Confused with'))), h('tbody', {}, byType))))));
    };

    next();
  };

  setup();
  return cleanup;
}
