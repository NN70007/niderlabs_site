/**
 * Espace d'administration — serveur (Google Apps Script)
 * ------------------------------------------------------
 * Ce script est rattaché à une feuille Google Sheets PRIVÉE « <Nom du site> – Base (privée) »
 * (compte jb@niedercorn.com, partagée avec personne). Il est le seul point d'accès aux données :
 * chaque demande doit porter une session valide, obtenue soit par connexion Google (jeton vérifié
 * auprès de Google), soit par un code envoyé par e-mail.
 *
 * Ce fichier ne contient AUCUNE donnée ni AUCUNE clé : il peut être publié sans risque et sert tel quel
 * à plusieurs sites. Ce qui change d'un site à l'autre est rangé dans les Propriétés du script :
 *   SITE_NOM          nom du site (e-mails, sauvegardes)            ex. NiderLabs
 *   GITHUB_REPO       dépôt du site                                ex. NN70007/niderlabs_site
 *   GITHUB_TOKEN      jeton GitHub « fine-grained » limité à ce dépôt (Contents : lecture et écriture)
 *   GOOGLE_CLIENT_ID  identifiant OAuth du bouton « Se connecter avec Google » (facultatif)
 *
 * Où vivent les données :
 *   - onglet Acces   : qui peut entrer et avec quels droits (admin, actualites) ;
 *   - onglet Journal : connexions, refus, changements de droits, publications ;
 *   - sessions       : Propriétés du script, clé « s:<empreinte du jeton> » (le jeton n'est jamais stocké en clair) ;
 *   - codes e-mail   : cache du script, empreinte seulement, 10 minutes.
 *
 * Installation : voir INSTALLATION.md à la racine du dépôt.
 */

/* ======================= Réglages ======================= */
var CONFIG = {
  VERSION: '2026-11-04-aviator2',
  // Adresses qui reçoivent tous les droits au premier lancement de « installer ».
  ADMINS_INITIAUX: ['jb@niedercorn.com'],
  NOM_ADMIN_INITIAL: 'Jean-Baptiste Niedercorn',
  NOM_SITE_DEFAUT: 'Nouveau site',
  FUSEAU: 'Europe/Luxembourg',
  SESSION_JOURS: 30,
  CODE_MINUTES: 10,
  CODE_ESSAIS_MAX: 5,
  CODES_PAR_HEURE_PAR_ADRESSE: 5,
  CODES_PAR_HEURE_TOTAL: 60,
  JOURNAL_AFFICHE: 60,
  SAUV_JOURS: 30,
  // Publication
  ARTICLES_MAX: 1000,
  IMAGE_MAX_OCTETS: 6 * 1024 * 1024,
  // Aviator METAR (montres)
  MONTRE_CODE_MINUTES: 15,
  MONTRE_SESSION_MINUTES: 120,
  MONTRE_ESSAIS_PAR_MINUTE: 30,
  CARTE_JOURS: 30
};

var ONGLETS = {
  Acces: ['Email', 'Nom', 'Admin', 'Actualites', 'Actif', 'Note'],
  Journal: ['Date', 'Qui', 'Action', 'Detail'],
  Montres: ['Id', 'Cle', 'Statut', 'Reglages', 'Rev', 'Version', 'Cree', 'Vu', 'Accepte', 'Carte'],
  Aeroports: ['Icao', 'Lat', 'Lon', 'Nom', 'Maj']
};

/* ======================= Points d'entrée ======================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.a === 'w') {
    try { return json_(montreAppel_(p)); }
    catch (err) {
      if (err && err.public) return json_({ ok: false, error: err.message, code: err.code || 'refus' });
      console.error(err && err.stack || err);
      return json_({ ok: false, code: 'serveur' });
    }
  }
  return json_({ ok: true, version: CONFIG.VERSION });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Requête illisible.', code: 'requete' }); }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return json_({ ok: false, error: 'Requête illisible.', code: 'requete' });
  try {
    return json_(route_(req));
  } catch (err) {
    if (err && err.public) return json_({ ok: false, error: err.message, code: err.code || 'refus' });
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Erreur du serveur. Réessayez dans un instant.', code: 'serveur' });
  }
}

function route_(req) {
  var a = String(req.action || '');
  // Actions sans session
  if (a === 'auth.google') return authGoogle_(req.idToken);
  if (a === 'auth.demanderCode') return demanderCode_(req.email);
  if (a === 'auth.verifierCode') return verifierCode_(req.email, req.code);
  // Aviator METAR : page publique niderlabs.com/aviator (pas de compte, code affiché sur la montre)
  if (a === 'aviator.ouvrir') return aviatorOuvrir_(req.code);
  if (a === 'aviator.enregistrer') return aviatorEnregistrer_(req.jeton, req.reglages, req.accepte);
  if (a === 'aviator.carte') return aviatorCarte_();
  if (a === 'aviator.aeroport') return aviatorAeroport_(req.icao);

  // Actions avec session : l'utilisateur est relu dans l'onglet Acces à CHAQUE demande
  var user = userFromToken_(req.token);
  switch (a) {
    case 'auth.deconnexion': return deconnexion_(req.token);
    case 'moi': return { ok: true, user: publicUser_(user) };
    case 'acces.lister': return accesLister_(user);
    case 'acces.enregistrer': return accesEnregistrer_(user, req.personne, req.emailOriginal);
    case 'acces.supprimer': return accesSupprimer_(user, req.email);
    case 'acces.deconnecter': return accesDeconnecter_(user, req.email);
    case 'pub.github': return pubGithub_(user, req.methode, req.chemin, req.corps);
    default: throw refus_('Action inconnue.', 'inconnu');
  }
}

/* ======================= Installation et entretien ======================= */
/** À lancer une fois depuis l'éditeur (et sans risque ensuite : rien n'est dupliqué). */
function installer() {
  var ss = classeur_(true);
  Object.keys(ONGLETS).forEach(function (nom) {
    var sh = ss.getSheetByName(nom) || ss.insertSheet(nom);
    var head = ONGLETS[nom];
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    // Tout en texte : pas de conversion automatique de dates ou de nombres par Sheets
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), head.length).setNumberFormat('@');
  });
  var acc = lire_('Acces');
  var dejaLa = acc.some(function (r) { return emails_(r.Email).some(function (x) { return CONFIG.ADMINS_INITIAUX.map(norm_).indexOf(x) > -1; }); });
  if (!dejaLa) {
    ajouter_('Acces', { Email: CONFIG.ADMINS_INITIAUX.map(norm_).join('; '), Nom: CONFIG.NOM_ADMIN_INITIAL, Admin: 'oui', Actualites: 'oui', Actif: 'oui', Note: 'Administrateur initial' });
  }
  journal_('installation', 'installation', 'Onglets vérifiés (version ' + CONFIG.VERSION + ')');
  MailApp.getRemainingDailyQuota(); // fait demander l'autorisation d'envoyer des e-mails dès l'installation
  var msg = 'Installation terminée. Feuille : ' + ss.getUrl();
  console.log(msg);
  return msg;
}

