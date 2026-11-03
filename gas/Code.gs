/**
 * LTS PALU - Google Apps Script data + Google Drive service
 * Deploy as Web App: Execute as Me; access: Anyone (the Worker-only shared key gates requests).
 * Run setupLtsPalu() once before first deployment.
 */

const LTS = Object.freeze({
  PLAYER_ROOT_ID: '1kOycv_210rWI8223WNZQVORG5n1Oa7P7',
  GALLERY_FOLDER_ID: '1rl1gtuXBXpXiNf18NecyjRX_4lGoR_fW',
  NEWS_FOLDER_ID: '1cSwjtQgVceYmYMGDU-WJlYbikFim5a8a',
  SHEETS: {
    Settings: ['key', 'value'],
    Categories: ['id', 'nama', 'maxTeams', 'maxPlayers'],
    Teams: ['id', 'nama', 'kategori', 'logo', 'logoFileId', 'pelatih', 'asst', 'medis', 'kitman', 'username', 'passwordSalt', 'passwordHash', 'verified', 'createdAt', 'driveFolderId'],
    Players: ['id', 'teamId', 'teamName', 'nama', 'nisn', 'tempatLahir', 'tglLahir', 'alamat', 'sekolah', 'npsn', 'hp', 'posisi', 'kaki', 'noPunggung', 'orangTua', 'hpOrtu', 'foto', 'photoFileId', 'filesJson', 'verified', 'createdAt', 'playerFolderId'],
    Scans: ['id', 'teamId', 'playerId', 'nama', 'noPunggung', 'nisn', 'waktu', 'createdAt']
  },
  DEFAULT_CATEGORIES: [
    { id: 'KAT-10', nama: 'U-10 (2016-2017)', maxTeams: 16, maxPlayers: 18 },
    { id: 'KAT-12', nama: 'U-12 (2014-2015)', maxTeams: 16, maxPlayers: 20 },
    { id: 'KAT-14', nama: 'U-14 (2012-2013)', maxTeams: 16, maxPlayers: 22 },
    { id: 'KAT-16', nama: 'U-16 (2010-2011)', maxTeams: 16, maxPlayers: 25 }
  ],
  DEFAULT_SETTINGS: {
    heroNarrative: 'Wadah resmi kompetisi sepak bola bereputasi nasional di Kota Palu, Sulawesi Tengah. Mencetak talenta muda unggul dan berprestasi menuju pentas profesional.',
    footerNarrative: 'Liga Top Skor Zona Palu merupakan kompetisi resmi kelompok umur under-age yang berorientasi pada pengembangan kualitas karakter dan keterampilan sepakbola anak muda Sulawesi Tengah.',
    'sekretariat.nama': 'Ahmad Fauzi, S.Pd',
    'sekretariat.alamat': 'Jl. Gajah Mada No. 45, Kota Palu, Sulawesi Tengah',
    'sekretariat.email': 'sekretariat@ltspalu.id',
    'sekretariat.phone': '+62 812-4567-8901'
  }
});

/** Jalankan sekali dari editor Apps Script. Simpan ID database dan shared key. */
function setupLtsPalu() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create('Database Liga Top Skor Zona Palu');
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }
  if (!props.getProperty('SHARED_SECRET')) {
    props.setProperty('SHARED_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  if (!props.getProperty('ADMIN_PASSWORD_SALT')) {
    const salt = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ADMIN_PASSWORD_SALT', salt);
    props.setProperty('ADMIN_PASSWORD_HASH', hashPassword_('admin123', salt));
  }
  ensureSheets_();
  seedDefaults_();
  // Pastikan folder tujuan benar-benar dapat diakses oleh akun pemilik script.
  DriveApp.getFolderById(LTS.PLAYER_ROOT_ID).getName();
  DriveApp.getFolderById(LTS.GALLERY_FOLDER_ID).getName();
  DriveApp.getFolderById(LTS.NEWS_FOLDER_ID).getName();
  Logger.log('Spreadsheet URL: ' + SpreadsheetApp.openById(spreadsheetId).getUrl());
  Logger.log('SHARED_SECRET (copy to Cloudflare Worker secret GAS_SHARED_SECRET): ' + props.getProperty('SHARED_SECRET'));
  Logger.log('Admin awal: username admin, password admin123. Segera ubah dari panel Admin.');
}

