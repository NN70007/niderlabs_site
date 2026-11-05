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

console.log('\n' + n + ' vérifications réussies.');