/** Supprime les sessions expirées (appelé à chaque connexion ; déclencheur nocturne facultatif). */
function nettoyerSessions() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties(), now = Date.now(), n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('s:') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) { props.deleteProperty(k); n++; } } catch (e) { props.deleteProperty(k); n++; }
  });
  return n + ' session(s) supprimée(s)';
}

/* Déclencheur quotidien (Déclencheurs › Ajouter › sauvegarderEspace › tous les jours, 2 h - 3 h) :
   copie Excel de la feuille privée dans le dossier Drive « Sauvegardes – <Nom du site> », SAUV_JOURS jours conservés.
   Les propriétés du script (clés, sessions) ne sont jamais sauvegardées. En cas d'échec, un e-mail prévient le propriétaire. */
function sauvegarderEspace() {
  var nomSite = nomSite_();
  var prefixe = nomSite + ' - Base - ';
  try {
    var ss = classeur_(false), dossier = dossierSauvegardes_();
    var jour = Utilities.formatDate(new Date(), CONFIG.FUSEAU, 'yyyy-MM-dd');
    var res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('export refusé (code ' + res.getResponseCode() + ')');
    var nom = prefixe + jour + '.xlsx';
    var memes = dossier.getFilesByName(nom); // une seule copie par jour
    while (memes.hasNext()) memes.next().setTrashed(true);
    var blob = res.getBlob().setName(nom);
    if (!blob.getBytes().length) throw new Error('fichier exporté vide');
    dossier.createFile(blob);
    var limite = Date.now() - CONFIG.SAUV_JOURS * 86400000, it = dossier.getFiles(), retirees = 0;
    while (it.hasNext()) {
      var f = it.next(), n = f.getName();
      if (n.indexOf(prefixe) === 0 && /\d{4}-\d{2}-\d{2}\.xlsx$/.test(n) && f.getDateCreated().getTime() < limite) { f.setTrashed(true); retirees++; }
    }
    PropertiesService.getScriptProperties().setProperty('SAUV_DERNIERE', jour);
    return 'Sauvegarde ' + nom + ' enregistrée (' + retirees + ' ancienne(s) retirée(s)) : ' + dossier.getUrl();
  } catch (e) {
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), nomSite + ' : échec de la sauvegarde',
        'La sauvegarde quotidienne de la feuille privée a échoué : ' + (e && e.message || e) + '\n\nDernière sauvegarde réussie : ' + (prop_('SAUV_DERNIERE') || 'aucune') + '.');
    } catch (x) { /* rien d'autre à faire */ }
    throw e;
  }
}
function dossierSauvegardes_() {
  var id = prop_('SAUV_DOSSIER_ID');
  if (id) { try { var d0 = DriveApp.getFolderById(id); if (!d0.isTrashed()) return d0; } catch (e) { /* dossier supprimé : on le recrée */ } }
  var d = DriveApp.createFolder('Sauvegardes – ' + nomSite_());
  PropertiesService.getScriptProperties().setProperty('SAUV_DOSSIER_ID', d.getId());
  return d;
}