function doGet() {
  return jsonOutput_({ ok: true, service: 'LTS Palu Google Apps Script', status: 'ready' });
}

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const sentKey = e && e.parameter ? String(e.parameter.key || '') : '';
    const expectedKey = props.getProperty('SHARED_SECRET') || '';
    if (!expectedKey || !constantTimeEqual_(sentKey, expectedKey)) {
      return jsonOutput_({ ok: false, error: 'Unauthorized service request.' });
    }
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const request = JSON.parse(raw);
    const action = String(request.action || '');
    const data = request.data || {};
    const result = dispatch_(action, data);
    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function dispatch_(action, data) {
  switch (action) {
    case 'publicBootstrap': return publicBootstrap_();
    case 'adminLogin': return adminLogin_(data);
    case 'adminBootstrap': return adminBootstrap_();
    case 'teamLogin': return teamLogin_(data);
    case 'teamBootstrap': return teamBootstrap_(data);
    case 'registerTeam': return registerTeam_(data);
    case 'registerPlayer': return registerPlayer_(data);
    case 'checkPlayer': return checkPlayer_(data);
    case 'adminAction': return adminAction_(data);
    case 'getPlayerPhoto': return getPlayerPhoto_(data);
    default: throw new Error('Unknown service action.');
  }
}

function ensureSheets_() {
  const spreadsheet = getSpreadsheet_();
  Object.keys(LTS.SHEETS).forEach(name => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const headers = LTS.SHEETS[name];
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    else {
      const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      if (existing.filter(String).length === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sheet.setFrozenRows(1);
  });
  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 1 && defaultSheet.getLastRow() === 0) spreadsheet.deleteSheet(defaultSheet);
}

function seedDefaults_() {
  const categoryRows = readRows_('Categories');
  if (categoryRows.length === 0) LTS.DEFAULT_CATEGORIES.forEach(c => appendRow_('Categories', c));
  const settings = readSettings_();
  Object.keys(LTS.DEFAULT_SETTINGS).forEach(key => {
    if (settings[key] === undefined || settings[key] === '') setSetting_(key, LTS.DEFAULT_SETTINGS[key]);
  });
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Database belum disiapkan. Jalankan setupLtsPalu() di Apps Script.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet tidak ditemukan: ' + name);
  return sh;
}

function readRows_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== '' && v !== null)).map(row => {
    const item = {};
    headers.forEach((h, i) => item[h] = row[i]);
    return item;
  });
}

function appendRow_(name, item) {
  const sh = sheet_(name);
  const headers = LTS.SHEETS[name];
  sh.appendRow(headers.map(key => item[key] === undefined ? '' : item[key]));
}

function updateRow_(name, id, patch) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (!values.length) throw new Error('Header sheet kosong: ' + name);
  const headers = values[0].map(String);
  const idIndex = headers.indexOf('id');
  if (idIndex < 0) throw new Error('Kolom id tidak ditemukan pada ' + name);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idIndex]) === String(id)) {
      const row = values[r].slice();
      Object.keys(patch).forEach(key => {
        const col = headers.indexOf(key);
        if (col >= 0) row[col] = patch[key];
      });
      sh.getRange(r + 1, 1, 1, headers.length).setValues([row]);
      return true;
    }
  }
  return false;
}

function deleteRowsById_(name, ids) {
  const wanted = new Set((ids || []).map(String));
  if (!wanted.size) return;
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const idIndex = values[0].map(String).indexOf('id');
  for (let r = values.length - 1; r >= 1; r--) {
    if (wanted.has(String(values[r][idIndex]))) sh.deleteRow(r + 1);
  }
}

function readSettings_() {
  const result = {};
  readRows_('Settings').forEach(row => result[String(row.key)] = row.value);
  return result;
}

