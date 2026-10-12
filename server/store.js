// JSON-file datastore with atomic writes. Index data lives in one file; full session
// records (tracks, events, replay) live in one file each so the index stays small.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SUMMARY_KEYS = [
  'id', 'traineeId', 'unitId', 'mode', 'scenarioId', 'scenarioName', 'scenarioKind', 'difficulty', 'env', 'wcs',
  'seed', 'fingerprint', 'startedAt', 'duration', 'score', 'cert',
];

export function summarize(session) {
  const out = {};
  for (const k of SUMMARY_KEYS) if (session[k] !== undefined) out[k] = session[k];
  return out;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.sessionsDir = path.join(dir, 'sessions');
    this.file = path.join(dir, 'drona-db.json');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.db = this.load();
    this.writing = Promise.resolve();
  }

  load() {
    const empty = { version: 1, units: [], trainees: [], sessions: [], scenarios: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...empty, ...raw };
    } catch {
      return empty;
    }
  }

  save() {
    const data = JSON.stringify(this.db, null, 1);
    this.writing = this.writing.then(() => atomicWrite(this.file, data));
    return this.writing;
  }

  // Units ---------------------------------------------------------------
  listUnits() { return this.db.units; }
  createUnit({ name, formation = '' }) {
    const unit = { id: newId('unit'), name: String(name).slice(0, 80), formation: String(formation).slice(0, 80), createdAt: new Date().toISOString() };
    this.db.units.push(unit);
    this.save();
    return unit;
  }

  // Trainees ------------------------------------------------------------
  listTrainees(unitId) { return unitId ? this.db.trainees.filter((t) => t.unitId === unitId) : this.db.trainees; }
  getTrainee(id) { return this.db.trainees.find((t) => t.id === id) || null; }
  createTrainee({ name, rank = '', serviceNo = '', unitId = null, profile = null }) {
    const tr = {
      id: newId('trn'), name: String(name).slice(0, 80), rank: String(rank).slice(0, 30), serviceNo: String(serviceNo).slice(0, 30),
      unitId, profile, history: [], createdAt: new Date().toISOString(),
    };
    this.db.trainees.push(tr);
    this.save();
    return tr;
  }
  updateTrainee(id, patch) {
    const tr = this.getTrainee(id);
    if (!tr) return null;
    for (const k of ['name', 'rank', 'serviceNo', 'unitId', 'profile', 'history']) if (patch[k] !== undefined) tr[k] = patch[k];
    tr.updatedAt = new Date().toISOString();
    this.save();
    return tr;
  }

  // Sessions ------------------------------------------------------------
  listSessions({ traineeId, unitId, limit } = {}) {
    let s = this.db.sessions;
    if (traineeId) s = s.filter((x) => x.traineeId === traineeId);
    if (unitId) s = s.filter((x) => x.unitId === unitId);
    s = s.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return limit ? s.slice(0, limit) : s;
  }
  getSession(id) {
    if (!/^[\w-]+$/.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.sessionsDir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }
  async saveSession(session) {
    const s = { ...session, id: session.id && /^[\w-]+$/.test(session.id) ? session.id : newId('ses') };
    await atomicWrite(path.join(this.sessionsDir, `${s.id}.json`), JSON.stringify(s));
    this.db.sessions = this.db.sessions.filter((x) => x.id !== s.id);
    this.db.sessions.push(summarize(s));
    await this.save();
    return summarize(s);
  }

  // Custom scenarios ----------------------------------------------------
  listScenarios() { return this.db.scenarios; }
  saveScenario(sc) {
    const s = { ...sc, id: sc.id && /^[\w-]+$/.test(sc.id) ? sc.id : newId('scn'), kind: 'custom', updatedAt: new Date().toISOString() };
    this.db.scenarios = this.db.scenarios.filter((x) => x.id !== s.id);
    this.db.scenarios.push(s);
    this.save();
    return s;
  }
  deleteScenario(id) {
    const before = this.db.scenarios.length;
    this.db.scenarios = this.db.scenarios.filter((x) => x.id !== id);
    this.save();
    return before !== this.db.scenarios.length;
  }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
}

export { sessionsCsv } from '../public/js/core/csv.js';