/* ======================= Authentification ======================= */
function authGoogle_(idToken) {
  var clientId = prop_('GOOGLE_CLIENT_ID');
  if (!clientId) throw refus_("La connexion Google n'est pas configurée sur ce site. Utilisez le code par e-mail.", 'config');
  if (!idToken || typeof idToken !== 'string' || idToken.length > 5000) throw refus_('Connexion Google invalide.', 'auth');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw refus_('Connexion Google refusée. Réessayez.', 'auth');
  var info = JSON.parse(res.getContentText());
  var okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  var okVerified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== clientId || !okIss || !okVerified || Number(info.exp) * 1000 < Date.now()) {
    throw refus_('Connexion Google refusée. Réessayez.', 'auth');
  }
  var row = accesPour_(info.email);
  if (!row) {
    journal_(norm_(info.email), 'refus', 'Connexion Google sans autorisation');
    throw refus_("Votre compte n'est pas autorisé. Demandez l'accès à l'administrateur du site.", 'non_autorise');
  }
  return ouvrirSession_(row, 'google', info.email);
}

function demanderCode_(email) {
  email = norm_(email);
  // Même réponse que l'adresse soit connue ou non : on ne révèle pas qui a un accès
  var neutre = { ok: true, message: "Si cette adresse est autorisée, un code vient d'y être envoyé." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw refus_('Adresse e-mail invalide.', 'email');
  var cache = CacheService.getScriptCache();
  var nAdr = Number(cache.get('otpn:' + email) || 0), nTot = Number(cache.get('otpn:*') || 0);
  if (nAdr >= CONFIG.CODES_PAR_HEURE_PAR_ADRESSE || nTot >= CONFIG.CODES_PAR_HEURE_TOTAL) throw refus_('Trop de demandes. Réessayez dans une heure.', 'limite');
  cache.put('otpn:' + email, String(nAdr + 1), 3600);
  cache.put('otpn:*', String(nTot + 1), 3600);
  var row = accesPour_(email);
  if (!row) { journal_(email, 'refus', 'Code demandé sans autorisation'); return neutre; }
  // Code tiré d'un UUID (générateur aléatoire sûr de Google) plutôt que de Math.random
  var code = String(100000 + parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000);
  cache.put('otp:' + email, JSON.stringify({ h: hash_(code + '|' + email), essais: 0 }), CONFIG.CODE_MINUTES * 60);
  var prenom = String(row.Nom || '').split(' ')[0];
  var site = nomSite_();
  var corps = 'Bonjour' + (prenom ? ' ' + prenom : '') + ',\n\nVoici votre code de connexion à l’espace d’administration de ' + site + ' : ' + code +
    '\n\nCe code est valable ' + CONFIG.CODE_MINUTES + ' minutes. Si vous n’avez rien demandé, ignorez ce message.\n\n' + site;
  MailApp.sendEmail({ to: email, subject: 'Votre code de connexion : ' + code, body: corps, name: site });
  return neutre;
}

function verifierCode_(email, code) {
  email = norm_(email);
  code = String(code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache();
  // Lecture, comptage des essais et consommation du code sous verrou : des essais simultanés ne dépassent pas la limite
  verrou_(function () {
    var raw = cache.get('otp:' + email);
    if (!raw) throw refus_('Code expiré ou inconnu. Demandez un nouveau code.', 'code');
    var o = JSON.parse(raw);
    if (o.essais >= CONFIG.CODE_ESSAIS_MAX) { cache.remove('otp:' + email); throw refus_('Trop d’essais. Demandez un nouveau code.', 'code'); }
    if (hash_(code + '|' + email) !== o.h) {
      o.essais++;
      cache.put('otp:' + email, JSON.stringify(o), CONFIG.CODE_MINUTES * 60);
      throw refus_('Code incorrect.', 'code');
    }
    cache.remove('otp:' + email);
  });
  var row = accesPour_(email);
  if (!row) throw refus_("Votre compte n'est pas autorisé.", 'non_autorise');
  return ouvrirSession_(row, 'code', email);
}

function ouvrirSession_(row, via, loginEmail) {
  try { nettoyerSessions(); } catch (e) { /* sans gravité */ }
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var exp = Date.now() + CONFIG.SESSION_JOURS * 86400000;
  loginEmail = norm_(loginEmail);
  PropertiesService.getScriptProperties().setProperty('s:' + hash_(token), JSON.stringify({ email: loginEmail, exp: exp }));
  journal_(loginEmail, 'connexion', via);
  return { ok: true, token: token, expire: exp, user: publicUser_(userFromRow_(row, loginEmail)) };
}

function deconnexion_(token) {
  PropertiesService.getScriptProperties().deleteProperty('s:' + hash_(String(token || '')));
  return { ok: true };
}

function userFromToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 200) throw refus_('Session expirée. Reconnectez-vous.', 'session');
  var props = PropertiesService.getScriptProperties();
  var key = 's:' + hash_(token), raw = props.getProperty(key);
  if (!raw) throw refus_('Session expirée. Reconnectez-vous.', 'session');
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { props.deleteProperty(key); throw refus_('Session expirée. Reconnectez-vous.', 'session'); }
  var row = accesPour_(s.email);
  if (!row) { props.deleteProperty(key); throw refus_('Votre accès a été retiré.', 'session'); }
  return userFromRow_(row, s.email);
}

/* ======================= Droits ======================= */
function accesPour_(email) {
  email = norm_(email);
  if (!email) return null;
  var rows = lire_('Acces');
  for (var i = 0; i < rows.length; i++) {
    if (emails_(rows[i].Email).indexOf(email) > -1 && oui_(rows[i].Actif)) return rows[i];
  }
  return null;
}
function emails_(v) {
  var out = [];
  String(v || '').split(/[;,\s]+/).forEach(function (e) { e = norm_(e); if (e && out.indexOf(e) < 0) out.push(e); });
  return out;
}
function cle_(r) { return emails_(r.Email)[0] || ''; }