function setSetting_(key, value) {
  const sh = sheet_('Settings');
  const rows = sh.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][0]) === String(key)) {
      sh.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function settingsForClient_() {
  const raw = readSettings_();
  return {
    heroNarrative: String(raw.heroNarrative || LTS.DEFAULT_SETTINGS.heroNarrative),
    footerNarrative: String(raw.footerNarrative || LTS.DEFAULT_SETTINGS.footerNarrative),
    sekretariat: {
      nama: String(raw['sekretariat.nama'] || LTS.DEFAULT_SETTINGS['sekretariat.nama']),
      alamat: String(raw['sekretariat.alamat'] || LTS.DEFAULT_SETTINGS['sekretariat.alamat']),
      email: String(raw['sekretariat.email'] || LTS.DEFAULT_SETTINGS['sekretariat.email']),
      phone: String(raw['sekretariat.phone'] || LTS.DEFAULT_SETTINGS['sekretariat.phone'])
    }
  };
}

function publicBootstrap_() {
  const categories = readRows_('Categories').map(categoryView_);
  const teams = readRows_('Teams').map(teamPublicView_);
  return {
    categories,
    teams,
    settings: settingsForClient_(),
    news: listDriveContent_(LTS.NEWS_FOLDER_ID, false),
    gallery: listDriveContent_(LTS.GALLERY_FOLDER_ID, true)
  };
}

function adminBootstrap_() {
  const teams = readRows_('Teams').map(teamAdminView_);
  const players = readRows_('Players').map(playerAdminView_);
  const scannedList = readRows_('Scans').map(scanView_);
  return {
    categories: readRows_('Categories').map(categoryView_), teams, players, scannedList,
    settings: settingsForClient_(),
    news: listDriveContent_(LTS.NEWS_FOLDER_ID, false),
    gallery: listDriveContent_(LTS.GALLERY_FOLDER_ID, true)
  };
}

function teamBootstrap_(data) {
  const teamId = String(data.teamId || '');
  const team = readRows_('Teams').find(t => String(t.id) === teamId);
  if (!team) throw new Error('Tim tidak ditemukan.');
  if (!asBool_(team.verified)) throw new Error('Akun tim tidak aktif karena verifikasi dicabut admin.');
  const players = readRows_('Players').filter(p => String(p.teamId) === teamId).map(playerTeamView_);
  return { team: teamPublicView_(team), players };
}

function teamLogin_(data) {
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!username || !password) throw new Error('Username dan password wajib diisi.');
  const team = readRows_('Teams').find(t => String(t.username || '').toLowerCase() === username);
  if (!team || !verifyPassword_(password, team.passwordSalt, team.passwordHash)) throw new Error('Username atau password tim salah.');
  if (!asBool_(team.verified)) throw new Error('Tim belum diverifikasi admin.');
  return { teamId: String(team.id) };
}

function registerTeam_(data) {
  const nama = cleanText_(data.nama, 'Nama tim', 100);
  const kategori = cleanText_(data.kategori, 'Kategori usia', 80);
  const pelatih = cleanText_(data.pelatih, 'Nama pelatih', 100);
  const username = cleanText_(data.username, 'Username', 40).toLowerCase();
  const password = String(data.password || '');
  if (password.length < 8) throw new Error('Password tim minimal 8 karakter.');
  if (readRows_('Teams').some(t => String(t.username || '').toLowerCase() === username)) throw new Error('Username sudah digunakan tim lain.');
  const category = readRows_('Categories').find(c => String(c.nama) === kategori);
  if (!category) throw new Error('Kategori usia tidak valid.');
  const teamsInCategory = readRows_('Teams').filter(t => String(t.kategori) === kategori).length;
  if (teamsInCategory >= Number(category.maxTeams)) throw new Error('Kuota tim pada kategori ini sudah penuh.');
  const id = 'TIM-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const categoryFolder = getOrCreateFolder_(DriveApp.getFolderById(LTS.PLAYER_ROOT_ID), kategori);
  const teamFolder = getOrCreateFolder_(categoryFolder, nama);
  let logo = '';
  let logoFileId = '';
  if (!data.logo) throw new Error('Logo tim wajib dilampirkan.');
  validateUpload_(data.logo, 4);
  if (!/^image\/(png|jpeg|webp)$/.test(String(data.logo.mimeType || ''))) throw new Error('Logo tim harus PNG, JPG, atau WEBP.');
  if (data.logo) {
    const logoFile = createDriveFile_(data.logo, teamFolder, true);
    logoFileId = logoFile.getId();
    logo = driveThumbnail_(logoFileId, 512);
  }
  const salt = Utilities.getUuid().replace(/-/g, '');
  const row = {
    id, nama, kategori, logo, logoFileId, pelatih,
    asst: String(data.asst || ''), medis: String(data.medis || ''), kitman: String(data.kitman || ''),
    username, passwordSalt: salt, passwordHash: hashPassword_(password, salt), verified: false,
    createdAt: new Date().toISOString(), driveFolderId: teamFolder.getId()
  };
  appendRow_('Teams', row);
  return { team: teamPublicView_(row) };
}

