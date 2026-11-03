const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ADMIN_ACTIONS = new Set([
  'saveSettings', 'saveCategory', 'deleteCategory', 'verifyTeam', 'resetTeamPassword',
  'deleteTeam', 'verifyPlayer', 'deletePlayer', 'addScan', 'changeAdminPassword'
]);
const MAX_BODY_BYTES = 28 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found.' }, 404, cors);
      if (!originAllowed(request, env)) return json({ ok: false, error: 'Origin tidak diizinkan.' }, 403, cors);

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true, data: { service: 'lts-palu-api', status: 'ready' } }, 200, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/public/bootstrap') {
        const data = await gasCall(env, 'publicBootstrap');
        return json({ ok: true, data }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/public/check-player') {
        const body = await readJson(request);
        const data = await gasCall(env, 'checkPlayer', body);
        return json({ ok: true, data }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/public/register-team') {
        const body = await readJson(request);
        validateTeamRegistration(body);
        const data = await gasCall(env, 'registerTeam', body);
        return json({ ok: true, data }, 201, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/public/register-player') {
        const body = await readJson(request);
        validatePlayerRegistration(body);
        const data = await gasCall(env, 'registerPlayer', body);
        return json({ ok: true, data }, 201, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/admin') {
        const body = await readJson(request);
        const result = await gasCall(env, 'adminLogin', body);
        const token = await createToken({ role: 'admin', sub: 'admin' }, env.SESSION_SECRET);
        return json({ ok: true, data: { token, user: result.user || 'admin' } }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/team') {
        const body = await readJson(request);
        const result = await gasCall(env, 'teamLogin', body);
        const token = await createToken({ role: 'team', sub: result.teamId, teamId: result.teamId }, env.SESSION_SECRET);
        return json({ ok: true, data: { token } }, 200, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/bootstrap') {
        await requireRole(request, env, 'admin');
        const data = await gasCall(env, 'adminBootstrap');
        return json({ ok: true, data }, 200, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/team/bootstrap') {
        const claims = await requireRole(request, env, 'team');
        const data = await gasCall(env, 'teamBootstrap', { teamId: claims.teamId });
        return json({ ok: true, data }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/action') {
        await requireRole(request, env, 'admin');
        const body = await readJson(request);
        if (!ADMIN_ACTIONS.has(String(body.action || ''))) return json({ ok: false, error: 'Aksi admin tidak diizinkan.' }, 403, cors);
        const data = await gasCall(env, 'adminAction', body);
        return json({ ok: true, data }, 200, cors);
      }
      const photoMatch = url.pathname.match(/^\/api\/private\/photo\/([^/]+)$/);
      if (request.method === 'GET' && photoMatch) {
        const claims = await requireAnyRole(request, env, ['admin', 'team']);
        const photo = await gasCall(env, 'getPlayerPhoto', {
          playerId: decodeURIComponent(photoMatch[1]),
          teamId: claims.role === 'team' ? claims.teamId : ''
        });
        const bytes = base64ToBytes(photo.base64);
        return new Response(bytes, {
          status: 200,
          headers: {
            ...cors,
            'Content-Type': photo.mimeType || 'image/jpeg',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
          }
        });
      }
      return json({ ok: false, error: 'Endpoint tidak ditemukan.' }, 404, cors);
    } catch (error) {
      const status = Number(error.status || 500);
      return json({ ok: false, error: status >= 500 ? 'Layanan backend gagal memproses permintaan. Periksa konfigurasi Apps Script dan log Worker.' : error.message }, status, cors);
    }
  }
};

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  // Non-browser service probes (e.g. health checks) may omit Origin.
  if (!origin) return true;
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const selectedOrigin = origin && allowed.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': selectedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...cors } });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) throw httpError(413, 'Total ukuran permintaan berkas terlalu besar (maksimal 28 MB).');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw httpError(413, 'Total ukuran permintaan berkas terlalu besar (maksimal 28 MB).');
  try { return JSON.parse(text || '{}'); }
  catch (_) { throw httpError(400, 'Format JSON tidak valid.'); }
}

function validateTeamRegistration(body) {
  const required = ['nama', 'kategori', 'pelatih', 'username', 'password'];
  for (const key of required) if (!String(body[key] || '').trim()) throw httpError(400, `Kolom ${key} wajib diisi.`);
  if (String(body.password).length < 8) throw httpError(400, 'Password tim minimal 8 karakter.');
  if (!body.logo || !body.logo.base64) throw httpError(400, 'Logo tim wajib dilampirkan.');
  validateFile(body.logo, 4);
}

function validatePlayerRegistration(body) {
  const required = ['teamId', 'nama', 'nisn', 'tempatLahir', 'tglLahir', 'alamat', 'sekolah', 'npsn', 'hp', 'posisi', 'kaki', 'noPunggung', 'orangTua', 'hpOrtu'];
  for (const key of required) if (!String(body[key] || '').trim()) throw httpError(400, `Kolom ${key} wajib diisi.`);
  const files = body.files || {};
  for (const key of ['foto', 'akte', 'kk', 'ijazah', 'rapor']) {
    if (!files[key]) throw httpError(400, `Berkas ${key} wajib dilampirkan.`);
    validateFile(files[key], 3);
  }
}

function validateFile(file, maxMb) {
  if (!file || !file.name || !file.base64) throw httpError(400, 'Data berkas tidak lengkap.');
  if (String(file.base64).length > Math.ceil(maxMb * 1024 * 1024 * 1.38)) throw httpError(413, `${file.name} melebihi batas ${maxMb} MB.`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(String(file.base64))) throw httpError(400, 'Konten berkas tidak valid.');
}

async function gasCall(env, action, data = {}) {
  if (!env.GAS_WEB_APP_URL || !env.GAS_SHARED_SECRET) throw httpError(500, 'Secret GAS_WEB_APP_URL/GAS_SHARED_SECRET belum dikonfigurasi.');
  const endpoint = new URL(env.GAS_WEB_APP_URL);
  endpoint.searchParams.set('key', env.GAS_SHARED_SECRET);
  let response;
  try {
    response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    });
  } catch (_) { throw httpError(502, 'Cloudflare Worker tidak dapat menghubungi Google Apps Script.'); }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); }
  catch (_) { throw httpError(502, `Google Apps Script mengembalikan respons non-JSON (HTTP ${response.status}). Pastikan Web App sudah di-deploy dan aksesnya Anyone.`); }
  if (!response.ok || !payload.ok) {
    const err = new Error(payload.error || `Google Apps Script gagal (HTTP ${response.status}).`);
    err.status = response.status >= 400 && response.status < 500 ? response.status : (response.ok ? 400 : 502);
    throw err;
  }
  return payload.data;
}