function userFromRow_(r, loginEmail) {
  var ems = emails_(r.Email), admin = oui_(r.Admin);
  return {
    email: norm_(loginEmail) || ems[0] || '',
    emails: ems,
    cle: ems[0] || '',
    nom: String(r.Nom || ems[0] || ''),
    admin: admin,
    actualites: admin || oui_(r.Actualites)
  };
}
function publicUser_(u) {
  return { email: u.email, emails: u.emails, nom: u.nom, admin: u.admin, actualites: u.actualites };
}
function exigerAdmin_(u) { if (!u.admin) throw refus_("Vous n'avez pas les droits pour gérer les accès.", 'droits'); }

/* ======================= Accès ======================= */
function accesLister_(u) {
  exigerAdmin_(u);
  var personnes = lire_('Acces').map(function (r) {
    var x = userFromRow_(r); delete x.email;
    x.actualites = oui_(r.Actualites); // valeur cochée, indépendamment du droit admin
    x.actif = oui_(r.Actif); x.note = String(r.Note || '');
    return x;
  });
  var journal = lire_('Journal').slice(-CONFIG.JOURNAL_AFFICHE).reverse().map(function (r) {
    return { ts: Number(r.Date) || 0, qui: r.Qui, action: r.Action, detail: r.Detail };
  });
  return { ok: true, personnes: personnes, journal: journal };
}

function accesEnregistrer_(u, p, cleOriginale) {
  exigerAdmin_(u);
  if (!p || typeof p !== 'object') throw refus_('Données invalides.', 'donnees');
  var ems = emails_(p.email);
  if (!ems.length) throw refus_('Indiquez au moins une adresse e-mail.', 'donnees');
  ems.forEach(function (e) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw refus_('Adresse e-mail invalide : ' + e, 'donnees'); });
  if (ems.length > 5) throw refus_('Cinq adresses au maximum par personne.', 'donnees');
  var orig = norm_(cleOriginale);
  var ligne = {
    Email: ems.join('; '), Nom: texte_(p.nom, 80) || ems[0],
    Admin: p.admin === true ? 'oui' : '', Actualites: p.actualites === true ? 'oui' : '',
    Actif: p.actif === false ? 'non' : 'oui', Note: texte_(p.note, 200)
  };
  return verrou_(function () {
    var rows = lire_('Acces');
    var cible = orig ? rows.filter(function (r) { return cle_(r) === orig; })[0] : null;
    if (orig && !cible) throw refus_('Cette personne n’existe plus dans la liste.', 'introuvable');
    if (cible && emails_(cible.Email).indexOf(u.email) > -1 && (!ligne.Admin || ligne.Actif !== 'oui' || ems.indexOf(u.email) < 0)) {
      throw refus_('Vous ne pouvez pas retirer vos propres droits d’administration, ni l’adresse avec laquelle vous êtes connecté.', 'droits');
    }
    var doublon = rows.filter(function (r) { return r !== cible && emails_(r.Email).some(function (e) { return ems.indexOf(e) > -1; }); })[0];
    if (doublon) throw refus_('Une de ces adresses est déjà attribuée à ' + (doublon.Nom || cle_(doublon)) + '.', 'donnees');
    if (cible) majLigne_('Acces', function (r) { return cle_(r) === orig; }, ligne);
    else ajouter_('Acces', ligne);
    journal_(u.email, cible ? 'acces.modifie' : 'acces.ajoute', resumeDroits_(ligne));
    return { ok: true };
  });
}

function accesSupprimer_(u, cle) {
  exigerAdmin_(u);
  cle = norm_(cle);
  return verrou_(function () {
    var cible = lire_('Acces').filter(function (r) { return cle_(r) === cle; })[0];
    if (!cible) return { ok: true };
    if (emails_(cible.Email).indexOf(u.email) > -1) throw refus_('Vous ne pouvez pas supprimer votre propre accès.', 'droits');
    supprimerLignes_('Acces', function (r) { return cle_(r) === cle; });
    fermerSessions_(emails_(cible.Email));
    journal_(u.email, 'acces.supprime', cible.Email);
    return { ok: true };
  });
}

function accesDeconnecter_(u, cle) {
  exigerAdmin_(u);
  cle = norm_(cle);
  var cible = lire_('Acces').filter(function (r) { return cle_(r) === cle; })[0];
  if (!cible) throw refus_('Personne introuvable.', 'introuvable');
  var ems = emails_(cible.Email);
  var n = fermerSessions_(ems);
  journal_(u.email, 'acces.deconnecte', cible.Email + ' — ' + n + ' session(s) fermée(s)');
  return { ok: true, fermees: n, vous: ems.indexOf(u.email) > -1 };
}
function fermerSessions_(ems) {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('s:') !== 0) return;
    try { if (ems.indexOf(JSON.parse(all[k]).email) > -1) { props.deleteProperty(k); n++; } } catch (e) { /* ignorée */ }
  });
  return n;
}
function resumeDroits_(l) {
  var d = [];
  if (l.Admin) d.push('admin');
  if (l.Actualites) d.push('actualités');
  return l.Email + ' — ' + (d.join(', ') || 'aucun droit') + (l.Actif !== 'oui' ? ' (désactivé)' : '');
}
function journal_(qui, action, detail) { ajouter_('Journal', { Date: String(Date.now()), Qui: qui, Action: action, Detail: texte_(detail, 500) }); }