function registerPlayer_(data) {
  const teamId = String(data.teamId || '');
  const team = readRows_('Teams').find(t => String(t.id) === teamId);
  if (!team || !asBool_(team.verified)) throw new Error('Tim tidak valid atau belum diverifikasi.');
  const category = readRows_('Categories').find(c => String(c.nama) === String(team.kategori));
  const players = readRows_('Players');
  if (category && players.filter(p => String(p.teamId) === teamId).length >= Number(category.maxPlayers)) throw new Error('Batas maksimal pemain pada tim ini sudah tercapai.');
  const nisn = cleanText_(data.nisn, 'NISN', 20);
  const noPunggung = cleanText_(data.noPunggung, 'Nomor punggung', 2);
  if (players.some(p => String(p.nisn) === nisn)) throw new Error('NISN sudah terdaftar.');
  if (players.some(p => String(p.teamId) === teamId && String(p.noPunggung) === noPunggung)) throw new Error('Nomor punggung sudah digunakan dalam tim ini.');
  const files = data.files || {};
  ['foto', 'akte', 'kk', 'ijazah', 'rapor'].forEach(key => {
    if (!files[key]) throw new Error('Semua berkas wajib dilampirkan: foto, akte, KK, ijazah, dan rapor/NISN.');
    validateUpload_(files[key], 3);
    const mime = String(files[key].mimeType || '');
    if (key === 'foto' && !/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('Foto pemain harus PNG, JPG, atau WEBP.');
    if (key !== 'foto' && !(/^image\/(png|jpeg|webp)$/.test(mime) || mime === 'application/pdf')) throw new Error('Berkas pemain harus berupa gambar atau PDF.');
  });
  const teamFolder = team.driveFolderId
    ? DriveApp.getFolderById(String(team.driveFolderId))
    : getOrCreateFolder_(getOrCreateFolder_(DriveApp.getFolderById(LTS.PLAYER_ROOT_ID), String(team.kategori)), String(team.nama));
  const id = 'PL-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const playerFolder = getOrCreateFolder_(teamFolder, cleanFolderName_(String(data.nama || 'Pemain')) + ' - ' + id);
  let photoFile;
  let uploaded;
  try {
    photoFile = createDriveFile_(files.foto, playerFolder, false);
    uploaded = { foto: fileMeta_(photoFile) };
    ['akte', 'kk', 'ijazah', 'rapor'].forEach(key => uploaded[key] = fileMeta_(createDriveFile_(files[key], playerFolder, false)));
  } catch (err) {
    trashFolderSafely_(playerFolder.getId());
    throw err;
  }
  const row = {
    id, teamId, teamName: String(team.nama), nama: cleanText_(data.nama, 'Nama pemain', 120), nisn,
    tempatLahir: cleanText_(data.tempatLahir, 'Tempat lahir', 80), tglLahir: String(data.tglLahir || ''),
    alamat: cleanText_(data.alamat, 'Alamat', 500), sekolah: cleanText_(data.sekolah, 'Sekolah', 120),
    npsn: cleanText_(data.npsn, 'NPSN', 30), hp: cleanText_(data.hp, 'Nomor HP', 40),
    posisi: cleanText_(data.posisi, 'Posisi', 80), kaki: cleanText_(data.kaki, 'Kaki dominan', 50),
    noPunggung, orangTua: cleanText_(data.orangTua, 'Nama orang tua', 120), hpOrtu: cleanText_(data.hpOrtu, 'Nomor HP orang tua', 40),
    foto: '', photoFileId: photoFile.getId(), filesJson: JSON.stringify(uploaded), verified: false,
    createdAt: new Date().toISOString(), playerFolderId: playerFolder.getId()
  };
  appendRow_('Players', row);
  return { id, nama: row.nama, teamName: row.teamName, verified: false };
}

function checkPlayer_(data) {
  const nisn = String(data.nisn || '').trim();
  if (!nisn) throw new Error('NISN wajib diisi.');
  const player = readRows_('Players').find(p => String(p.nisn) === nisn);
  if (!player) return { player: null };
  return { player: {
    nama: String(player.nama), teamName: String(player.teamName), nisn: String(player.nisn),
    noPunggung: String(player.noPunggung), posisi: String(player.posisi), verified: asBool_(player.verified)
  }};
}

function adminAction_(data) {
  const action = String(data.action || '');
  const payload = data.data || {};
  switch (action) {
    case 'saveSettings': {
      if (payload.heroNarrative !== undefined) setSetting_('heroNarrative', String(payload.heroNarrative));
      if (payload.footerNarrative !== undefined) setSetting_('footerNarrative', String(payload.footerNarrative));
      if (payload.sekretariat) {
        ['nama', 'alamat', 'email', 'phone'].forEach(key => {
          if (payload.sekretariat[key] !== undefined) setSetting_('sekretariat.' + key, String(payload.sekretariat[key]));
        });
      }
      return { settings: settingsForClient_() };
    }
    case 'saveCategory': {
      const id = String(payload.id || ('KAT-' + Utilities.getUuid().slice(0, 8)));
      const nama = cleanText_(payload.nama, 'Kategori usia', 80);
      const maxTeams = Number(payload.maxTeams);
      const maxPlayers = Number(payload.maxPlayers);
      if (!(maxTeams > 0 && maxPlayers > 0)) throw new Error('Batas tim dan pemain harus lebih dari nol.');
      const categories = readRows_('Categories');
      if (categories.some(c => String(c.nama).toLowerCase() === nama.toLowerCase() && String(c.id) !== id)) throw new Error('Nama kategori sudah ada.');
      const old = categories.find(c => String(c.id) === id);
      const row = { id, nama, maxTeams, maxPlayers };
      if (old) {
        updateRow_('Categories', id, row);
        if (String(old.nama) !== nama) {
          readRows_('Teams').filter(t => String(t.kategori) === String(old.nama)).forEach(t => {
            const folderId = moveTeamFolderToCategory_(t, nama);
            updateRow_('Teams', t.id, { kategori: nama, driveFolderId: folderId });
          });
        }
      } else appendRow_('Categories', row);
      return { categories: readRows_('Categories').map(categoryView_), teams: readRows_('Teams').map(teamAdminView_) };
    }
    case 'deleteCategory': {
      const category = readRows_('Categories').find(c => String(c.id) === String(payload.id));
      if (category && readRows_('Teams').some(t => String(t.kategori) === String(category.nama))) throw new Error('Kategori masih dipakai tim terdaftar, pindahkan/hapus tim dahulu.');
      deleteRowsById_('Categories', [payload.id]);
      return { categories: readRows_('Categories').map(categoryView_) };
    }
    case 'verifyTeam': {
      const ok = updateRow_('Teams', payload.teamId, { verified: Boolean(payload.verified) });
      if (!ok) throw new Error('Tim tidak ditemukan.');
      return { verified: Boolean(payload.verified) };
    }
    case 'resetTeamPassword': {
      const password = String(payload.password || '');
      if (password.length < 8) throw new Error('Password tim minimal 8 karakter.');
      const salt = Utilities.getUuid().replace(/-/g, '');
      const ok = updateRow_('Teams', payload.teamId, { passwordSalt: salt, passwordHash: hashPassword_(password, salt) });
      if (!ok) throw new Error('Tim tidak ditemukan.');
      return { changed: true };
    }
    case 'deleteTeam': {
      const team = readRows_('Teams').find(t => String(t.id) === String(payload.teamId));
      if (!team) throw new Error('Tim tidak ditemukan.');
      const playerIds = readRows_('Players').filter(p => String(p.teamId) === String(payload.teamId)).map(p => p.id);
      const playerRows = readRows_('Players').filter(p => String(p.teamId) === String(payload.teamId));
      playerRows.forEach(p => trashFolderSafely_(p.playerFolderId));
      trashFolderSafely_(team.driveFolderId);
      deleteRowsById_('Players', playerIds);
      deleteRowsById_('Teams', [payload.teamId]);
      removeScansForTeam_(payload.teamId);
      return { deleted: true };
    }
    case 'verifyPlayer': {
      const ok = updateRow_('Players', payload.playerId, { verified: Boolean(payload.verified) });
      if (!ok) throw new Error('Pemain tidak ditemukan.');
      return { verified: Boolean(payload.verified) };
    }
    case 'deletePlayer': {
      const player = readRows_('Players').find(p => String(p.id) === String(payload.playerId));
      if (!player) throw new Error('Pemain tidak ditemukan.');
      trashFolderSafely_(player.playerFolderId);
      deleteRowsById_('Players', [payload.playerId]);
      removeScansForPlayer_(payload.playerId);
      return { deleted: true };
    }
    case 'addScan': {
      const player = readRows_('Players').find(p => String(p.id) === String(payload.playerId));
      if (!player || String(player.teamId) !== String(payload.teamId)) throw new Error('Data scan tidak cocok dengan pemain dan tim.');
      const id = 'SC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
      const waktu = String(payload.waktu || new Date().toLocaleTimeString('id-ID'));
      appendRow_('Scans', { id, teamId: String(player.teamId), playerId: String(player.id), nama: String(player.nama), noPunggung: String(player.noPunggung), nisn: String(player.nisn), waktu, createdAt: new Date().toISOString() });
      return { id, waktu };
    }
    case 'changeAdminPassword': {
      const password = String(payload.password || '');
      if (password.length < 8) throw new Error('Password admin minimal 8 karakter.');
      const salt = Utilities.getUuid().replace(/-/g, '');
      PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_SALT', salt);
      PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', hashPassword_(password, salt));
      return { changed: true };
    }
    default: throw new Error('Aksi admin tidak diizinkan.');
  }
}

function adminLogin_(data) {
  if (String(data.username || '').trim() !== 'admin') throw new Error('Username atau password admin salah.');
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('ADMIN_PASSWORD_SALT') || '';
  const expected = props.getProperty('ADMIN_PASSWORD_HASH') || '';
  if (!verifyPassword_(String(data.password || ''), salt, expected)) throw new Error('Username atau password admin salah.');
  return { user: 'admin' };
}

function getPlayerPhoto_(data) {
  const player = readRows_('Players').find(p => String(p.id) === String(data.playerId));
  if (!player || !player.photoFileId) throw new Error('Foto pemain tidak ditemukan.');
  if (data.teamId && String(player.teamId) !== String(data.teamId)) throw new Error('Tim tidak berhak melihat foto pemain ini.');
  const file = DriveApp.getFileById(String(player.photoFileId));
  const blob = file.getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType() || 'image/jpeg' };
}

