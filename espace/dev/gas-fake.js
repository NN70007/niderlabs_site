/**
 * Simulateur minimal de Google Apps Script pour tester espace/serveur/Code.gs hors de Google.
 * Usage : const { charger } = require('./gas-fake'); const srv = charger(); srv.run('installer'); srv.post({ action: ... })
 * Aucune donnée réelle : tout vit en mémoire. Le « dépôt GitHub » lit les fichiers du socle et garde les écritures en mémoire.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..', '..');

function charger(opts) {
  opts = opts || {};
  const sheets = {};
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const mails = [];     // e-mails envoyés (MailApp)
  const github = [];    // écritures reçues par le faux GitHub
  const depot = {};     // fichiers écrits : chemin -> { content (base64), sha }
  const drive = { dossiers: {}, fichiers: {}, n: 0 };
  const googleTokens = opts.googleTokens || {}; // idToken -> réponse de tokeninfo

  function blob(bytes, type, name) {
    const b = Buffer.from(bytes || []);
    const o = { getBytes: () => Array.from(b), getContentType: () => type, getName: () => name, getDataAsString: () => b.toString('utf8'), setName: (n) => { name = n; return o; } };
    return o;
  }
  function iter(l) { let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }
  function dossier(id, nom) {
    const fichiersIci = () => Object.values(drive.fichiers).filter((f) => f.parent === id && !f.isTrashed());
    return {
      getId: () => id, getName: () => nom, getUrl: () => 'https://drive.google.com/drive/folders/' + id, isTrashed: () => false,
      getFiles: () => iter(fichiersIci()),
      getFilesByName: (n) => iter(fichiersIci().filter((f) => f.getName() === n)),
      createFile: (bl) => {
        const fid = 'f' + (++drive.n); let corbeille = false; const cree = new Date(drive.maintenant || Date.now());
        const f = { parent: id, getId: () => fid, getName: () => bl.getName(), getBlob: () => bl,
          isTrashed: () => corbeille, setTrashed: (v) => { corbeille = !!v; }, getDateCreated: () => cree };
        drive.fichiers[fid] = f; return f;
      }
    };
  }

  function makeSheet(name) {
    const data = [];
    const sh = {
      name, data,
      getMaxRows: () => Math.max(1000, data.length),
      setFrozenRows: () => sh,
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] || []).length,
      getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
      getRange: (r, c, nr, nc) => {
        nr = nr || 1; nc = nc || 1;
        const rg = {
          setNumberFormat: () => rg,
          setValues: (vals) => {
            for (let i = 0; i < nr; i++) {
              while (data.length < r + i) data.push([]);
              const row = data[r + i - 1];
              for (let j = 0; j < nc; j++) {
                let v = vals[i][j];
                // Comme Sheets : une valeur commençant par = + - @ serait une formule. Le code doit la protéger.
                if (typeof v === 'string' && /^[=+\-@]/.test(v)) throw new Error('Valeur interprétable comme formule écrite sans protection : ' + v);
                if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
                row[c + j - 1] = v;
              }
            }
            return rg;
          }
        };
        return rg;
      },
      deleteRow: (r) => { data.splice(r - 1, 1); }
    };
    return sh;
  }

  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fake',
    getId: () => 'fake'
  };

  function fauxGithub(url, o) {
    const chemin = decodeURIComponent((url.split('/contents/')[1] || '').split('?')[0]);
    const methode = (o.method || 'get').toUpperCase();
    if (methode === 'GET') {
      if (depot[chemin]) return [200, { sha: depot[chemin].sha, content: depot[chemin].content, path: chemin }];
      const f = path.join(RACINE, chemin);
      if (f.startsWith(RACINE) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const buf = fs.readFileSync(f);
        return [200, { sha: 'sha-' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12), content: buf.toString('base64'), path: chemin }];
      }
      return [404, { message: 'Not Found' }];
    }
    const p = JSON.parse(o.payload || '{}');
    github.push({ chemin, message: p.message, content: p.content, sha: p.sha, auth: (o.headers || {}).Authorization });
    const sha = 'sha-' + crypto.createHash('sha1').update(p.content || '').digest('hex').slice(0, 12);
    depot[chemin] = { content: p.content, sha };
    return [p.sha || !fs.existsSync(path.join(RACINE, chemin)) ? 201 : 200, { content: { sha, path: chemin } }];
  }

  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (opts.autonome ? null : ss),
      openById: () => ss,
      create: () => ss
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => Object.assign({}, props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: (nom) => { const id = 'd' + (++drive.n); drive.dossiers[id] = dossier(id, nom); return drive.dossiers[id]; },
      getFolderById: (id) => { if (!drive.dossiers[id]) throw new Error('introuvable'); return drive.dossiers[id]; }
    },
    MailApp: {
      sendEmail: (a, b, c) => { mails.push(typeof a === 'object' ? a : { to: a, subject: b, body: c }); },
      getRemainingDailyQuota: () => 100
    },
    ScriptApp: { getOAuthToken: () => 'jeton-oauth' },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'jb@niedercorn.com' }) },
    UrlFetchApp: {
      fetch: (url, o) => {
        o = o || {};
        if (url.startsWith('https://docs.google.com/spreadsheets/')) {
          const ok = ((o.headers || {}).Authorization || '').startsWith('Bearer ');
          return { getResponseCode: () => (ok ? 200 : 401), getBlob: () => blob(Buffer.from('PK-xlsx'), 'application/vnd.ms-excel', 'export.xlsx') };
        }
        if (url.startsWith('https://api.github.com/')) {
          const [code, body] = fauxGithub(url, o);
          return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) };
        }
        if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
          const info = googleTokens[decodeURIComponent(url.split('id_token=')[1] || '')];
          return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
        }
        if (url.startsWith('https://niderlabs.com/aviator/tz/')) {
          const f = path.join(RACINE, 'aviator', 'tz', url.split('/tz/')[1]);
          const ok = fs.existsSync(f);
          return { getResponseCode: () => (ok ? 200 : 404), getContentText: () => (ok ? fs.readFileSync(f, 'utf8') : '') };
        }
        if (url.startsWith('https://aviationweather.gov/api/data/taf')) {
          const now = Math.floor(Date.now() / 1000);
          const out = [{ icaoId: 'ELLX', rawTAF: 'TAF ELLX ...', fcsts: [{ timeFrom: now - 3600, timeTo: now + 20 * 3600, wdir: 80, wspd: 12, visib: '6+', clouds: [{ cover: 'BKN', base: 2500 }] }, { timeFrom: now - 3600, timeTo: now + 3 * 3600, fcstChange: 'TEMPO', wdir: 80, wspd: 15, wgst: 25, visib: '', clouds: [] }] }];
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out) };
        }
        if (url.startsWith('https://aviationweather.gov/api/data/metar')) {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ icaoId: 'ELLX', rawOb: 'METAR ELLX 041620Z 08012KT CAVOK 09/03 Q1018', obsTime: Math.floor(Date.now() / 1000) - 600, wdir: 80, wspd: 12, altim: 1018 }]) };
        }
        if (url.startsWith('https://aviationweather.gov/api/data/airport')) {
          const AP = { ELLX: [49.6233, 6.2044, 'Luxembourg/Findel'], LFSB: [47.59, 7.5291, 'Basel/Mulhouse'], LSGS: [46.2196, 7.3267, 'Sion'] };
          const ids = decodeURIComponent(url.split('ids=')[1].split('&')[0]).split(',');
          const out = ids.filter((i) => AP[i]).map((i) => ({ icaoId: i, lat: AP[i][0], lon: AP[i][1], name: AP[i][2], runways: i === 'ELLX' ? [{ id: '06/24' }] : [{ id: '07/25' }, { id: '15/33' }] }));
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out) };
        }
        throw new Error('Adresse non simulée : ' + url);
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      newBlob: (bytes, type, name) => blob(bytes, type, name),
      base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        if (fmt === 'Z') {
          const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
          const loc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
          const min = Math.round((loc - Math.floor(d.getTime() / 1000) * 1000) / 60000), a = Math.abs(min);
          return (min < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + String(a % 60).padStart(2, '0');
        }
        return d.toISOString().slice(0, 10);
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ content: s }) })
    }
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'serveur', 'Code.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Code.gs' });

  return {
    ctx, sheets, props, cache, mails, github, depot, drive,
    run: (fnName) => vm.runInContext(fnName + '()', ctx),
    get: (params) => JSON.parse(ctx.doGet(params ? { parameter: params } : undefined).content),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content),
    lastCode: (email) => {
      const m = mails.filter((x) => x.to === email).pop();
      return m ? (m.subject.match(/(\d{6})/) || [])[1] : null;
    }
  };
}

module.exports = { charger };
