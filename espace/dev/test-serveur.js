/* Tests du serveur (espace/serveur/Code.gs) avec le simulateur, sans Google. Lancer : node espace/dev/test-serveur.js */
'use strict';
const assert = require('assert');
const { charger } = require('./gas-fake');

const CLIENT = 'client-test.apps.googleusercontent.com';
const ADMIN = 'jb@niedercorn.com';
// Adresses fictives, construites à l'exécution sur le domaine réservé example.com (aucune adresse réelle dans le dépôt).
const adr = (nom) => nom + '@' + 'example.com';
const futur = String(Math.floor(Date.now() / 1000) + 3600);
const jeton = (email, autres) => Object.assign({ aud: CLIENT, iss: 'https://accounts.google.com', email, email_verified: 'true', exp: futur }, autres || {});
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64');
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(16)]).toString('base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]).toString('base64');

let n = 0;
function ok(cond, msg) { assert.ok(cond, msg); n++; console.log('  ✓ ' + msg); }
function connecterParCode(srv, email) {
  delete srv.cache['otpn:' + email]; delete srv.cache['otpn:*'];
  srv.post({ action: 'auth.demanderCode', email });
  return srv.post({ action: 'auth.verifierCode', email, code: srv.lastCode(email) }).token;
}

const srv = charger({
  props: { GOOGLE_CLIENT_ID: CLIENT, SITE_NOM: 'Site de test' },
  googleTokens: {
    'tok-jb': jeton(ADMIN),
    'tok-autre-app': jeton(ADMIN, { aud: 'autre-client' }),
    'tok-inconnu': jeton(adr('pirate')),
    'tok-non-verifie': jeton(ADMIN, { email_verified: 'false' }),
    'tok-expire': jeton(ADMIN, { exp: '1000' }),
    'tok-faux-emetteur': jeton(ADMIN, { iss: 'https://pirate.example.com' })
  }
});

console.log('Installation');
srv.run('installer');
ok(srv.sheets.Acces && srv.sheets.Journal, 'onglets Acces et Journal créés');
ok(srv.sheets.Acces.data.length === 2 && srv.sheets.Acces.data[1][0] === ADMIN && srv.sheets.Acces.data[1][2] === 'oui', 'administrateur initial inscrit avec le droit admin');
srv.run('installer');
ok(srv.sheets.Acces.data.length === 2, 'relancer « installer » ne duplique rien');
ok(JSON.stringify(srv.get()) === JSON.stringify({ ok: true, version: srv.ctx.CONFIG.VERSION }), 'doGet renvoie { ok: true, version }');

console.log('Requêtes malformées');
ok(srv.post('pas du json').code === 'requete', 'requête illisible refusée');
ok(srv.post('[1,2]').code === 'requete', 'requête qui n\'est pas un objet refusée');
ok(srv.post({ action: 'inexistante', token: 'x' }).code === 'session', 'action inconnue sans session : refus de session d\'abord');

console.log('Connexion Google');
let r = srv.post({ action: 'auth.google', idToken: 'tok-jb' });
ok(r.ok && r.token && r.user.admin && r.user.actualites, 'jeton Google valide → session administrateur');
const tJB = r.token;
ok(srv.post({ action: 'moi', token: tJB }).user.nom === 'Jean-Baptiste Niedercorn', 'la session donne accès à « moi »');
ok(!srv.post({ action: 'auth.google', idToken: 'tok-autre-app' }).ok, 'jeton émis pour une autre application refusé');
ok(!srv.post({ action: 'auth.google', idToken: 'tok-non-verifie' }).ok, 'adresse Google non vérifiée refusée');
ok(!srv.post({ action: 'auth.google', idToken: 'tok-expire' }).ok, 'jeton Google expiré refusé');
ok(!srv.post({ action: 'auth.google', idToken: 'tok-faux-emetteur' }).ok, 'jeton d\'un autre émetteur refusé');
r = srv.post({ action: 'auth.google', idToken: 'tok-inconnu' });
ok(!r.ok && r.code === 'non_autorise', 'compte Google non inscrit refusé');
ok(!srv.post({ action: 'auth.google', idToken: 'forge' }).ok, 'jeton forgé refusé');
ok(Object.keys(srv.props).concat(Object.values(srv.props)).every((k) => !k.includes(tJB)), 'le jeton de session n\'est jamais stocké en clair');
{
  const sans = charger({ googleTokens: { g: jeton(ADMIN) } });
  sans.run('installer');
  ok(sans.post({ action: 'auth.google', idToken: 'g' }).code === 'config', 'sans GOOGLE_CLIENT_ID : connexion Google refusée proprement');
}

console.log('Sans session');
ok(srv.post({ action: 'acces.lister' }).code === 'session', 'aucune donnée sans session');
ok(srv.post({ action: 'acces.lister', token: 'n-importe-quoi' }).code === 'session', 'aucune donnée avec une session inventée');
ok(srv.post({ action: 'pub.github', token: { $ne: 1 }, methode: 'GET', chemin: 'actualites.json' }).code === 'session', 'jeton qui n\'est pas une chaîne refusé');

console.log('Gestion des accès');
const add = (p, orig) => srv.post({ action: 'acces.enregistrer', token: tJB, personne: p, emailOriginal: orig });
ok(add({ email: adr('Redac'), nom: 'Rita Rédaction', actualites: true }).ok, 'ajout d\'une rédactrice (actualités)');
ok(add({ email: adr('membre'), nom: '=HYPERLINK("x")', note: '+352 au téléphone' }).ok, 'ajout d\'une personne sans droit (saisies = et + neutralisées)');
ok(add({ email: adr('second') + ', ' + adr('second.bis'), nom: 'Second Admin', admin: true }).ok, 'ajout d\'un second administrateur avec deux adresses');
r = srv.post({ action: 'acces.lister', token: tJB });
ok(r.ok && r.personnes.length === 4 && r.journal.length > 0, 'liste des accès et journal');
ok(r.personnes.find((p) => p.cle === adr('membre')).nom === '=HYPERLINK("x")', 'les valeurs relues sont intactes');
ok(r.personnes.find((p) => p.cle === adr('redac')).actualites === true, 'adresse ramenée en minuscules, droit relu');
ok(!add({ email: ADMIN, nom: 'JB', admin: false }, ADMIN).ok, 'impossible de retirer ses propres droits d\'administration');
ok(!add({ email: ADMIN, nom: 'JB', admin: true, actif: false }, ADMIN).ok, 'impossible de désactiver son propre accès');
ok(!add({ email: adr('autre'), nom: 'JB', admin: true }, ADMIN).ok, 'impossible de retirer l\'adresse avec laquelle on est connecté');
ok(add({ email: ADMIN, nom: 'Jean-Baptiste N.', admin: true, note: 'renommé' }, ADMIN).ok, 'modifier sa propre fiche sans retirer ses droits');
ok(!srv.post({ action: 'acces.supprimer', token: tJB, email: ADMIN }).ok, 'impossible de supprimer son propre accès');
ok(add({ email: adr('redac'), nom: 'Doublon' }).code === 'donnees', 'une adresse ne peut appartenir qu\'à une seule personne');
ok(add({ email: 'pas-une-adresse', nom: 'X' }).code === 'donnees', 'adresse invalide refusée');
ok(add({ email: adr('x'), nom: 'X' }, adr('fantome')).code === 'introuvable', 'modification d\'une personne disparue refusée');

console.log('Connexion par code');
const avant = srv.mails.length;
r = srv.post({ action: 'auth.demanderCode', email: adr('redac') });
ok(r.ok && srv.mails.length === avant + 1 && /Site de test/.test(srv.mails[srv.mails.length - 1].body), 'code envoyé à une adresse autorisée, au nom du site');
r = srv.post({ action: 'auth.demanderCode', email: adr('inconnu') });
ok(r.ok && srv.mails.length === avant + 1, 'adresse inconnue : même réponse, aucun e-mail envoyé');
ok(srv.post({ action: 'auth.demanderCode', email: 'nimporte' }).code === 'email', 'adresse mal formée refusée');
ok(!srv.post({ action: 'auth.verifierCode', email: adr('redac'), code: '000000' }).ok, 'mauvais code refusé');
const code = srv.lastCode(adr('redac'));
ok(Object.values(srv.cache).every((v) => !v.includes(code)), 'le code n\'est pas conservé en clair');
r = srv.post({ action: 'auth.verifierCode', email: adr('REDAC'), code });
ok(r.ok && r.user.actualites && !r.user.admin, 'bon code → session de rédactrice (sans droit admin)');
const tRedac = r.token;
ok(!srv.post({ action: 'auth.verifierCode', email: adr('redac'), code }).ok, 'un code ne sert qu\'une fois');
srv.post({ action: 'auth.demanderCode', email: adr('membre') });
for (let i = 0; i < 5; i++) srv.post({ action: 'auth.verifierCode', email: adr('membre'), code: '111111' });
ok(!srv.post({ action: 'auth.verifierCode', email: adr('membre'), code: srv.lastCode(adr('membre')) }).ok, 'code bloqué après 5 essais');
for (let i = 0; i < 6; i++) r = srv.post({ action: 'auth.demanderCode', email: adr('second') });
ok(!r.ok && r.code === 'limite', 'limite de demandes de code par heure');
const tMembre = connecterParCode(srv, adr('membre'));
const tSecond = connecterParCode(srv, adr('second.bis'));
ok(srv.post({ action: 'moi', token: tSecond }).user.nom === 'Second Admin', 'connexion avec la seconde adresse : même personne');

console.log('Droits vérifiés côté serveur');
ok(srv.post({ action: 'acces.lister', token: tRedac }).code === 'droits', 'une rédactrice ne voit pas les accès');
ok(srv.post({ action: 'acces.enregistrer', token: tRedac, personne: { email: adr('redac'), nom: 'R', admin: true }, emailOriginal: adr('redac') }).code === 'droits', 'une rédactrice ne peut pas se donner le droit admin');
ok(srv.post({ action: 'pub.github', token: tMembre, methode: 'GET', chemin: 'actualites.json' }).code === 'droits', 'une personne sans droit ne lit pas via le serveur de publication');
ok(srv.post({ action: 'moi', token: tMembre }).user.actualites === false, 'droits relus à chaque demande');

console.log('Publication (API GitHub)');
ok(srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' }).code === 'config', 'sans GITHUB_TOKEN ni GITHUB_REPO : refus propre');
srv.props.GITHUB_TOKEN = 'jeton-de-test';
ok(srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' }).code === 'config', 'sans GITHUB_REPO : refus propre');
srv.props.GITHUB_REPO = 'compte/depot invalide';
ok(srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' }).code === 'config', 'GITHUB_REPO mal formé refusé');
srv.props.GITHUB_REPO = 'NN70007/socle_test';
let x = srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' });
ok(x.ok && x.status === 200 && Array.isArray(JSON.parse(Buffer.from(x.data.content, 'base64').toString())) && x.data.sha, 'lecture de actualites.json via le serveur');
const article = { id: 'premier-article', titre: 'Premier article', date: '2026-11-04', texte: 'Bonjour.\n\nDeuxième paragraphe.', image: 'assets/photo-1.jpg' };
x = srv.post({ action: 'pub.github', token: tRedac, methode: 'PUT', chemin: 'actualites.json', corps: { message: 'Admin : nouvel article', content: b64([article]), sha: x.data.sha } });
ok(x.ok && x.status < 300 && srv.github.length === 1 && /par Rita Rédaction/.test(srv.github[0].message) && srv.github[0].auth === 'Bearer jeton-de-test', 'publication signée du nom de la personne, jeton côté serveur');
ok(srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' }).data.sha === x.data.sha, 'le sha renvoyé correspond au fichier publié');
const put = (chemin, content, t) => srv.post({ action: 'pub.github', token: t || tRedac, methode: 'PUT', chemin, corps: { content } });
ok(put('assets/photo-1.jpg', JPEG).ok, 'envoi d\'une image JPEG');
ok(put('assets/photo-2.png', PNG).ok && put('assets/photo-3.webp', WEBP).ok, 'envoi d\'images PNG et WebP');
ok(put('assets/faux.jpg', b64('<script>alert(1)</script>    ')).code === 'donnees', 'fichier qui n\'est pas une image refusé malgré son extension');
ok(put('assets/x.svg', b64('<svg/>')).code === 'droits', 'SVG refusé (pourrait contenir du code)');
ok(put('assets/doc.pdf', JPEG).code === 'droits', 'autres types de fichiers refusés');
ok(put('index.html', b64('<h1>piraté</h1>')).code === 'droits', 'impossible de modifier une page du site');
ok(put('espace/config.js', b64('x')).code === 'droits', 'impossible de modifier la configuration');
ok(put('assets/../index.html', JPEG).code === 'droits', 'chemins détournés refusés');
ok(put('assets/sous/dossier.jpg', JPEG).code === 'droits', 'sous-dossiers de assets/ refusés');
ok(put('actualites.json', b64('pas du json')).code === 'donnees', 'JSON invalide refusé avant publication');
ok(put('actualites.json', b64({ articles: [] })).code === 'donnees', 'format autre qu\'une liste refusé');
ok(put('actualites.json', b64([Object.assign({}, article, { image: 'javascript:alert(1)' })])).code === 'donnees', 'image hors de assets/ refusée');
ok(put('actualites.json', b64([Object.assign({}, article, { html: '<script>' })])).code === 'donnees', 'champ inconnu refusé');
ok(put('actualites.json', b64([article, article])).code === 'donnees', 'identifiants en double refusés');
ok(put('actualites.json', b64([Object.assign({}, article, { date: '4 novembre' })])).code === 'donnees', 'date mal formée refusée');
ok(put('actualites.json', b64([Object.assign({}, article, { titre: '  ' })])).code === 'donnees', 'titre vide refusé');
ok(put('actualites.json', b64([])).ok, 'liste vide acceptée (tous les articles supprimés)');
ok(srv.post({ action: 'pub.github', token: tRedac, methode: 'DELETE', chemin: 'actualites.json' }).code === 'droits', 'suppression de fichier refusée');
ok(put('actualites.json', b64([]), tMembre).code === 'droits', 'publication refusée sans droit actualités');
ok(put('actualites.json', b64([article]), tSecond).ok, 'un administrateur publie aussi');
ok(JSON.stringify(srv.post({ action: 'moi', token: tRedac })).indexOf('jeton-de-test') < 0 && JSON.stringify(srv.post({ action: 'pub.github', token: tRedac, methode: 'GET', chemin: 'actualites.json' })).indexOf('jeton-de-test') < 0, 'le jeton GitHub n\'est jamais renvoyé au navigateur');
ok(srv.sheets.Journal.data.some((l) => l[2] === 'publication'), 'publications inscrites au journal');

console.log('Déconnecter partout, retrait d\'accès');
const tRedac2 = connecterParCode(srv, adr('redac'));
r = srv.post({ action: 'acces.deconnecter', token: tJB, email: adr('redac') });
ok(r.ok && r.fermees === 2 && !r.vous, 'toutes les sessions de la personne sont fermées');
ok(srv.post({ action: 'moi', token: tRedac }).code === 'session' && srv.post({ action: 'moi', token: tRedac2 }).code === 'session', 'ses appareils sont déconnectés');
ok(srv.post({ action: 'moi', token: tJB }).ok, 'les autres sessions restent ouvertes');
ok(srv.post({ action: 'acces.deconnecter', token: tMembre, email: adr('redac') }).code === 'droits', 'réservé aux administrateurs');
const tRedac3 = connecterParCode(srv, adr('redac'));
ok(srv.post({ action: 'moi', token: tRedac3 }).ok, 'la personne peut se reconnecter (droits inchangés)');
ok(add({ email: adr('redac'), nom: 'Rita Rédaction', actualites: true, actif: false }, adr('redac')).ok && srv.post({ action: 'moi', token: tRedac3 }).code === 'session', 'désactiver un accès coupe la session');
ok(srv.post({ action: 'acces.supprimer', token: tJB, email: adr('membre') }).ok && srv.post({ action: 'moi', token: tMembre }).code === 'session', 'supprimer un accès coupe la session');
ok(!Object.keys(srv.props).some((k) => k.startsWith('s:') && JSON.parse(srv.props[k]).email === adr('membre')), 'les sessions d\'un accès supprimé sont effacées');
ok(srv.post({ action: 'auth.deconnexion', token: tSecond }).ok && srv.post({ action: 'moi', token: tSecond }).code === 'session', 'déconnexion');

console.log('Entretien des sessions');
srv.props['s:vieille'] = JSON.stringify({ email: ADMIN, exp: Date.now() - 1000 });
srv.props['s:abimee'] = 'pas du json';
ok(/2 session/.test(srv.run('nettoyerSessions')) && !('s:vieille' in srv.props) && srv.post({ action: 'moi', token: tJB }).ok, 'nettoyerSessions retire les sessions expirées ou abîmées, garde les autres');
ok('GITHUB_TOKEN' in srv.props && 'GOOGLE_CLIENT_ID' in srv.props, 'nettoyerSessions ne touche pas aux autres propriétés');

console.log('Sauvegarde quotidienne');
{
  const sv = charger({ props: { SITE_NOM: 'Site de test', GITHUB_TOKEN: 'cle-secrete' } });
  sv.run('installer');
  let m = sv.run('sauvegarderEspace');
  const fichiers = () => Object.values(sv.drive.fichiers).filter((f) => !f.isTrashed() && /^Site de test - Base - /.test(f.getName()));
  ok(/enregistrée/.test(m) && fichiers().length === 1 && sv.props.SAUV_DOSSIER_ID && sv.props.SAUV_DERNIERE, 'copie Excel du jour créée dans le dossier des sauvegardes');
  ok(sv.drive.dossiers[sv.props.SAUV_DOSSIER_ID].getName() === 'Sauvegardes – Site de test', 'dossier nommé d\'après le site');
  sv.run('sauvegarderEspace');
  ok(fichiers().length === 1, 'une seule copie par jour');
  sv.drive.maintenant = Date.now() - 40 * 86400000;
  const dossier = sv.drive.dossiers[sv.props.SAUV_DOSSIER_ID];
  const vieux = dossier.createFile(sv.ctx.Utilities.newBlob([1], 'x', 'Site de test - Base - 2020-01-01.xlsx'));
  const autre = dossier.createFile(sv.ctx.Utilities.newBlob([1], 'x', 'Note personnelle.txt'));
  delete sv.drive.maintenant;
  m = sv.run('sauvegarderEspace');
  ok(vieux.isTrashed() && !autre.isTrashed() && /1 ancienne/.test(m), 'copies de plus de 30 jours retirées, autres fichiers intacts');
  ok(!Object.values(sv.drive.fichiers).some((f) => /cle-secrete/.test(f.getBlob().getDataAsString())), 'aucune clé dans la sauvegarde');
}

console.log('Script autonome (hors feuille)');
{
  const auto = charger({ autonome: true });
  ok(/Installation terminée/.test(auto.run('installer')) && auto.props.SHEET_ID === 'fake', 'installer crée et mémorise la feuille si le script n\'est pas rattaché');
  ok(auto.sheets.Acces.data.length === 2, 'onglets créés dans la feuille mémorisée');
}

console.log('Aviator METAR : montres');
{
  const av = charger({ props: { SITE_NOM: 'NiderLabs' } });
  av.run('installer');
  ok(av.sheets.Montres && av.sheets.Aeroports, 'onglets Montres et Aeroports créés');
  const ID = 'abcDEF1234567890', K = 'cleSecrete0123456789XYZ';
  let w = av.get({ a: 'w', id: ID, k: K, v: '0.6.0', r: '0' });
  ok(w.ok && /^\d{6}$/.test(w.c) && w.st === 'beta' && !w.s, 'premier appel : montre enregistrée, code à 6 chiffres, statut bêta');
  ok(!JSON.stringify(av.sheets.Montres.data).includes(K), 'la clé de la montre n\'est jamais stockée en clair');
  ok(av.get({ a: 'w', id: ID, k: K, v: '0.6.0', r: '0' }).c === w.c, 'le même code tant qu\'il est encore valable');
  ok(av.get({ a: 'w', id: ID, k: 'mauvaiseCle0123456789', r: '0' }).code === 'montre', 'mauvaise clé refusée');
  ok(av.get({ a: 'w', id: 'x', k: K }).code === 'montre', 'identifiant invalide refusé');
  ok(av.post({ action: 'aviator.ouvrir', code: '000000' }).code === 'code', 'code inconnu refusé');
  let o = av.post({ action: 'aviator.ouvrir', code: w.c });
  ok(o.ok && o.jeton && o.reglages.icao === 'ELLX' && o.statut === 'beta', 'le code ouvre les réglages de la montre');
  const reg = Object.assign({}, o.reglages, { icao: 'ellx', rwy: 6, icao2: 'LFSB', icao3: 'LSGS', xwLim: 12, dateFmt: 1 });
  ok(av.post({ action: 'aviator.enregistrer', jeton: o.jeton, reglages: reg }).code === 'accepte', 'enregistrement refusé sans acceptation des conditions');
  ok(av.post({ action: 'aviator.enregistrer', jeton: o.jeton, reglages: Object.assign({}, reg, { icao: 'E;LX' }), accepte: true }).code === 'donnees', 'code OACI invalide refusé');
  ok(av.post({ action: 'aviator.enregistrer', jeton: o.jeton, reglages: Object.assign({}, reg, { rwy: 40 }), accepte: true }).code === 'donnees', 'piste hors limites refusée');
  ok(av.post({ action: 'aviator.enregistrer', jeton: 'faux', reglages: reg, accepte: true }).code === 'session', 'jeton inventé refusé');
  const e = av.post({ action: 'aviator.enregistrer', jeton: o.jeton, reglages: reg, accepte: true });
  ok(e.ok && e.rev === 1 && e.reglages.icao === 'ELLX', 'réglages enregistrés (révision 1)');
  w = av.get({ a: 'w', id: ID, k: K, v: '0.6.0', r: '0' });
  ok(w.rv === 1 && w.s && w.s.icao2 === 'LFSB' && w.s.dateFmt === 1, 'la montre reçoit les nouveaux réglages');
  ok(!av.get({ a: 'w', id: ID, k: K, v: '0.6.0', r: '1' }).s, 'rien n\'est renvoyé si la montre est déjà à jour');
  const ap = av.post({ action: 'aviator.aeroport', icao: 'ellx' });
  ok(ap.ok && ap.trouve && ap.nom && ap.pistes.join() === '6,24', 'aéroport : nom et extrémités de piste');
  ok(av.post({ action: 'aviator.aeroport', icao: 'ZZZZ' }).trouve === false, 'aéroport inconnu signalé');
  const c = av.post({ action: 'aviator.carte' });
  ok(c.ok && c.points.length === 3 && c.points.every((p) => p.t === '1-4' && isFinite(p.lat)), 'carte : 3 aéroports, nombre en tranches');
}

console.log('Aviator METAR : téléphone mémorisé');
{
  const av = charger({ props: { SITE_NOM: 'NiderLabs' } });
  av.run('installer');
  const w = av.get({ a: 'w', id: 'memoWatch01234567', k: 'memoKey0123456789ABCDEF', v: '0.6.8', r: '0' });
  const sans = av.post({ action: 'aviator.ouvrir', code: w.c });
  ok(sans.ok && !sans.memo, 'sans la case : aucun jeton longue durée');
  const o = av.post({ action: 'aviator.ouvrir', code: w.c, garder: true });
  ok(o.ok && /^m[0-9a-f]{64}$/.test(o.memo) && o.memoExp > Date.now() + 29 * 86400000, 'case cochée : jeton mémorisé 30 jours');
  ok(!JSON.stringify(av.props).includes(o.memo), 'le jeton mémorisé n\'est jamais stocké en clair');
  const r = av.post({ action: 'aviator.reprendre', memo: o.memo });
  ok(r.ok && r.jeton && r.reglages.icao === 'ELLX', 'reprise sans code : réglages de la montre');
  ok(av.post({ action: 'aviator.reprendre', memo: 'm' + '0'.repeat(64) }).code === 'memo', 'jeton inventé refusé');
  ok(av.post({ action: 'aviator.reprendre', memo: 'x' }).code === 'memo', 'jeton mal formé refusé');
  const o2 = av.post({ action: 'aviator.ouvrir', code: w.c, garder: true });
  ok(av.post({ action: 'aviator.oublier', memo: o2.memo }).ok && av.post({ action: 'aviator.reprendre', memo: o2.memo }).code === 'memo', 'oublier ce téléphone');
  ok(av.post({ action: 'aviator.reprendre', memo: o.memo }).ok, 'les autres téléphones restent mémorisés');
  ok(av.post({ action: 'aviator.oublier', tous: true, jeton: 'faux' }).code === 'session', 'oublier tous : session requise');
  ok(av.post({ action: 'aviator.oublier', tous: true, jeton: r.jeton }).ok && av.post({ action: 'aviator.reprendre', memo: o.memo }).code === 'memo', 'oublier tous les téléphones');
  const o3 = av.post({ action: 'aviator.ouvrir', code: w.c, garder: true });
  ok(av.post({ action: 'aviator.reprendre', memo: o3.memo }).ok, 'un nouveau téléphone peut être mémorisé ensuite');
}

console.log('Aviator METAR : fuseau horaire des aérodromes');
{
  const av = charger({ props: { SITE_NOM: 'NiderLabs' } });
  av.run('installer');
  const w = av.get({ a: 'w', id: 'tzWatch0123456789', k: 'tzKey0123456789ABCDEF', v: '0.6.9', r: '0', i: 'KJFK,lppd,xx;y,EGLL' });
  ok(w.tz && w.tz.ELLX === av.ctx.tzSecondes_('Europe/Luxembourg', new Date()), 'aérodrome des réglages : décalage du jour');
  ok(w.tz.KJFK === av.ctx.tzSecondes_('America/New_York', new Date()) && w.tz.KJFK < 0, 'KJFK envoyé par la montre : heure de New York');
  ok(w.tz.LPPD === av.ctx.tzSecondes_('Atlantic/Azores', new Date()), 'Açores : fuseau propre (pas celui de Lisbonne)');
  ok(!('XX;Y' in w.tz) && Object.keys(w.tz).length === 4, 'code OACI invalide ignoré');
  const hiver = new Date(Date.UTC(2026, 0, 15)), ete = new Date(Date.UTC(2026, 6, 15));
  ok(av.ctx.tzSecondes_('Europe/Luxembourg', hiver) === 3600 && av.ctx.tzSecondes_('Europe/Luxembourg', ete) === 7200, 'heure d\'été : +1 h en hiver, +2 h en été');
  ok(av.ctx.tzSecondes_('America/Phoenix', hiver) === av.ctx.tzSecondes_('America/Phoenix', ete), 'Phoenix : pas d\'heure d\'été');
  ok(av.ctx.tzZone_('ZZZZ') === null, 'aérodrome inconnu : pas de fuseau');
}

console.log('Aviator METAR Pro');
{
  const av = charger({ props: { SITE_NOM: 'NiderLabs' } });
  av.run('installer');
  const ID = 'proWatch0123456789', K = 'proKey0123456789ABCDEF';
  let w = av.get({ a: 'w', id: ID, k: K, v: 'P0.1.0', r: '0' });
  ok(w.ok && w.p && w.p.tf && w.p.tf.ELLX && w.p.tf.ELLX[0][0] === 'NOW' && /MVFR/.test(w.p.tf.ELLX[0][1]), 'cadran Pro : résumé TAF prêt à afficher');
  ok(!av.get({ a: 'w', id: 'stdWatch0123456789', k: K, v: '0.6.6', r: '0' }).p, 'cadran standard : pas de données Pro');
  const o = av.post({ action: 'aviator.ouvrir', code: w.c });
  let c = av.post({ action: 'pro.charger', jeton: o.jeton });
  ok(c.ok && c.pro.mn.ceil === 1500 && Array.isArray(c.pro.lg), 'Pro : valeurs par défaut');
  const d = (j) => new Date(Date.now() - j * 86400000).toISOString().slice(0, 10);
  const pro = { mn: { ceil: 2000, vis: 5000, wind: 20, xw: 12, gust: 10 }, dt: { sep: d(-200), med: d(-20), lpe: d(10) },
    lg: [{ d: d(10), h: 1.2, pic: true, ldg: 2 }, { d: d(40), h: 1, pic: true, ldg: 1, nl: 1 }, { d: d(100), h: 1, fi: true, pic: false, ldg: 3 }] };
  ok(av.post({ action: 'pro.enregistrer', jeton: o.jeton, pro: Object.assign({}, pro, { dt: { sep: '31/12/2027' } }) }).code === 'donnees', 'Pro : date invalide refusée');
  ok(av.post({ action: 'pro.enregistrer', jeton: o.jeton, pro }).ok, 'Pro : minima, échéances et carnet enregistrés');
  w = av.get({ a: 'w', id: ID, k: K, v: 'P0.1.0', r: '0' });
  const cu = Object.fromEntries(w.p.cu.map((x) => [x[0], x]));
  ok(cu.PAX && /^TO /.test(cu.PAX[1]), 'validité passagers calculée (3 atterrissages en 90 jours)');
  ok(cu.NIGHT && /^TO /.test(cu.NIGHT[1]), 'validité nuit calculée');
  ok(cu.MEDICAL && cu.MEDICAL[2] === 1 && cu.SEP && cu.SEP[2] === 0, 'échéances : alerte à moins de 30 jours');
  ok(w.p.cu.length <= 4, 'au plus 4 lignes pour la montre');
  const b = av.post({ action: 'pro.briefing', jeton: o.jeton });
  ok(b.ok && b.metar.ELLX && b.taf.ELLX && b.apt.ELLX && b.apt.ELLX.rwy.length, 'briefing : METAR, TAF et pistes');
  ok(b.tz && b.tz.ELLX === av.ctx.tzSecondes_('Europe/Luxembourg', new Date()), 'briefing : décalage horaire de chaque aérodrome');
  ok(av.post({ action: 'pro.briefing', jeton: 'faux' }).code === 'session', 'briefing refusé sans session');
}

console.log('Boarding (cadran vol)');
{
  const bo = charger({ props: { SITE_NOM: 'NiderLabs', AERODATABOX_KEY: 'cle-de-test' } });
  bo.run('installer');
  const ID = 'brdWatch0123456789', K = 'brdKey0123456789ABCDEF';
  let w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.1.0', r: '0' });
  ok(w.ok && w.b && Array.isArray(w.b.f) && w.b.f.length === 0 && /^\d{6}$/.test(w.c), 'cadran Boarding : enregistré, aucun vol, code de jumelage');
  ok(w.b.h === bo.ctx.tzSecondes_('Europe/Luxembourg', new Date()) && w.b.hn === 'LUXEMBOURG', 'maison par défaut : Luxembourg');
  const o = bo.post({ action: 'aviator.ouvrir', code: w.c });
  ok(o.ok && o.jeton, 'le code de la montre ouvre la page Boarding');
  const today = new Date().toISOString().slice(0, 10);
  ok(bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'X', d: today } }).code === 'donnees', 'numéro de vol invalide refusé');
  ok(bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'LG8803', d: '2020-01-01' } }).code === 'donnees', 'date passée refusée');
  ok(bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'ZZ999', d: today } }).code === 'introuvable', 'vol inconnu : refusé clairement');
  let r = bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'lg 08803', d: today, s: '14a' } });
  ok(r.ok && r.vol.n === 'LG 8803' && r.vol.o === 'LUX' && r.vol.a === 'LIS' && r.vol.g === 'B32', 'vol ajouté (numéro normalisé, vol opéré et non le partage de code)');
  ok(r.enregistres.length === 1 && r.enregistres[0].n === 'LG8803' && r.enregistres[0].s === '14A', 'siège gardé');
  r = bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'LG8803', d: today, s: '014B' } });
  ok(r.ok && r.enregistres.length === 1 && r.enregistres[0].s === '14A 14B', 'deuxième carte d\'embarquement : siège ajouté au même vol');
  ok(bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'LG8803', d: today, s: 'XYZ' } }).code === 'donnees', 'siège invalide refusé');
  const avant = bo.adbAppels.length;
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.1.0', r: '0' });
  const f = w.b.f[0];
  ok(f && f.n === 'LG 8803' && f.g === 'B32' && f.s === '14A 14B' && f.oz === 3600 && f.az === 0, 'la montre reçoit le vol : porte, siège, décalages horaires');
  ok(f.in && f.in.o === 'MAD' && f.in.st === 'EnRoute', 'avion qui arrive : vol précédent opéré (pas le doublon « Delayed »)');
  const n1 = bo.adbAppels.length;
  bo.get({ a: 'w', id: ID, k: K, v: 'B0.1.0', r: '0' });
  ok(bo.adbAppels.length === n1, 'deuxième appel de la montre : aucune requête AeroDataBox (statut gardé)');
  ok(n1 - avant <= 1, 'le statut du vol n\'est pas redemandé juste après l\'ajout');
  // changement de porte
  const k = 'bv:LG8803:' + today, rec = JSON.parse(bo.props[k]);
  rec.t -= 10000; bo.props[k] = JSON.stringify(rec);
  const bo2 = bo; // même serveur, nouvelle réponse AeroDataBox
  bo2.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => {
    if (/flights\/number\/LG8803/.test(url)) {
      const now = Math.floor(Date.now() / 1000);
      const body = JSON.parse(orig(url, opt).getContentText());
      body.forEach((x) => { x.departure.gate = 'A12'; x.departure.revisedTime = { utc: new Date((now + 7200 + 1500) * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z' }; });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    }
    return orig(url, opt);
  })(bo2.ctx.UrlFetchApp.fetch);
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.1.0', r: '0' });
  ok(w.b.f[0].g === 'A12' && w.b.f[0].gp === 'B32' && w.b.f[0].dl === 25, 'porte changée (ancienne porte signalée) et retard de 25 min');
  ok(bo.pushAppels.length === 0, 'aucune alerte sans abonnement');
  // alertes : abonnement, puis changement de porte annoncé une seule fois
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abcdefghijklmnop', keys: { p256dh: 'B' + 'q'.repeat(86), auth: 'a'.repeat(22) } };
  ok(bo.post({ action: 'boarding.abonner', jeton: o.jeton, sub: { endpoint: 'http://x', keys: {} } }).code === 'donnees', 'abonnement aux alertes invalide refusé');
  r = bo.post({ action: 'boarding.abonner', jeton: o.jeton, sub });
  ok(r.ok && r.alertes === 1 && bo.pushAppels.some((x) => /a=gen/.test(x.url)), 'alertes activées (clés VAPID créées une fois)');
  ok(/Alerts are on/.test(JSON.parse(bo.pushAppels[bo.pushAppels.length - 1].body.payload).body), 'message de confirmation envoyé au téléphone');
  ok(JSON.stringify(bo.props).indexOf('BOARDING_VAPID') >= 0 && !JSON.stringify(bo.post({ action: 'boarding.cle' })).includes('PRIVATE'), 'la clé privée n\'est jamais renvoyée');
  const nPush = bo.pushAppels.length;
  const rec2 = JSON.parse(bo.props[k]); rec2.t -= 10000; rec2.f.g = 'C7'; delete rec2.al.g; bo.props[k] = JSON.stringify(rec2);
  bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.0', r: '0' });
  const env = bo.pushAppels.slice(nPush);
  ok(env.length === 1 && /GATE CHANGED to A12 \(was C7\)/.test(JSON.parse(env[0].body.payload).body), 'changement de porte : une alerte envoyée');
  const rec3 = JSON.parse(bo.props[k]); rec3.t -= 10000; bo.props[k] = JSON.stringify(rec3);
  bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.0', r: '0' });
  ok(bo.pushAppels.length === nPush + 1, 'pas de deuxième alerte pour la même porte ni le même retard');
  // départ de la maison
  ok(bo.post({ action: 'boarding.trajet', jeton: o.jeton, tr: { la: 999, lo: 0 } }).code === 'donnees', 'point de départ invalide refusé');
  ok(bo.post({ action: 'boarding.trajet', jeton: o.jeton, tr: { la: 49.61, lo: 6.13, lab: 'Home', mode: 'car', av: 90 } }).ok, 'point de départ enregistré (voiture)');
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.0', r: '0' });
  const fl = w.b.f[0];
  ok(fl.lv && Math.abs((fl.ed - fl.lv) / 60 - (90 + Math.round(20 * 1.15 + 5))) < 1, 'heure de départ de la maison = départ − 1 h 30 − trajet');
  ok(fl.md === '737-800', 'type d\'avion court pour la montre');
  r = bo.post({ action: 'boarding.trajet', jeton: o.jeton, tr: { la: 40.4, lo: -3.7, lab: 'Madrid', mode: 'car', av: 90 } });
  ok(r.ok && r.vols[0].tw === 'far' && !r.vols[0].lv, 'départ loin de l\'aéroport : raison donnée, pas d\'heure inventée');
  r = bo.post({ action: 'boarding.trajet', jeton: o.jeton, tr: { la: 49.61, lo: 6.13, lab: 'Home', mode: 'min', min: 40, av: 120 } });
  ok(r.ok && r.vols[0].lv === (r.vols[0].ed - 160 * 60) && r.vols[0].tm === 40, 'durée tapée : départ = vol − 2 h − 40 min, renvoyé tout de suite à la page');
  const kk = Object.keys(bo.props).find((x) => /^bv:LG8803/.test(x)), vieux = JSON.parse(bo.props[kk]);
  delete vieux.f.ola; delete vieux.f.olo; vieux.t = Math.floor(Date.now() / 1000); bo.props[kk] = JSON.stringify(vieux);
  r = bo.post({ action: 'boarding.charger', jeton: o.jeton });
  ok(r.vols[0].ola != null && r.vols[0].lv, 'vol enregistré avant la 0.2 : relu une fois pour avoir l\'aéroport');
  ok(bo.post({ action: 'boarding.maison', jeton: o.jeton, tz: 'Pas/Une zone' }).code === 'donnees', 'fuseau maison invalide refusé');
  ok(bo.post({ action: 'boarding.maison', jeton: o.jeton, tz: 'America/New_York' }).ok, 'fuseau maison enregistré');
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.1.0', r: '0' });
  ok(w.b.hn === 'NEW YORK' && w.b.h < 0, 'la montre reçoit l\'heure de la maison');
  const c = bo.post({ action: 'boarding.charger', jeton: o.jeton });
  ok(c.ok && c.vols.length === 1 && c.h === 'America/New_York', 'la page web relit les vols');
  r = bo.post({ action: 'boarding.supprimer', jeton: o.jeton, n: 'LG8803', d: today });
  ok(r.ok && r.enregistres.length === 0, 'vol supprimé');
  ok(bo.post({ action: 'boarding.charger', jeton: 'faux' }).code === 'session', 'Boarding refusé sans session');
  ok(!bo.get({ a: 'w', id: 'stdWatch0123456789', k: K, v: '0.6.6', r: '0' }).b, 'cadran Aviator : pas de données Boarding');
  ok(!JSON.stringify(bo.get({ a: 'vdiag' })).includes('cle-de-test'), 'le diagnostic ne renvoie jamais la clé');
}
{
  // retard probable : l'avion qui arrive se pose trop tard
  global.ADB_INBOUND_LATE = true;
  const bo = charger({ props: { SITE_NOM: 'NiderLabs', AERODATABOX_KEY: 'cle-de-test' } });
  bo.run('installer');
  const ID = 'brdWatch0123456780', K = 'brdKey0123456789ABCDEF';
  const w0 = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.0', r: '0' });
  const o = bo.post({ action: 'aviator.ouvrir', code: w0.c });
  bo.post({ action: 'boarding.ajouter', jeton: o.jeton, vol: { n: 'LG8803', d: new Date().toISOString().slice(0, 10) } });
  const f = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.0', r: '0' }).b.f[0];
  ok(f.ld >= 10 && f.dl === 0, 'avion entrant en retard : « retard probable » (' + f.ld + ' min) avant l\'annonce');
  global.ADB_INBOUND_LATE = false;
}

console.log('Boarding : comptes par e-mail, montres liées, rappels');
{
  const bo = charger({ props: { SITE_NOM: 'NiderLabs', AERODATABOX_KEY: 'cle-de-test' } });
  bo.run('installer');
  const today = new Date().toISOString().slice(0, 10);
  const E = 'Passager@Example.com', e = 'passager@example.com';
  ok(bo.post({ action: 'boarding.code', email: 'pas-une-adresse' }).code === 'email', 'adresse invalide refusée');
  ok(bo.post({ action: 'boarding.code', email: E }).ok && /^\d{6}$/.test(bo.lastCode(e)), 'code envoyé par e-mail (adresse normalisée)');
  ok(!JSON.stringify(bo.cache).includes(bo.lastCode(e)), 'le code n\'est gardé qu\'en empreinte');
  ok(bo.post({ action: 'boarding.entrer', email: E, code: '000000' }).code === 'code', 'mauvais code refusé');
  let s = bo.post({ action: 'boarding.entrer', email: E, code: bo.lastCode(e), garder: true });
  ok(s.ok && s.jeton && s.nouveau === true && s.email === e && /^m[0-9a-f]{64}$/.test(s.memo), 'compte créé à la première connexion, téléphone mémorisé');
  ok(bo.post({ action: 'boarding.entrer', email: E, code: bo.lastCode(e) }).code === 'code', 'un code ne sert qu\'une fois');
  bo.post({ action: 'boarding.code', email: e });
  const s2 = bo.post({ action: 'boarding.entrer', email: e, code: bo.lastCode(e) });
  ok(s2.ok && s2.nouveau === false, 'deuxième connexion : même compte');
  const lignes = bo.ctx.lire_('Comptes');
  ok(lignes.length === 1 && lignes[0].Email === e, 'une seule ligne par adresse');
  let c = bo.post({ action: 'boarding.charger', jeton: s.jeton });
  ok(c.ok && c.compte && c.compte.email === e && c.compte.montres.length === 0 && c.vols.length === 0, 'compte vide chargé');
  let r = bo.post({ action: 'boarding.ajouter', jeton: s.jeton, vol: { n: 'LG8803', d: today, s: '14A', bp: true } });
  ok(r.ok && r.enregistres[0].bp === 1, 'vol ajouté au compte (carte d\'embarquement scannée notée)');
  // montre seule avec son propre vol, puis liée au compte
  const ID = 'brdWatchLink012345', K = 'brdKey0123456789ABCDEF';
  let w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.1', r: '0' });
  const om = bo.post({ action: 'aviator.ouvrir', code: w.c });
  bo.post({ action: 'boarding.ajouter', jeton: om.jeton, vol: { n: 'LG8803', d: today, s: '14B' } });
  ok(bo.post({ action: 'boarding.lier', jeton: om.jeton, code: w.c }).code === 'session', 'lier une montre demande la connexion par e-mail');
  ok(bo.post({ action: 'boarding.lier', jeton: s.jeton, code: '123' }).code === 'code', 'code de montre invalide refusé');
  r = bo.post({ action: 'boarding.lier', jeton: s.jeton, code: w.c });
  ok(r.ok && r.montres.length === 1 && r.montres[0].fin === '2345' && !JSON.stringify(r).includes(ID), 'montre liée (identifiant jamais renvoyé)');
  ok(r.enregistres.length === 1 && r.enregistres[0].s === '14A 14B', 'vols de la montre fusionnés dans le compte');
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.1', r: '0' });
  ok(w.b.f.length === 1 && w.b.f[0].s === '14A 14B', 'la montre affiche les vols du compte');
  c = bo.post({ action: 'boarding.charger', jeton: om.jeton });
  ok(c.ok && c.montre === true && c.vols.length === 1 && !c.compte, 'le code de la montre ouvre les vols du compte, sans les réglages du compte');
  // un autre compte ne voit rien
  bo.post({ action: 'boarding.code', email: 'autre@example.com' });
  const s3 = bo.post({ action: 'boarding.entrer', email: 'autre@example.com', code: bo.lastCode('autre@example.com') });
  ok(bo.post({ action: 'boarding.charger', jeton: s3.jeton }).vols.length === 0, 'comptes séparés');
  ok(bo.post({ action: 'boarding.delier', jeton: s3.jeton, ref: r.montres[0].ref }).code === 'introuvable', 'on ne délie pas la montre d\'un autre');
  // reprise par « Remember this phone »
  const rp = bo.post({ action: 'boarding.reprendre', memo: s.memo });
  ok(rp.ok && rp.email === e && bo.post({ action: 'boarding.charger', jeton: rp.jeton }).ok, 'téléphone mémorisé : session reprise');
  // rappels : « Check in online » la veille, « Leave in 30 min »
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/compte123456789', keys: { p256dh: 'B' + 'q'.repeat(86), auth: 'a'.repeat(22) } };
  bo.post({ action: 'boarding.abonner', jeton: s.jeton, sub });
  const k = 'bv:LG8803:' + today, now = Math.floor(Date.now() / 1000);
  const decale = (dep) => { const x = JSON.parse(bo.props[k]); const dt = dep - (x.f.ed || x.f.sd); ['sd', 'ed', 'sa', 'ea'].forEach((z) => { if (x.f[z]) x.f[z] += dt; }); x.t = now; bo.props[k] = JSON.stringify(x); };
  const tick = () => { delete bo.cache.btick; return bo.get({ a: 'tick' }); };
  decale(now + 20 * 3600);
  let n0 = bo.pushAppels.length, t = tick();
  ok(t.ok && bo.pushAppels.length === n0, 'pas de rappel d\'enregistrement quand la carte d\'embarquement est scannée');
  ok(bo.get({ a: 'tick' }).attente === true, 'deux passages rapprochés : le second est ignoré');
  const u = JSON.parse(bo.ctx.lire_('Comptes')[0].Vols); u.v[0].bp = 0; bo.ctx.majLigne_('Comptes', () => true, { Vols: JSON.stringify(u) });
  ok(bo.post({ action: 'boarding.charger', jeton: s.jeton }).vols[0].ci === 1, 'page et montre : « CHECK IN ONLINE » la veille');
  n0 = bo.pushAppels.length; tick();
  const env = bo.pushAppels.slice(n0).map((x) => JSON.parse(x.body.payload));
  ok(env.length === 1 && /Check in online/.test(env[0].title) && /LG 8803/.test(env[0].title), 'rappel « Check in online » envoyé la veille');
  n0 = bo.pushAppels.length; tick();
  ok(bo.pushAppels.length === n0, 'rappel d\'enregistrement envoyé une seule fois');
  bo.post({ action: 'boarding.trajet', jeton: s.jeton, tr: { la: 49.61, lo: 6.13, lab: 'Home', mode: 'min', min: 40, av: 120 } });
  decale(now + (160 + 25) * 60);
  n0 = bo.pushAppels.length; tick();
  const env2 = bo.pushAppels.slice(n0).map((x) => JSON.parse(x.body.payload));
  ok(env2.length === 1 && /^Leave in 2[45] min/.test(env2[0].title), 'rappel « Leave in 25 min » (' + (env2[0] && env2[0].title) + ')');
  n0 = bo.pushAppels.length; tick();
  ok(bo.pushAppels.length === n0, 'rappel de départ envoyé une seule fois');
  // délier, puis supprimer le compte
  r = bo.post({ action: 'boarding.delier', jeton: s.jeton, ref: r.montres[0].ref });
  ok(r.ok && r.montres.length === 0, 'montre déliée');
  ok(bo.post({ action: 'boarding.effacer', jeton: s.jeton }).code === 'donnees', 'suppression du compte : confirmation demandée');
  ok(bo.post({ action: 'boarding.effacer', jeton: s.jeton, confirme: true }).ok, 'compte supprimé');
  ok(bo.post({ action: 'boarding.charger', jeton: s.jeton }).code === 'session' && bo.post({ action: 'boarding.reprendre', memo: s.memo }).code === 'memo', 'après suppression : session et téléphone mémorisé refusés');
  ok(!bo.ctx.lire_('Comptes').some((x) => x.Email === e), 'adresse e-mail effacée');
}

console.log('Boarding : avion, prévision à l\'arrivée, partage du vol');
{
  const bo = charger({ props: { SITE_NOM: 'NiderLabs', AERODATABOX_KEY: 'cle-de-test' } });
  bo.run('installer');
  const today = new Date().toISOString().slice(0, 10);
  bo.post({ action: 'boarding.code', email: 'av@example.com' });
  const s = bo.post({ action: 'boarding.entrer', email: 'av@example.com', code: bo.lastCode('av@example.com') });
  bo.post({ action: 'boarding.ajouter', jeton: s.jeton, vol: { n: 'LG8803', d: today, s: '14A' } });
  let c = bo.post({ action: 'boarding.charger', jeton: s.jeton });
  const v = c.vols[0];
  ok(v.avion && v.avion.rg === 'LX-LGU' && v.avion.age === 6.2 && v.avion.se === 186 && v.avion.ph && v.avion.ph.by === 'A. Spotter', 'page : immatriculation, âge, sièges et photo créditée');
  ok(v.fc && v.fc.t === 14 && v.fc.p === 30 && v.fc.w === 'Rain' && v.fc.v === 18, 'page : prévision à l\'heure d\'arrivée');
  const n1 = bo.adbAppels.filter((u) => /aircrafts/.test(u)).length;
  bo.post({ action: 'boarding.charger', jeton: s.jeton });
  ok(bo.adbAppels.filter((u) => /aircrafts/.test(u)).length === n1 && n1 === 1, 'fiche avion demandée une seule fois');
  const ID = 'brdWatchAvion01234', K = 'brdKey0123456789ABCDEF';
  let w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.3', r: '0' });
  const om = bo.post({ action: 'aviator.ouvrir', code: w.c });
  bo.post({ action: 'boarding.ajouter', jeton: om.jeton, vol: { n: 'LG8803', d: today } });
  w = bo.get({ a: 'w', id: ID, k: K, v: 'B0.2.3', r: '0' });
  ok(w.b.f.length && !w.b.f[0].avion && !w.b.f[0].fc, 'montre : ni photo ni prévision (données légères)');
  ok(bo.post({ action: 'boarding.partager', jeton: s.jeton, n: 'LG9999', d: today }).code === 'introuvable', 'partage : seulement ses propres vols');
  const sh = bo.post({ action: 'boarding.partager', jeton: s.jeton, n: 'LG8803', d: today });
  ok(sh.ok && /^[0-9a-f]{16}$/.test(sh.s), 'lien de partage créé');
  ok(bo.post({ action: 'boarding.partager', jeton: s.jeton, n: 'LG 8803', d: today }).s === sh.s, 'même lien si on partage à nouveau');
  const vu = bo.post({ action: 'boarding.voir', s: sh.s });
  ok(vu.ok && vu.vol.a === 'LIS' && vu.vol.ea && vu.vol.fc, 'lien public : arrivée, retard, prévision');
  ok(!('s' in vu.vol) && !JSON.stringify(vu).includes('14A') && !JSON.stringify(vu).includes('av@example.com') && !vu.vol.g, 'lien public : ni siège, ni e-mail, ni porte');
  ok(bo.post({ action: 'boarding.voir', s: 'zz' }).code === 'lien' && bo.post({ action: 'boarding.voir', s: '0123456789abcdef' }).code === 'lien', 'lien inconnu refusé');
  const k = 'shr:' + sh.s, x = JSON.parse(bo.props[k]); x.exp = 1; bo.props[k] = JSON.stringify(x);
  ok(bo.post({ action: 'boarding.voir', s: sh.s }).code === 'lien', 'lien expiré refusé');
  bo.run('nettoyerSessions');
  ok(!(k in bo.props), 'liens expirés effacés au nettoyage');
}

console.log('\n' + n + ' vérifications réussies.');