function categoryView_(row) {
  return { id: String(row.id), nama: String(row.nama), maxTeams: Number(row.maxTeams), maxPlayers: Number(row.maxPlayers) };
}

function teamPublicView_(row) {
  return {
    id: String(row.id), nama: String(row.nama), kategori: String(row.kategori), logo: String(row.logo || ''),
    pelatih: String(row.pelatih || ''), verified: asBool_(row.verified)
  };
}

function teamAdminView_(row) {
  return {
    ...teamPublicView_(row), asst: String(row.asst || ''), medis: String(row.medis || ''), kitman: String(row.kitman || ''),
    username: String(row.username || ''), driveFolderId: String(row.driveFolderId || '')
  };
}

function playerAdminView_(row) {
  return {
    id: String(row.id), teamId: String(row.teamId), teamName: String(row.teamName), nama: String(row.nama),
    nisn: String(row.nisn), tempatLahir: String(row.tempatLahir), tglLahir: String(row.tglLahir),
    alamat: String(row.alamat), sekolah: String(row.sekolah), npsn: String(row.npsn), hp: String(row.hp),
    posisi: String(row.posisi), kaki: String(row.kaki), noPunggung: String(row.noPunggung),
    orangTua: String(row.orangTua), hpOrtu: String(row.hpOrtu), foto: '', photoFileId: String(row.photoFileId || ''),
    filesJson: String(row.filesJson || '{}'), verified: asBool_(row.verified)
  };
}