/* ======================= Publication sur le site (API GitHub) ======================= */
/* Seuls fichiers accessibles : actualites.json et des images dans assets/.
   Le jeton GitHub reste dans les Propriétés du script, jamais dans le navigateur. */
var FICHIER_ACTUS = 'actualites.json';
var ASSET_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(jpe?g|png|webp|gif)$/i;

function pubGithub_(u, methode, chemin, corps) {
  if (!u.actualites) throw refus_("Vous n'avez pas accès à la publication des actualités.", 'droits');
  methode = String(methode || 'GET').toUpperCase();
  if (methode !== 'GET' && methode !== 'PUT') throw refus_('Opération non autorisée.', 'droits');
  chemin = String(chemin || '').split('?')[0].replace(/^\/+/, '');
  if (chemin.indexOf('..') > -1 || chemin.indexOf('\\') > -1) throw refus_('Fichier non autorisé.', 'droits');
  var estActus = chemin === FICHIER_ACTUS, estImage = ASSET_RE.test(chemin);
  if (!estActus && !estImage) throw refus_('Fichier non autorisé : ' + texte_(chemin, 120), 'droits');

  var token = prop_('GITHUB_TOKEN');
  var repo = prop_('GITHUB_REPO');
  if (!token || !repo) throw refus_("La publication n'est pas encore configurée (GITHUB_TOKEN ou GITHUB_REPO manquant dans les Propriétés du script).", 'config');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw refus_('Propriété GITHUB_REPO invalide (format attendu : compte/depot).', 'config');
  var url = 'https://api.github.com/repos/' + repo + '/contents/' + chemin.split('/').map(encodeURIComponent).join('/');
  var opts = {
    method: methode.toLowerCase(), muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'socle-espace-admin' }
  };
  var detail = '';
  if (methode === 'PUT') {
    if (!corps || typeof corps !== 'object' || typeof corps.content !== 'string') throw refus_('Contenu manquant.', 'donnees');
    var contenu = corps.content.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(contenu) || !contenu.length) throw refus_('Contenu illisible.', 'donnees');
    if (estActus) verifierActualites_(contenu);
    else verifierImage_(contenu);
    var message = (texte_(corps.message, 160) || ('Mise à jour ' + chemin)) + ' — par ' + u.nom;
    var payload = { message: message, content: contenu };
    if (corps.sha) payload.sha = texte_(corps.sha, 64);
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
    detail = chemin + ' — ' + message;
  }
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode(), txtRes = res.getContentText(), data;
  try { data = JSON.parse(txtRes); } catch (e) { data = { message: String(txtRes).slice(0, 300) }; }
  if (methode === 'PUT') journal_(u.email, code < 300 ? 'publication' : 'publication.echec', detail + (code < 300 ? '' : ' (' + code + ')'));
  // Seuls les champs utiles repartent vers le navigateur
  var out = { sha: data && data.sha || (data && data.content && data.content.sha) || '', message: code < 300 ? '' : String(data && data.message || '') };
  if (methode === 'GET' && code === 200) out.content = String(data.content || '');
  return { ok: true, status: code, data: out };
}

