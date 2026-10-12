// Data access. Uses the DRONA unit server when reachable (shared across the LAN);
// otherwise falls back to on-device storage so a single laptop works fully offline.

const SUMMARY_KEYS = [
  'id', 'traineeId', 'unitId', 'mode', 'scenarioId', 'scenarioName', 'scenarioKind', 'difficulty', 'env', 'wcs',
  'seed', 'fingerprint', 'startedAt', 'duration', 'score', 'cert',
];
const summarize = (s) => Object.fromEntries(SUMMARY_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`;

class ServerBackend {
  constructor() { this.mode = 'server'; }
  async req(method, path, body) {
    const res = await fetch(`api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return res.json();
  }
  units() { return this.req('GET', 'units'); }
  createUnit(u) { return this.req('POST', 'units', u); }
  trainees(unitId) { return this.req('GET', `trainees${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`); }
  trainee(id) { return this.req('GET', `trainees/${encodeURIComponent(id)}`); }
  createTrainee(t) { return this.req('POST', 'trainees', t); }
  updateTrainee(id, patch) { return this.req('PUT', `trainees/${encodeURIComponent(id)}`, patch); }
  sessions(q = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null));
    return this.req('GET', `sessions?${p}`);
  }
  session(id) { return this.req('GET', `sessions/${encodeURIComponent(id)}`); }
  saveSession(s) { return this.req('POST', 'sessions', s); }
  scenarios() { return this.req('GET', 'scenarios'); }
  saveScenario(s) { return this.req('POST', 'scenarios', s); }
  deleteScenario(id) { return this.req('DELETE', `scenarios/${encodeURIComponent(id)}`); }
  csvUrl(q = {}) { return `api/export/sessions.csv?${new URLSearchParams(q)}`; }
}

class LocalBackend {
  constructor() { this.mode = 'local'; this.prefix = 'drona.'; }
  get(k, d) {
    try { const v = localStorage.getItem(this.prefix + k); return v ? JSON.parse(v) : d; } catch { return d; }
  }
  set(k, v) {
    try {
      localStorage.setItem(this.prefix + k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }
  async units() { return this.get('units', []); }
  async createUnit(u) {
    const unit = { id: newId('unit'), name: u.name, formation: u.formation || '', createdAt: new Date().toISOString() };
    this.set('units', [...this.get('units', []), unit]);
    return unit;
  }
  async trainees(unitId) {
    const all = this.get('trainees', []);
    return unitId ? all.filter((t) => t.unitId === unitId) : all;
  }
  async trainee(id) { return this.get('trainees', []).find((t) => t.id === id) || null; }
  async createTrainee(t) {
    const tr = { id: newId('trn'), name: t.name, rank: t.rank || '', serviceNo: t.serviceNo || '', unitId: t.unitId || null, profile: null, history: [], createdAt: new Date().toISOString() };
    this.set('trainees', [...this.get('trainees', []), tr]);
    return tr;
  }
  async updateTrainee(id, patch) {
    const all = this.get('trainees', []);
    const tr = all.find((t) => t.id === id);
    if (!tr) return null;
    Object.assign(tr, patch, { updatedAt: new Date().toISOString() });
    this.set('trainees', all);
    return tr;
  }
  async sessions({ traineeId, unitId, limit } = {}) {
    let s = this.get('sessions', []);
    if (traineeId) s = s.filter((x) => x.traineeId === traineeId);
    if (unitId) s = s.filter((x) => x.unitId === unitId);
    s = s.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return limit ? s.slice(0, Number(limit)) : s;
  }
  async session(id) { return this.get(`session.${id}`, null); }
  async saveSession(session) {
    const s = { ...session, id: session.id || newId('ses') };
    const index = this.get('sessions', []).filter((x) => x.id !== s.id);
    index.push(summarize(s));
    this.set('sessions', index);
    // Keep full records (replay is the heavy part); prune old replays if storage is full.
    if (!this.set(`session.${s.id}`, s)) {
      const old = index.slice().sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
      for (const o of old) {
        const full = this.get(`session.${o.id}`, null);
        if (full?.replay?.frames?.length) {
          full.replay.frames = [];
          this.set(`session.${o.id}`, full);
          if (this.set(`session.${s.id}`, s)) break;
        }
      }
    }
    return summarize(s);
  }
  async scenarios() { return this.get('scenarios', []); }
  async saveScenario(sc) {
    const s = { ...sc, id: sc.id || newId('scn'), kind: 'custom', updatedAt: new Date().toISOString() };
    this.set('scenarios', [...this.get('scenarios', []).filter((x) => x.id !== s.id), s]);
    return s;
  }
  async deleteScenario(id) {
    this.set('scenarios', this.get('scenarios', []).filter((x) => x.id !== id));
    return { ok: true };
  }
  csvUrl() { return null; }
}

export async function createStore() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch('api/health', { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok && (await res.json()).ok) return new ServerBackend();
  } catch {
    /* fall through to local */
  }
  return new LocalBackend();
}

export { summarize };