function playerTeamView_(row) {
  return {
    id: String(row.id), teamId: String(row.teamId), teamName: String(row.teamName), nama: String(row.nama),
    nisn: String(row.nisn), posisi: String(row.posisi), noPunggung: String(row.noPunggung),
    foto: '', photoFileId: String(row.photoFileId || ''), verified: asBool_(row.verified)
  };
}

function scanView_(row) {
  return { teamId: String(row.teamId), playerId: String(row.playerId), nama: String(row.nama), noPunggung: String(row.noPunggung), nisn: String(row.nisn), waktu: String(row.waktu) };
}

function listDriveContent_(folderId, imagesOnly) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    if (mime === 'application/vnd.google-apps.folder') continue;
    if (imagesOnly && !/^image\//.test(mime)) continue;
    // Isi folder Berita/Galeri memang dimaksudkan untuk tayang publik.
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (ignored) {}
    const id = file.getId();
    const name = file.getName().replace(/\.[^.]+$/, '');
    const description = file.getDescription() || (imagesOnly ? '' : 'Informasi resmi Liga Top Skor Zona Palu.');
    const thumb = driveThumbnail_(id, 1200);
    const created = file.getDateCreated();
    if (imagesOnly) result.push({ id, caption: name, url: thumb, createdAt: created.toISOString() });
    else result.push({ id, judul: name, isi: description, foto: thumb, url: file.getUrl(), createdAt: created.toISOString() });
  }
  result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return result;
}