async function requireRole(request, env, expectedRole) {
  const claims = await getClaims(request, env);
  if (claims.role !== expectedRole) throw httpError(403, 'Akses tidak diizinkan.');
  return claims;
}

async function requireAnyRole(request, env, roles) {
  const claims = await getClaims(request, env);
  if (!roles.includes(claims.role)) throw httpError(403, 'Akses tidak diizinkan.');
  return claims;
}

async function getClaims(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw httpError(401, 'Sesi login tidak ditemukan. Silakan login kembali.');
  const claims = await verifyToken(token, env.SESSION_SECRET);
  if (!claims) throw httpError(401, 'Sesi login tidak valid atau sudah kedaluwarsa.');
  return claims;
}

async function createToken(claims, secret) {
  if (!secret) throw httpError(500, 'SESSION_SECRET belum dikonfigurasi.');
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iat: now, exp: now + 8 * 60 * 60 };
  const encoded = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encoded, secret);
  return `${encoded}.${signature}`;
}

async function verifyToken(token, secret) {
  if (!secret) throw httpError(500, 'SESSION_SECRET belum dikonfigurasi.');
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const valid = await verifySignature(parts[0], parts[1], secret);
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
    if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (_) { return null; }
}

async function sign(message, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64urlEncode(new Uint8Array(signature));
}

async function verifySignature(message, signature, secret) {
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, base64urlDecode(signature), new TextEncoder().encode(message));
  } catch (_) { return false; }
}

function base64urlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(value).length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64ToBytes(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
