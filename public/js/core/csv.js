// CSV export of session summaries (shared by the server and the offline client).

export function sessionsCsv(sessions, trainees, units) {
  const tName = Object.fromEntries(trainees.map((t) => [t.id, `${t.rank ? `${t.rank} ` : ''}${t.name}`]));
  const uName = Object.fromEntries(units.map((u) => [u.id, u.name]));
  const head = ['session_id', 'date', 'unit', 'trainee', 'mode', 'scenario', 'difficulty', 'terrain', 'time', 'weather', 'ew', 'wcs',
    'score', 'grade', 'detection', 'classification', 'identification', 'decision', 'outcome', 'median_detect_s', 'threats', 'defeated', 'leaked', 'ai_teaming', 'asset_health'];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sessions.map((s) => [
    s.id, s.startedAt, uName[s.unitId] || '', tName[s.traineeId] || '', s.mode, s.scenarioName, s.difficulty,
    s.env?.terrain, s.env?.time, s.env?.weather, s.env?.ew, s.wcs,
    s.score?.total, s.score?.grade?.key, s.score?.detection, s.score?.classification, s.score?.identification, s.score?.decision, s.score?.outcome,
    s.score?.medianDetection, s.score?.threats, s.score?.defeated, s.score?.leaked, s.score?.aiTeaming, s.score?.assetHealth,
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}