function getOrCreateFolder_(parent, name) {
  const safeName = cleanFolderName_(name);
  const matches = parent.getFoldersByName(safeName);
  return matches.hasNext() ? matches.next() : parent.createFolder(safeName);
}

function moveTeamFolderToCategory_(team, newCategoryName) {
  const root = DriveApp.getFolderById(LTS.PLAYER_ROOT_ID);
  const newCategoryFolder = getOrCreateFolder_(root, newCategoryName);
  const teamFolder = team.driveFolderId
    ? DriveApp.getFolderById(String(team.driveFolderId))
    : getOrCreateFolder_(getOrCreateFolder_(root, newCategoryName), String(team.nama));
  const parents = teamFolder.getParents();
  let alreadyInTarget = false;
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() === newCategoryFolder.getId()) alreadyInTarget = true;
    else parent.removeFolder(teamFolder);
  }
  if (!alreadyInTarget) newCategoryFolder.addFolder(teamFolder);
  return teamFolder.getId();
}

function cleanFolderName_(value) {
  return String(value || 'Tanpa Nama').replace(/[\\/:*?"<>|\[\]]/g, '-').trim().slice(0, 100) || 'Tanpa Nama';
}

function createDriveFile_(payload, folder, makePublic) {
  validateUpload_(payload, 4);
  const bytes = Utilities.base64Decode(String(payload.base64));
  const mime = String(payload.mimeType || 'application/octet-stream');
  const name = cleanFolderName_(payload.name || 'berkas');
  const blob = Utilities.newBlob(bytes, mime, name);
  const file = folder.createFile(blob);
  if (makePublic) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

function validateUpload_(payload, maxMb) {
  if (!payload || !payload.base64 || !payload.name) throw new Error('Payload berkas tidak lengkap.');
  const b64 = String(payload.base64);
  if (b64.length > Math.ceil(maxMb * 1024 * 1024 * 1.38)) throw new Error('Berkas melebihi batas ukuran ' + maxMb + ' MB.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('Format berkas tidak valid.');
}

function fileMeta_(file) {
  return { id: file.getId(), name: file.getName(), mimeType: file.getMimeType() };
}

function driveThumbnail_(fileId, width) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + Number(width || 512);
}

function trashFolderSafely_(folderId) {
  if (!folderId) return;
  try { DriveApp.getFolderById(String(folderId)).setTrashed(true); } catch (ignored) {}
}

function removeScansForTeam_(teamId) {
  readRows_('Scans').filter(s => String(s.teamId) === String(teamId)).forEach(s => deleteRowsById_('Scans', [s.id]));
}

function removeScansForPlayer_(playerId) {
  readRows_('Scans').filter(s => String(s.playerId) === String(playerId)).forEach(s => deleteRowsById_('Scans', [s.id]));
}

function cleanText_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(label + ' wajib diisi.');
  if (text.length > maxLength) throw new Error(label + ' terlalu panjang.');
  return text;
}

function asBool_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(password), Utilities.Charset.UTF_8);
  return digest.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function verifyPassword_(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return constantTimeEqual_(hashPassword_(password, salt), String(expectedHash));
}

function constantTimeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonOutput_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}