/** actualites.json : tableau d'articles { id, titre, date AAAA-MM-JJ, texte, image facultative assets/… }. */
function verifierActualites_(b64) {
  var liste;
  try { liste = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8')); }
  catch (e) { throw refus_('Le contenu envoyé n’est pas un fichier JSON valide : publication refusée.', 'donnees'); }
  if (!Array.isArray(liste)) throw refus_('actualites.json doit contenir une liste d’articles.', 'donnees');
  if (liste.length > CONFIG.ARTICLES_MAX) throw refus_('Trop d’articles.', 'donnees');
  var ids = {};
  liste.forEach(function (a, i) {
    var n = 'Article ' + (i + 1) + ' : ';
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw refus_(n + 'format invalide.', 'donnees');
    Object.keys(a).forEach(function (k) { if (['id', 'titre', 'date', 'texte', 'image'].indexOf(k) < 0) throw refus_(n + 'champ inconnu « ' + texte_(k, 30) + ' ».', 'donnees'); });
    if (typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(a.id)) throw refus_(n + 'identifiant invalide.', 'donnees');
    if (ids[a.id]) throw refus_(n + 'identifiant en double.', 'donnees');
    ids[a.id] = true;
    if (typeof a.titre !== 'string' || !a.titre.trim() || a.titre.length > 300) throw refus_(n + 'titre manquant ou trop long.', 'donnees');
    if (typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw refus_(n + 'date invalide (AAAA-MM-JJ).', 'donnees');
    if (typeof a.texte !== 'string' || a.texte.length > 50000) throw refus_(n + 'texte invalide ou trop long.', 'donnees');
    if (a.image !== undefined && a.image !== '' && (typeof a.image !== 'string' || !ASSET_RE.test(a.image) || a.image.indexOf('..') > -1)) throw refus_(n + 'image invalide (fichier attendu dans assets/).', 'donnees');
  });
}

/** Image : taille plafonnée et signature réelle du fichier (JPEG, PNG, GIF ou WebP), quelle que soit l'extension. */
function verifierImage_(b64) {
  if (b64.length < 16) throw refus_('Ce fichier n’est pas une image JPEG, PNG, GIF ou WebP.', 'donnees');
  if (b64.length * 3 / 4 > CONFIG.IMAGE_MAX_OCTETS) throw refus_('Image trop volumineuse (6 Mo au plus).', 'donnees');
  var o = Utilities.base64Decode(b64.slice(0, 16)).map(function (b) { return (b + 256) % 256; });
  var txt = function (a, b) { return String.fromCharCode.apply(null, o.slice(a, b)); };
  var ok = (o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) ||
    (o[0] === 0x89 && txt(1, 4) === 'PNG') ||
    txt(0, 4) === 'GIF8' ||
    (txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP');
  if (!ok) throw refus_('Ce fichier n’est pas une image JPEG, PNG, GIF ou WebP.', 'donnees');
}

/* ======================= Aviator METAR : montres ======================= */
/* La montre appelle  GET /exec?a=w&id=<identifiant>&k=<clé>&v=<version>&r=<révision connue>
   - premier appel : la montre est enregistrée (seule l'empreinte de la clé est gardée) ;
   - chaque appel : renvoie le code à 6 chiffres en cours (valable MONTRE_CODE_MINUTES), le statut,
     et les réglages s'ils sont plus récents que la révision connue de la montre.
   La page web échange ce code contre un jeton de courte durée qui permet de lire et d'écrire les réglages. */
var REGL_DEF = { icao: 'ELLX', rwy: 0, icao2: '', rwy2: 0, icao3: '', rwy3: 0, gps: false, xwLim: 15, pUnit: 0, wUnit: 0, magVar: 0, dateFmt: 0 };
var STATUTS = ['beta', 'gratuit', 'premium'];

function montreAppel_(p) {
  var id = String(p.id || ''), k = String(p.k || '');
  if (!/^[A-Za-z0-9]{12,40}$/.test(id) || !/^[A-Za-z0-9]{16,64}$/.test(k)) throw refus_('Identifiant invalide.', 'montre');
  var rev = Number(p.r) || 0, ver = texte_(p.v, 20);
  var cache = CacheService.getScriptCache();
  var m = verrou_(function () {
    var row = montre_(id), now = String(Date.now());
    if (!row) {
      var n = Number(cache.get('mreg:*') || 0);
      if (n > 200) throw refus_('Trop d’enregistrements. Réessayez plus tard.', 'limite');
      cache.put('mreg:*', String(n + 1), 3600);
      row = { Id: id, Cle: hash_(k + '|' + id), Statut: 'beta', Reglages: '', Rev: '0', Version: ver, Cree: now, Vu: now, Accepte: '', Carte: 'oui' };
      ajouter_('Montres', row);
      return row;
    }
    if (row.Cle !== hash_(k + '|' + id)) throw refus_('Clé invalide.', 'montre');
    // « Vu » mis à jour au plus une fois par heure pour ménager la feuille
    if (Date.now() - Number(row.Vu || 0) > 3600000 || row.Version !== ver) majLigne_('Montres', function (r) { return r.Id === id; }, { Vu: now, Version: ver });
    return row;
  });
  var c = codeMontre_(id);
  var out = { ok: true, c: c.code, ce: Math.round((c.exp - Date.now()) / 1000), st: STATUTS.indexOf(m.Statut) > -1 ? m.Statut : 'beta', rv: Number(m.Rev) || 0 };
  if ((Number(m.Rev) || 0) > rev && m.Reglages) { try { out.s = JSON.parse(m.Reglages); } catch (e) { /* réglages illisibles : ignorés */ } }
  return out;
}

function montre_(id) {
  return lire_('Montres').filter(function (r) { return r.Id === id; })[0] || null;
}

/** Code à 6 chiffres de la montre : le même tant qu'il reste plus de 5 minutes, sinon un nouveau. */
function codeMontre_(id) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('mc:' + id);
  if (raw) { var o = JSON.parse(raw); if (o.exp - Date.now() > 300000 && cache.get('mcode:' + o.code) === id) return o; }
  var code, essai = 0;
  do { code = String(100000 + parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000); essai++; }
  while (cache.get('mcode:' + code) && essai < 10);
  var exp = Date.now() + CONFIG.MONTRE_CODE_MINUTES * 60000;
  cache.put('mcode:' + code, id, CONFIG.MONTRE_CODE_MINUTES * 60);
  cache.put('mc:' + id, JSON.stringify({ code: code, exp: exp }), CONFIG.MONTRE_CODE_MINUTES * 60);
  return { code: code, exp: exp };
}

function aviatorOuvrir_(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) throw refus_('Enter the 6-digit code shown on your watch.', 'code');
  var cache = CacheService.getScriptCache();
  var minute = 'mtry:' + Math.floor(Date.now() / 60000), n = Number(cache.get(minute) || 0);
  if (n >= CONFIG.MONTRE_ESSAIS_PAR_MINUTE) throw refus_('Too many attempts. Please wait a minute and try again.', 'limite');
  cache.put(minute, String(n + 1), 120);
  var id = cache.get('mcode:' + code);
  if (!id) throw refus_('Unknown or expired code. Check the code on your watch (it changes every few minutes).', 'code');
  var m = montre_(id);
  if (!m) throw refus_('Unknown watch.', 'code');
  var jeton = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('mtok:' + hash_(jeton), id, CONFIG.MONTRE_SESSION_MINUTES * 60);
  return { ok: true, jeton: jeton, reglages: reglagesDe_(m), statut: m.Statut || 'beta', accepte: !!m.Accepte, carte: m.Carte !== 'non' };
}

function reglagesDe_(m) {
  var r = {}, s = {};
  try { s = m.Reglages ? JSON.parse(m.Reglages) : {}; } catch (e) { s = {}; }
  Object.keys(REGL_DEF).forEach(function (k) { r[k] = (k in s) ? s[k] : REGL_DEF[k]; });
  return r;
}

function aviatorEnregistrer_(jeton, reg, accepte) {
  var id = CacheService.getScriptCache().get('mtok:' + hash_(String(jeton || '')));
  if (!id) throw refus_('Your session has expired. Enter a new code from your watch.', 'session');
  if (accepte !== true) throw refus_('Please read and accept the terms before saving.', 'accepte');
  if (!reg || typeof reg !== 'object') throw refus_('Invalid settings.', 'donnees');
  var icao = function (v, vide) { v = String(v || '').trim().toUpperCase(); if (!v && vide) return ''; if (!/^[A-Z0-9]{4}$/.test(v)) throw refus_('Invalid ICAO code: ' + texte_(v, 8) + ' (4 letters, e.g. ELLX).', 'donnees'); return v; };
  var ent = function (v, a, b, nom) { v = Number(v); if (!isFinite(v) || Math.round(v) !== v || v < a || v > b) throw refus_('Invalid value: ' + nom + '.', 'donnees'); return v; };
  var s = {
    icao: icao(reg.icao, false), rwy: ent(reg.rwy, 0, 36, 'runway 1'),
    icao2: icao(reg.icao2, true), rwy2: ent(reg.rwy2, 0, 36, 'runway 2'),
    icao3: icao(reg.icao3, true), rwy3: ent(reg.rwy3, 0, 36, 'runway 3'),
    gps: reg.gps === true, xwLim: ent(reg.xwLim, 0, 60, 'crosswind limit'),
    pUnit: ent(reg.pUnit, 0, 1, 'pressure unit'), wUnit: ent(reg.wUnit, 0, 1, 'wind unit'),
    magVar: ent(reg.magVar, -30, 30, 'magnetic variation'), dateFmt: ent(reg.dateFmt, 0, 1, 'date format')
  };
  var carte = reg.carte === false ? 'non' : 'oui';
  var rev = verrou_(function () {
    var m = montre_(id);
    if (!m) throw refus_('Unknown watch.', 'code');
    var r = (Number(m.Rev) || 0) + 1;
    majLigne_('Montres', function (x) { return x.Id === id; }, { Reglages: JSON.stringify(s), Rev: String(r), Accepte: m.Accepte || String(Date.now()), Carte: carte });
    return r;
  });
  try { aeroportsConnus_([s.icao, s.icao2, s.icao3].filter(String)); } catch (e) { /* la carte se complétera plus tard */ }
  return { ok: true, rev: rev, reglages: s };
}

/** Coordonnées des aéroports (aviationweather.gov), gardées dans l'onglet Aeroports. */
function aeroportsConnus_(liste) {
  var connus = {};
  lire_('Aeroports').forEach(function (r) { connus[r.Icao] = r; });
  var manquants = liste.filter(function (x, i) { return x && !connus[x] && liste.indexOf(x) === i; });
  if (!manquants.length) return connus;
  var res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/airport?ids=' + manquants.join(',') + '&format=json', { muteHttpExceptions: true, headers: { 'User-Agent': 'NiderLabs-Aviator/1.0' } });
  if (res.getResponseCode() !== 200) return connus;
  var data = JSON.parse(res.getContentText() || '[]');
  data.forEach(function (a) {
    var ic = String(a.icaoId || a.id || '').toUpperCase();
    if (!ic || connus[ic] || !isFinite(a.lat) || !isFinite(a.lon)) return;
    var o = { Icao: ic, Lat: String(a.lat), Lon: String(a.lon), Nom: texte_(a.name, 80), Maj: String(Date.now()) };
    ajouter_('Aeroports', o); connus[ic] = o;
  });
  return connus;
}

/** Nom et pistes d'un aéroport pour la page de réglages (gardé 1 jour en cache). */
function aviatorAeroport_(icao) {
  icao = String(icao || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) throw refus_('Invalid ICAO code (4 letters, e.g. ELLX).', 'donnees');
  var cache = CacheService.getScriptCache(), deja = cache.get('apt:' + icao);
  if (deja) return JSON.parse(deja);
  var res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/airport?ids=' + icao + '&format=json', { muteHttpExceptions: true, headers: { 'User-Agent': 'NiderLabs-Aviator/1.0' } });
  var a = res.getResponseCode() === 200 ? (JSON.parse(res.getContentText() || '[]')[0] || null) : null;
  var out;
  if (!a) out = { ok: true, icao: icao, trouve: false };
  else {
    var bouts = [];
    (a.runways || []).forEach(function (r) {
      String(r.id || '').split('/').forEach(function (b) { var n = parseInt(b, 10); if (n >= 1 && n <= 36 && bouts.indexOf(n) < 0) bouts.push(n); });
    });
    out = { ok: true, icao: icao, trouve: true, nom: texte_(a.name, 80), pistes: bouts };
  }
  cache.put('apt:' + icao, JSON.stringify(out), 86400);
  return out;
}

/** Carte publique : aéroports réglés sur des montres vues ces CARTE_JOURS derniers jours, nombre arrondi en tranches. */
function aviatorCarte_() {
  var cache = CacheService.getScriptCache(), deja = cache.get('carte');
  if (deja) return JSON.parse(deja);
  // Montres inactives depuis 12 mois : supprimées (politique de confidentialité)
  var vieux = Date.now() - 365 * 86400000;
  if (lire_('Montres').some(function (m) { return Number(m.Vu) < vieux; })) verrou_(function () { supprimerLignes_('Montres', function (m) { return Number(m.Vu) < vieux; }); });
  var limite = Date.now() - CONFIG.CARTE_JOURS * 86400000, compte = {};
  lire_('Montres').forEach(function (m) {
    if (m.Carte === 'non' || Number(m.Vu) < limite || !m.Reglages || /^TEST/.test(m.Id)) return; // TEST… = essais techniques
    var s; try { s = JSON.parse(m.Reglages); } catch (e) { return; }
    var vus = {};
    [s.icao, s.icao2, s.icao3].forEach(function (x) { if (x && !vus[x]) { vus[x] = 1; compte[x] = (compte[x] || 0) + 1; } });
  });
  var connus = aeroportsConnus_(Object.keys(compte));
  var points = Object.keys(compte).filter(function (x) { return connus[x]; }).map(function (x) {
    var n = compte[x];
    return { icao: x, nom: connus[x].Nom, lat: Number(connus[x].Lat), lon: Number(connus[x].Lon), t: n >= 10 ? '10+' : n >= 5 ? '5+' : '1-4' };
  });
  var out = { ok: true, points: points, maj: Date.now() };
  cache.put('carte', JSON.stringify(out), 1800);
  return out;
}

/* ======================= Feuille : utilitaires ======================= */
function classeur_(creerSiAbsent) {
  var actif = null;
  try { actif = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { actif = null; }
  if (actif) return actif;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  if (!creerSiAbsent) throw refus_("La feuille n'est pas installée. Lancez « installer ».", 'installation');
  var ss = SpreadsheetApp.create(nomSite_() + ' – Base (privée)');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
function feuille_(nom) {
  var ss = classeur_(false), sh = ss.getSheetByName(nom);
  // Onglets ajoutés après l'installation (Aviator METAR) : créés au premier besoin, sans relancer « installer »
  if (!sh && (nom === 'Montres' || nom === 'Aeroports')) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, ONGLETS[nom].length).setValues([ONGLETS[nom]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), ONGLETS[nom].length).setNumberFormat('@');
  }
  if (!sh) throw refus_("La feuille n'est pas installée (onglet " + nom + ' manquant). Lancez « installer ».', 'installation');
  return sh;
}
function lire_(nom) {
  var sh = feuille_(nom), vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var head = vals[0];
  return vals.slice(1).map(function (row, i) {
    var o = { _ligne: i + 2 };
    head.forEach(function (h, j) {
      var v = row[j];
      if (v === null || v === undefined) v = '';
      else if (!(v instanceof Date)) v = String(v).replace(/^'(?=[=+\-@])/, '');
      o[h] = v;
    });
    return o;
  });
}
function ajouter_(nom, obj) {
  var sh = feuille_(nom), head = ONGLETS[nom];
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, head.length).setNumberFormat('@').setValues([head.map(function (h) { return sur_(obj[h]); })]);
}
function majLigne_(nom, pred, champs) {
  var sh = feuille_(nom), head = ONGLETS[nom], rows = lire_(nom);
  for (var i = 0; i < rows.length; i++) {
    if (!pred(rows[i])) continue;
    var cur = head.map(function (h) { return h in champs ? sur_(champs[h]) : sur_(rows[i][h]); });
    sh.getRange(rows[i]._ligne, 1, 1, head.length).setNumberFormat('@').setValues([cur]);
    return true;
  }
  throw refus_('Ligne introuvable.', 'introuvable');
}
function supprimerLignes_(nom, pred) {
  var sh = feuille_(nom), rows = lire_(nom);
  for (var i = rows.length - 1; i >= 0; i--) if (pred(rows[i])) sh.deleteRow(rows[i]._ligne);
}
function verrou_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw refus_('Le serveur est occupé. Réessayez dans un instant.', 'occupe');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ======================= Divers ======================= */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function nomSite_() { return texte_(prop_('SITE_NOM'), 80) || CONFIG.NOM_SITE_DEFAUT; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function refus_(msg, code) { var e = new Error(msg); e.public = true; e.code = code; return e; }
function norm_(s) { return String(s || '').trim().toLowerCase(); }
function oui_(v) { v = String(v || '').trim().toLowerCase(); return v === 'oui' || v === 'x' || v === 'true' || v === '1' || v === 'yes'; }
function texte_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
/** Neutralise les saisies que Sheets prendrait pour une formule (=, +, -, @). */
function sur_(v) { v = v instanceof Date ? Utilities.formatDate(v, CONFIG.FUSEAU, 'yyyy-MM-dd') : String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}
