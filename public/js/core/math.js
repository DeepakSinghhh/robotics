// Sim coordinates: x = east (m), y = north (m), z = altitude AGL (m).
// Bearings are degrees clockwise from true north.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const angleDiff = (a, b) => {
  const d = wrap360(b - a);
  return d > 180 ? d - 360 : d;
};

export const bearingOf = (dx, dy) => wrap360(Math.atan2(dx, dy) * RAD);
export const bearingTo = (from, to) => bearingOf(to.x - from.x, to.y - from.y);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
export const len2 = (v) => Math.hypot(v.x, v.y);
export const len3 = (v) => Math.hypot(v.x, v.y, v.z || 0);

export const polar = (bearingDeg, range) => ({
  x: Math.sin(bearingDeg * DEG) * range,
  y: Math.cos(bearingDeg * DEG) * range,
});

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const norm3 = (a) => {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const limit3 = (a, max) => {
  const l = len3(a);
  return l > max ? scale3(a, max / l) : a;
};

export const round = (v, p = 1) => Math.round(v * p) / p;

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtBearing(b) {
  return String(Math.round(wrap360(b)) % 360).padStart(3, '0');
}

// Elevation angle (deg) from observer to a point.
export function elevationTo(from, to) {
  const d = dist2(from, to);
  return Math.atan2((to.z || 0) - (from.z || 0), Math.max(d, 1e-6)) * RAD;
}

// Closest point of approach of a constant-velocity track to the origin (2D).
export function cpa(pos, vel) {
  const v2 = vel.x * vel.x + vel.y * vel.y;
  if (v2 < 1e-6) return { t: 0, d: Math.hypot(pos.x, pos.y) };
  const t = Math.max(0, -(pos.x * vel.x + pos.y * vel.y) / v2);
  return { t, d: Math.hypot(pos.x + vel.x * t, pos.y + vel.y * t) };
}
