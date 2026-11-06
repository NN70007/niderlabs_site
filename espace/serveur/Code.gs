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
  VERSION: '2026-11-06-boarding1',
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
  MONTRE_MEMO_JOURS: 30, // « Remember this phone »
  MONTRE_ESSAIS_PAR_MINUTE: 30,
  CARTE_JOURS: 30
};

var ONGLETS = {
  Acces: ['Email', 'Nom', 'Admin', 'Actualites', 'Actif', 'Note'],
  Journal: ['Date', 'Qui', 'Action', 'Detail'],
  Montres: ['Id', 'Cle', 'Statut', 'Reglages', 'Rev', 'Version', 'Cree', 'Vu', 'Accepte', 'Carte', 'Pro', 'Vols'],
  Aeroports: ['Icao', 'Lat', 'Lon', 'Nom', 'Maj']
};

/* ======================= Points d'entrée ======================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  // Diagnostic anonyme (aucun identifiant) : quand chaque montre a été vue pour la dernière fois
  if (p.a === 'diag') {
    var now = Date.now();
    return json_({ ok: true, version: CONFIG.VERSION, montres: lire_('Montres').map(function (m) {
      return { v: m.Version, vu_min: Math.round((now - Number(m.Vu)) / 60000), cree_min: Math.round((now - Number(m.Cree)) / 60000), rev: m.Rev, test: /^TEST/.test(m.Id) };
    }) });
  }
  // Cadran vol : vérifie la clé AeroDataBox (onglet config) SANS jamais la renvoyer
  if (p.a === 'vdiag') {
    try { return json_(volDiag_()); }
    catch (err) { console.error(err && err.stack || err); return json_({ ok: false, code: 'serveur' }); }
  }
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
  if (a === 'aviator.ouvrir') return aviatorOuvrir_(req.code, req.garder === true);
  if (a === 'aviator.reprendre') return aviatorReprendre_(req.memo);
  if (a === 'aviator.oublier') return aviatorOublier_(req.memo, req.jeton, req.tous === true);
  if (a === 'aviator.enregistrer') return aviatorEnregistrer_(req.jeton, req.reglages, req.accepte);
  if (a === 'aviator.carte') return aviatorCarte_();
  if (a === 'aviator.aeroport') return aviatorAeroport_(req.icao);
  // Aviator METAR Pro (page expérimentale niderlabs.com/aviator/pro)
  if (a === 'pro.charger') return proCharger_(req.jeton);
  if (a === 'pro.enregistrer') return proEnregistrer_(req.jeton, req.pro);
  if (a === 'pro.briefing') return proBriefing_(req.jeton);
  // Boarding (niderlabs.com/boarding) : même jumelage par code que Aviator
  if (a === 'boarding.charger') return boardingCharger_(req.jeton);
  if (a === 'boarding.ajouter') return boardingAjouter_(req.jeton, req.vol);
  if (a === 'boarding.supprimer') return boardingSupprimer_(req.jeton, String(req.n || ''), String(req.d || ''));
  if (a === 'boarding.maison') return boardingMaison_(req.jeton, req.tz);

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
    // Boarding : statuts de vols et d'avions de plus de 3 jours
    var bv = /^b[vi]:.*:(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (bv) { if (Date.parse(bv[1] + 'T00:00:00Z') < now - 3 * 86400000) { props.deleteProperty(k); n++; } return; }
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
  // Cadran Pro (version « P… ») : résumé TAF et rappels pilote, prêts à afficher
  if (/^P/.test(ver)) { try { out.p = proMontre_(m); } catch (e) { console.error(e && e.stack || e); } }
  // Cadran Boarding (version « B… ») : vols suivis, prêts à afficher
  if (/^B/.test(ver)) { try { out.b = boardingMontre_(m); } catch (e) { console.error(e && e.stack || e); } return out; }
  // Décalage horaire du jour (heure d'été comprise) des aérodromes de la montre : repère « L » sur le cadran
  try {
    var liste = icaosDe_(m).concat(String(p.i || '').toUpperCase().split(',').filter(function (x) { return /^[A-Z0-9]{4}$/.test(x); }).slice(0, 6));
    out.tz = tzDecalages_(liste);
  } catch (e) { console.error(e && e.stack || e); }
  return out;
}

/* ----- Fuseau horaire des aérodromes (fichiers aviator/tz/<lettre>.json du site, calculés depuis OurAirports) ----- */
function tzZone_(icao) {
  icao = String(icao || '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) return null;
  var L = icao.charAt(0), cache = CacheService.getScriptCache(), raw = cache.get('tzf:' + L);
  if (!raw) {
    var res = UrlFetchApp.fetch('https://niderlabs.com/aviator/tz/' + L + '.json', { muteHttpExceptions: true });
    raw = res.getResponseCode() === 200 ? res.getContentText() : '{"z":[],"a":{}}';
    try { cache.put('tzf:' + L, raw, 21600); } catch (e) { /* trop gros pour le cache : relu la prochaine fois */ }
  }
  var f = JSON.parse(raw), i = f.a[icao];
  return i == null ? null : f.z[i];
}
/** Décalage UTC en secondes pour un fuseau IANA, à l'instant donné (heure d'été comprise). */
function tzSecondes_(zone, quand) {
  var z = Utilities.formatDate(quand || new Date(), zone, 'Z'), m = /^([+-])(\d\d)(\d\d)$/.exec(z);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : null;
}
function tzDecalages_(icaos) {
  var out = {}, now = new Date();
  icaos.forEach(function (ic) {
    ic = String(ic || '').toUpperCase();
    if (!ic || ic in out) return;
    var z = tzZone_(ic);
    if (z) { var s = tzSecondes_(z, now); if (s != null) out[ic] = s; }
  });
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

function aviatorOuvrir_(code, garder) {
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
  var o = sessionMontre_(m);
  if (garder) { var mm = memoCreer_(m.Id); o.memo = mm.memo; o.memoExp = mm.exp; }
  return o;
}

/** Session web (2 h) pour une montre : jeton en cache, réglages renvoyés à la page. */
function sessionMontre_(m) {
  var jeton = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('mtok:' + hash_(jeton), m.Id, CONFIG.MONTRE_SESSION_MINUTES * 60);
  return { ok: true, jeton: jeton, reglages: reglagesDe_(m), statut: m.Statut || 'beta', accepte: !!m.Accepte, carte: m.Carte !== 'non' };
}

/* « Remember this phone » : jeton longue durée gardé dans le navigateur, empreinte seule côté serveur.
   Génération par montre : « Forget all phones » l'incrémente et invalide tous les téléphones mémorisés. */
function memoGen_(id) { return Number(PropertiesService.getScriptProperties().getProperty('mgen:' + id) || 0); }
function memoCreer_(id) {
  var memo = 'm' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var exp = Date.now() + CONFIG.MONTRE_MEMO_JOURS * 86400000;
  PropertiesService.getScriptProperties().setProperty('mrem:' + hash_(memo), JSON.stringify({ id: id, exp: exp, g: memoGen_(id) }));
  return { memo: memo, exp: exp };
}
function memoLire_(memo) {
  memo = String(memo || '');
  if (!/^m[0-9a-f]{64}$/.test(memo)) return null;
  var props = PropertiesService.getScriptProperties(), k = 'mrem:' + hash_(memo), raw = props.getProperty(k);
  if (!raw) return null;
  var r; try { r = JSON.parse(raw); } catch (e) { r = null; }
  if (!r || r.exp < Date.now() || r.g !== memoGen_(r.id)) { props.deleteProperty(k); return null; }
  return r;
}
function aviatorReprendre_(memo) {
  var r = memoLire_(memo);
  if (!r) throw refus_('This phone is no longer remembered. Enter the code shown on your watch.', 'memo');
  var m = montre_(r.id);
  if (!m) throw refus_('Unknown watch.', 'memo');
  var o = sessionMontre_(m); o.memoExp = r.exp;
  return o;
}
function aviatorOublier_(memo, jeton, tous) {
  if (tous) {
    var m = montreDuJeton_(jeton);
    PropertiesService.getScriptProperties().setProperty('mgen:' + m.Id, String(memoGen_(m.Id) + 1));
    return { ok: true };
  }
  if (memo) PropertiesService.getScriptProperties().deleteProperty('mrem:' + hash_(String(memo)));
  return { ok: true };
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

/* ======================= Aviator METAR Pro ======================= */
/* Données Pro par montre (colonne Pro, JSON) :
   { mn: { ceil, vis, wind, xw, gust } minima personnels (ft, m, kt),
     dt: { sep, med, lpe, other } dates d'échéance AAAA-MM-JJ,
     lg: [ { d: AAAA-MM-JJ, h: heures, pic: bool, ldg: n, nl: n atterrissages de nuit, fi: bool vol avec instructeur } ] carnet léger } */
var PRO_DEF = { mn: { ceil: 1500, vis: 5000, wind: 25, xw: 15, gust: 10 }, dt: { sep: '', med: '', lpe: '' }, lg: [] };

function montreDuJeton_(jeton) {
  var id = CacheService.getScriptCache().get('mtok:' + hash_(String(jeton || '')));
  if (!id) throw refus_('Your session has expired. Enter a new code from your watch.', 'session');
  var m = montre_(id);
  if (!m) throw refus_('Unknown watch.', 'code');
  return m;
}
function proDe_(m) {
  var p = {}; try { p = m.Pro ? JSON.parse(m.Pro) : {}; } catch (e) { p = {}; }
  return { mn: Object.assign({}, PRO_DEF.mn, p.mn || {}), dt: Object.assign({}, PRO_DEF.dt, p.dt || {}), lg: Array.isArray(p.lg) ? p.lg : [] };
}
function proCharger_(jeton) {
  var m = montreDuJeton_(jeton);
  return { ok: true, pro: proDe_(m), reglages: reglagesDe_(m), statut: m.Statut || 'beta' };
}
function proEnregistrer_(jeton, pro) {
  var m = montreDuJeton_(jeton);
  if (!pro || typeof pro !== 'object') throw refus_('Invalid data.', 'donnees');
  var n = function (v, a, b, nom) { v = Number(v); if (!isFinite(v) || v < a || v > b) throw refus_('Invalid value: ' + nom + '.', 'donnees'); return Math.round(v * 10) / 10; };
  var d = function (v) { v = String(v || '').trim(); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw refus_('Invalid date (YYYY-MM-DD).', 'donnees'); return v; };
  var mn = pro.mn || {}, dt = pro.dt || {};
  var lg = (Array.isArray(pro.lg) ? pro.lg : []).slice(-300).map(function (e) {
    return { d: d(e.d) || '1970-01-01', h: n(e.h || 0, 0, 24, 'flight time'), pic: e.pic !== false, ldg: n(e.ldg || 0, 0, 99, 'landings'), nl: n(e.nl || 0, 0, 99, 'night landings'), fi: e.fi === true };
  });
  var p = { mn: { ceil: n(mn.ceil, 0, 10000, 'ceiling'), vis: n(mn.vis, 0, 10000, 'visibility'), wind: n(mn.wind, 0, 99, 'wind'), xw: n(mn.xw, 0, 60, 'crosswind'), gust: n(mn.gust, 0, 60, 'gust spread') },
            dt: { sep: d(dt.sep), med: d(dt.med), lpe: d(dt.lpe) }, lg: lg };
  verrou_(function () { majLigne_('Montres', function (x) { return x.Id === m.Id; }, { Pro: JSON.stringify(p) }); });
  return { ok: true, pro: p };
}

/** Données publiques aviationweather.gov (NOAA), en cache 10 min par aérodrome. */
function awc_(type, icaos, extra) {
  var cache = CacheService.getScriptCache(), out = {}, manque = [];
  icaos.forEach(function (i) { var c = cache.get('awc:' + type + ':' + i); if (c) out[i] = JSON.parse(c); else manque.push(i); });
  if (manque.length) {
    var res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/' + type + '?ids=' + manque.join(',') + '&format=json' + (extra || ''),
      { muteHttpExceptions: true, headers: { 'User-Agent': 'NiderLabs-Aviator/1.0' } });
    var data = []; if (res.getResponseCode() === 200) { try { data = JSON.parse(res.getContentText() || '[]'); } catch (e) { data = []; } }
    manque.forEach(function (i) {
      var lst = data.filter(function (x) { return String(x.icaoId || '').toUpperCase() === i; });
      var v = type === 'metar' ? lst.slice(0, 3) : lst.slice(0, 1);
      v = v.map(function (x) { var c = Object.assign({}, x); delete c.dbPopTime; delete c.rawOb_; return c; });
      out[i] = v;
      try { cache.put('awc:' + type + ':' + i, JSON.stringify(v), 600); } catch (e) { /* trop gros pour le cache : ignoré */ }
    });
  }
  return out;
}
function icaosDe_(m) { var r = reglagesDe_(m); return [r.icao, r.icao2, r.icao3].filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }

function proBriefing_(jeton) {
  var m = montreDuJeton_(jeton), ic = icaosDe_(m);
  var apt = {};
  ic.forEach(function (i) { try { apt[i] = aviatorAeroportComplet_(i); } catch (e) { apt[i] = null; } });
  var tz = {}; try { tz = tzDecalages_(ic); } catch (e) { console.error(e && e.stack || e); }
  return { ok: true, icaos: ic, metar: awc_('metar', ic, '&hours=3'), taf: awc_('taf', ic), apt: apt, tz: tz, pro: proDe_(m), reglages: reglagesDe_(m), maj: Date.now() };
}
/** Aérodrome avec pistes (extrémités + orientation vraie) et coordonnées, 1 jour en cache. */
function aviatorAeroportComplet_(icao) {
  var cache = CacheService.getScriptCache(), deja = cache.get('aptc:' + icao);
  if (deja) return JSON.parse(deja);
  var res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/airport?ids=' + icao + '&format=json', { muteHttpExceptions: true, headers: { 'User-Agent': 'NiderLabs-Aviator/1.0' } });
  var a = res.getResponseCode() === 200 ? (JSON.parse(res.getContentText() || '[]')[0] || null) : null;
  if (!a) return null;
  var out = { icao: icao, nom: texte_(a.name, 80), lat: a.lat, lon: a.lon, elev: a.elev, rwy: (a.runways || []).map(function (r) { return { id: String(r.id || ''), al: r.alignment, dim: r.dimension, surf: r.surface }; }) };
  cache.put('aptc:' + icao, JSON.stringify(out), 86400);
  return out;
}

/* ----- Résumés pour le cadran Pro (texte court, majuscules, anglais) ----- */
function catDe_(ceil, visSm) {
  if (ceil == null && visSm == null) return '';
  var c = ceil == null ? 99999 : ceil, v = visSm == null ? 99 : visSm;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}
function visSm_(v) { if (v == null || v === '') return null; if (/\+/.test(String(v))) return 10; var n = parseFloat(v); return isFinite(n) ? n : null; }
function plafond_(clouds, vv) {
  var c = null;
  (clouds || []).forEach(function (x) { if ((x.cover === 'BKN' || x.cover === 'OVC' || x.cover === 'OVX') && isFinite(x.base) && (c == null || x.base < c)) c = x.base; });
  if (isFinite(vv) && vv != null && (c == null || vv * 100 < c)) c = vv * 100;
  return c;
}
function hz_(t) { return Utilities.formatDate(new Date(t * 1000), 'UTC', 'HH') + 'Z'; }
function tafLignes_(taf) {
  if (!taf || !taf.fcsts) return [];
  var now = Date.now() / 1000, rows = [];
  taf.fcsts.forEach(function (f) {
    if (f.timeTo && f.timeTo < now) return;
    var ch = f.fcstChange || '', pr = f.probability ? 'PROB' + f.probability + ' ' : '';
    var hdr = ch === 'FM' ? 'FM ' + hz_(f.timeFrom) : ch === 'BECMG' ? 'BECMG ' + hz_(f.timeFrom) : (ch === 'TEMPO' || pr) ? pr + (ch === 'TEMPO' ? 'TEMPO ' : '') + hz_(f.timeFrom) + '-' + hz_(f.timeTo) : (f.timeFrom <= now ? 'NOW' : 'FROM ' + hz_(f.timeFrom));
    var cat = catDe_(plafond_(f.clouds, f.vertVis), visSm_(f.visib));
    var w = isFinite(f.wspd) && f.wspd != null ? (isFinite(f.wdir) && f.wdir != null ? ('00' + f.wdir).slice(-3) : 'VRB') + ('0' + f.wspd).slice(-2) + (f.wgst ? 'G' + f.wgst : '') + 'KT' : '';
    var det = [cat, w, f.wxString || ''].filter(String).join(' ');
    if (!det) return;
    rows.push([hdr.trim(), det.slice(0, 22), cat]);
  });
  return rows.slice(0, 3);
}
function jours_(dateStr) { if (!dateStr) return null; var t = Date.parse(dateStr + 'T23:59:59Z'); return isFinite(t) ? Math.floor((t - Date.now()) / 86400000) : null; }
var MOIS_ = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function jjmm_(t) { var d = new Date(t); return ('0' + d.getUTCDate()).slice(-2) + ' ' + MOIS_[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); }
/** Validité passagers / nuit (FCL.060 : 3 décollages et atterrissages en 90 jours ; nuit : 1 en 90 jours). */
function recence_(lg) {
  var ev = []; (lg || []).forEach(function (e) { for (var k = 0; k < (e.ldg || 0); k++) ev.push(Date.parse(e.d + 'T12:00:00Z')); });
  ev.sort(function (a, b) { return b - a; });
  var nuit = (lg || []).filter(function (e) { return (e.nl || 0) > 0; }).map(function (e) { return Date.parse(e.d + 'T12:00:00Z'); }).sort(function (a, b) { return b - a; });
  return { pax: ev.length >= 3 ? ev[2] + 90 * 86400000 : null, night: nuit.length ? nuit[0] + 90 * 86400000 : null };
}
/** Prorogation SEP par expérience (FCL.740.A) dans les 12 mois avant l'échéance. */
function sepProgres_(pro) {
  var fin = pro.dt.sep ? Date.parse(pro.dt.sep + 'T23:59:59Z') : null;
  if (!fin) return null;
  var deb = fin - 365 * 86400000, h = 0, pic = 0, ldg = 0, fi = false;
  pro.lg.forEach(function (e) { var t = Date.parse(e.d + 'T12:00:00Z'); if (t >= deb && t <= fin) { h += e.h || 0; if (e.pic) pic += e.h || 0; ldg += e.ldg || 0; if (e.fi && (e.h || 0) >= 1) fi = true; } });
  return { h: Math.round(h * 10) / 10, pic: Math.round(pic * 10) / 10, ldg: ldg, fi: fi, ok: h >= 12 && pic >= 6 && ldg >= 12 && fi };
}
function proMontre_(m) {
  var pro = proDe_(m), ic = icaosDe_(m), taf = awc_('taf', ic), tf = {};
  ic.forEach(function (i) { var t = (taf[i] || [])[0]; if (t) tf[i] = tafLignes_(t); });
  var cu = [], now = Date.now(), rc = recence_(pro.lg);
  var niv = function (t) { return t == null ? 2 : t < now ? 2 : t - now < 30 * 86400000 ? 1 : 0; };
  if (pro.lg.length) {
    cu.push(['PAX', rc.pax && rc.pax >= now ? 'TO ' + jjmm_(rc.pax) : 'NOT CURRENT', niv(rc.pax)]);
    cu.push(['NIGHT', rc.night && rc.night >= now ? 'TO ' + jjmm_(rc.night) : 'NOT CURRENT', rc.night && rc.night >= now ? niv(rc.night) : 1]);
  }
  [['SEP', pro.dt.sep], ['MEDICAL', pro.dt.med], ['ENGLISH', pro.dt.lpe]].forEach(function (x) {
    if (!x[1]) return; var t = Date.parse(x[1] + 'T23:59:59Z'); cu.push([x[0], t < now ? 'EXPIRED' : jjmm_(t), niv(t)]);
  });
  var sp = sepProgres_(pro);
  if (sp && !sp.ok && pro.dt.sep) cu.push(['SEP REVAL', sp.h + '/12H ' + sp.ldg + '/12 LDG', 1]);
  return { tf: tf, cu: cu.slice(0, 4) };
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
  // Colonnes ajoutées plus tard (ex. Pro) : en-tête complété au premier besoin
  if (ONGLETS[nom] && sh.getLastColumn() < ONGLETS[nom].length) sh.getRange(1, 1, 1, ONGLETS[nom].length).setValues([ONGLETS[nom]]);
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

/* ======================= Cadran vol (passagers) : données AeroDataBox ======================= */
// Clé lue dans l'onglet « config » (A: nom, B: valeur) ou, à défaut, dans les propriétés du script.
// Elle n'est jamais renvoyée ni journalisée.
function volCle_() {
  var k = PropertiesService.getScriptProperties().getProperty('AERODATABOX_KEY');
  if (k) return String(k).trim();
  var sh = null;
  try { sh = classeur_(false).getSheetByName('config'); } catch (e) { sh = null; }
  if (!sh) return '';
  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim().toUpperCase() === 'AERODATABOX_KEY') return String(v[i][1] || '').trim();
  return '';
}
function volAppel_(chemin) {
  var cle = volCle_();
  if (!cle) return { code: 0, data: null };
  var r = UrlFetchApp.fetch('https://aerodatabox.p.rapidapi.com' + chemin, {
    headers: { 'X-RapidAPI-Key': cle, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
    muteHttpExceptions: true
  });
  var code = r.getResponseCode(), data = null;
  if (code === 200) { try { data = JSON.parse(r.getContentText()); } catch (e) { data = null; } }
  return { code: code, data: data };
}
// Diagnostic : présence de la clé et un seul appel test (résultat gardé 10 min pour ne pas consommer d'unités)
function volDiag_() {
  var cache = CacheService.getScriptCache(), c = cache.get('vdiag2');
  if (c) { var o = JSON.parse(c); o.cache = true; return o; }
  var cle = volCle_();
  var out = { ok: true, cle: !!cle, onglet: false };
  try { out.onglet = !!classeur_(false).getSheetByName('config'); } catch (e) { out.onglet = false; }
  if (cle) {
    var jour = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
    var r = volAppel_('/flights/number/LH400/' + jour);
    out.http = r.code;
    out.vols = Array.isArray(r.data) ? r.data.length : 0;
    if (Array.isArray(r.data) && r.data[0]) {
      var f = r.data[0];
      out.exemple = { vol: f.number, statut: f.status, de: f.departure && f.departure.airport && f.departure.airport.iata,
        vers: f.arrival && f.arrival.airport && f.arrival.airport.iata, porte: f.departure && f.departure.gate || null,
        terminal: f.departure && f.departure.terminal || null, avion: f.aircraft && f.aircraft.model || null,
        immat: f.aircraft && f.aircraft.reg || null };
      // Rotations du même avion aujourd'hui : c'est ce qui dit si l'avion est déjà arrivé
      if (out.exemple.immat) {
        var r2 = volAppel_('/flights/reg/' + encodeURIComponent(out.exemple.immat) + '/' + jour);
        out.http_immat = r2.code;
        out.rotations = (Array.isArray(r2.data) ? r2.data : []).map(function (g) {
          return { vol: g.number, de: g.departure && g.departure.airport && g.departure.airport.iata,
            vers: g.arrival && g.arrival.airport && g.arrival.airport.iata, statut: g.status };
        });
      }
    }
  }
  cache.put('vdiag2', JSON.stringify(out), 600);
  return out;
}

/* ======================= Boarding : cadran vol pour passagers ======================= */
/* Vols par montre (colonne Vols, JSON) : { h: fuseau maison IANA, v: [ { n: 'LG8803', d: 'AAAA-MM-JJ' (date locale de départ), s: siège, o: IATA départ } ] }
   Statut d'un vol : AeroDataBox, gardé dans les propriétés du script ('bv:<n>:<d>') et rafraîchi d'autant plus souvent
   que le départ approche (une seule requête par vol, quel que soit le nombre de montres qui le suivent). */
var BOARDING = { VOLS_MAX: 6, APPELS_JOUR: 80 };

function boardingDe_(m) {
  var b = {}; try { b = m.Vols ? JSON.parse(m.Vols) : {}; } catch (e) { b = {}; }
  return { h: typeof b.h === 'string' ? b.h : CONFIG.FUSEAU, v: Array.isArray(b.v) ? b.v : [] };
}
function boardingNumero_(s) {
  s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var r = /^([A-Z0-9]{2})0*(\d{1,4}[A-Z]?)$/.exec(s);
  if (!r || /^\d\d$/.test(r[1])) return null;
  return r[1] + r[2];
}
function boardingDate_(s) {
  s = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var t = Date.parse(s + 'T12:00:00Z');
  if (!isFinite(t) || t < Date.now() - 2 * 86400000 || t > Date.now() + 330 * 86400000) return null;
  return s;
}
// « 2026-11-06 10:25Z » / « 2026-11-06 11:25+01:00 » -> secondes UTC ; décalage local en secondes
function adbT_(x) {
  if (!x) return null;
  var u = String(x.utc || '').trim().replace(' ', 'T');
  if (u && !/(Z|[+-]\d\d:?\d\d)$/.test(u)) u += 'Z';
  var t = Date.parse(u);
  return isFinite(t) ? Math.round(t / 1000) : null;
}
function adbZ_(x) {
  var m = /([+-])(\d\d):?(\d\d)$/.exec(String((x && x.local) || '').trim());
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : null;
}
function adbMeilleur_(mv) {
  if (!mv) return null;
  return adbT_(mv.runwayTime) || adbT_(mv.revisedTime) || adbT_(mv.predictedTime) || adbT_(mv.scheduledTime);
}
function iataDe_(ap) { return ap ? String(ap.iata || ap.icao || '').toUpperCase() : ''; }
function volNorme_(l) {
  var dp = l.departure || {}, ar = l.arrival || {}, ac = l.aircraft || {};
  return {
    n: String(l.number || '').toUpperCase(), al: (l.airline && l.airline.name) || '',
    o: iataDe_(dp.airport), oi: String((dp.airport && dp.airport.icao) || '').toUpperCase(), oc: String((dp.airport && (dp.airport.municipalityName || dp.airport.shortName)) || ''),
    a: iataDe_(ar.airport), ai: String((ar.airport && ar.airport.icao) || '').toUpperCase(), ac2: String((ar.airport && (ar.airport.municipalityName || ar.airport.shortName)) || ''),
    st: String(l.status || 'Unknown'),
    sd: adbT_(dp.scheduledTime), ed: adbMeilleur_(dp), sa: adbT_(ar.scheduledTime), ea: adbMeilleur_(ar),
    oz: adbZ_(dp.scheduledTime), az: adbZ_(ar.scheduledTime),
    g: dp.gate || '', t: dp.terminal || '', ck: dp.checkInDesk || '', ta: ar.terminal || '', b: ar.baggageBelt || '',
    md: ac.model || '', rg: ac.reg || ''
  };
}
// Garde le vol réellement opéré (pas les numéros de partage de code), et le bon départ si on le connaît
function volChoisir_(legs, o) {
  if (!Array.isArray(legs) || !legs.length) return null;
  var l = legs.filter(function (x) { return x && x.codeshareStatus !== 'IsCodeshared'; });
  if (!l.length) l = legs;
  if (o) { var m = l.filter(function (x) { return iataDe_(x.departure && x.departure.airport) === o; }); if (m.length) l = m; }
  return l[0];
}
function budgetAdb_() {
  var c = CacheService.getScriptCache(), k = 'adb:' + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'), n = Number(c.get(k) || 0);
  if (n >= BOARDING.APPELS_JOUR) return false;
  c.put(k, String(n + 1), 90000);
  return true;
}
/** Intervalle de rafraîchissement (secondes) selon l'état du vol. */
function volFraicheur_(f) {
  var now = Date.now() / 1000;
  if (!f || !f.sd) return 6 * 3600;
  var dep = f.ed || f.sd, arr = f.ea || f.sa || dep + 3 * 3600;
  if (/^Canceled/.test(f.st)) return 6 * 3600;
  if (now > arr + 2 * 3600) return 1e9;                       // vol terminé : plus de requête
  if (now > arr - 1800 || f.st === 'Arrived') return 600;     // atterrissage, tapis à bagages
  if (now > dep - 3 * 3600) return 360;                       // de 3 h avant le départ à l'arrivée
  if (dep - now < 12 * 3600) return 2700;
  if (dep - now < 48 * 3600) return 3 * 3600;
  return 24 * 3600;
}
function volStatut_(n, d, o, forcer) {
  var props = PropertiesService.getScriptProperties(), k = 'bv:' + n + ':' + d, rec = null;
  try { rec = JSON.parse(props.getProperty(k) || 'null'); } catch (e) { rec = null; }
  var now = Math.round(Date.now() / 1000);
  if (rec && !forcer && now - rec.t < volFraicheur_(rec.f)) return rec;
  if (!budgetAdb_()) return rec;
  var r = volAppel_('/flights/number/' + n + '/' + d + '?withAircraftImage=false&withLocation=false');
  if (r.code === 200 || r.code === 204) {
    var l = volChoisir_(r.data, o);
    var f = l ? volNorme_(l) : null;
    var nv = { t: now, f: f, gp: rec && rec.gp || '', gpt: rec && rec.gpt || 0 };
    if (f && rec && rec.f && rec.f.g && f.g && rec.f.g !== f.g) { nv.gp = rec.f.g; nv.gpt = now; }
    try { props.setProperty(k, JSON.stringify(nv)); } catch (e) { console.error(e); }
    return nv;
  }
  return rec;
}
/** Avion qui assure le vol : son vol précédent du jour (en vol, au sol…). */
function volEntrant_(f) {
  if (!f || !f.rg || !f.sd) return null;
  var now = Date.now() / 1000, dep = f.ed || f.sd;
  if (now < dep - 10 * 3600 || now > dep) return null;
  var jour = Utilities.formatDate(new Date((f.sd + (f.oz || 0)) * 1000), 'UTC', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties(), k = 'bi:' + f.rg + ':' + jour, rec = null;
  try { rec = JSON.parse(props.getProperty(k) || 'null'); } catch (e) { rec = null; }
  var age = rec ? now - rec.t : 1e9, frais = rec && rec.i && rec.i.st === 'Arrived' ? 3600 : 600;
  if (!rec || age > frais) {
    if (budgetAdb_()) {
      var r = volAppel_('/flights/reg/' + encodeURIComponent(f.rg) + '/' + jour + '?withAircraftImage=false&withLocation=false');
      if (r.code === 200 || r.code === 204) {
        var vu = {}, legs = (Array.isArray(r.data) ? r.data : []).filter(function (x) { return x && x.codeshareStatus !== 'IsCodeshared'; }).map(volNorme_)
          .filter(function (x) { var c = x.o + x.sd; if (vu[c]) return false; vu[c] = 1; return true; })
          .sort(function (a, b) { return (a.sd || 0) - (b.sd || 0); });
        var avant = legs.filter(function (x) { return x.a === f.o && x.sd && x.sd < f.sd; }).pop();
        var i = avant ? { o: avant.o, oc: avant.oc, st: avant.st, ea: avant.ea, sa: avant.sa }
          : (legs.length && legs[0].n === f.n ? { ici: true } : null);
        rec = { t: Math.round(now), i: i };
        try { props.setProperty(k, JSON.stringify(rec)); } catch (e) { console.error(e); }
      }
    }
  }
  return rec ? rec.i : null;
}
/** Météo simple à l'arrivée (METAR) : température et un mot. */
function meteoSimple_(icao) {
  if (!/^[A-Z]{4}$/.test(icao || '')) return null;
  var m = (awc_('metar', [icao])[icao] || [])[0];
  if (!m) return null;
  var raw = ' ' + String(m.rawOb || '') + ' ', w = 'CLEAR';
  if (/ [-+]?(VC)?TS/.test(raw)) w = 'STORM';
  else if (/ [-+]?\w*SN /.test(raw)) w = 'SNOW';
  else if (/ [-+]?\w*(RA|SH) /.test(raw)) w = 'RAIN';
  else if (/ [-+]?DZ /.test(raw)) w = 'DRIZZLE';
  else if (/ (FG|BR) /.test(raw)) w = 'FOG';
  else if (/ (BKN|OVC)\d{3}/.test(raw)) w = 'CLOUDY';
  else if (/ (FEW|SCT)\d{3}/.test(raw)) w = 'FAIR';
  return { t: isFinite(Number(m.temp)) ? Math.round(Number(m.temp)) : null, w: w };
}
function villeDe_(tz) { var p = String(tz || '').split('/'); return p[p.length - 1].replace(/_/g, ' ').toUpperCase(); }

/** Liste prête à afficher (montre et page web) : vols à venir ou en cours, triés. */
function boardingListe_(b, pourMontre) {
  var now = Date.now() / 1000, out = [];
  b.v.forEach(function (v) {
    var rec = volStatut_(v.n, v.d, v.o, false), f = rec && rec.f;
    if (!f) { out.push({ n: v.n, d: v.d, s: v.s || '', inconnu: true, sd: Date.parse(v.d + 'T12:00:00Z') / 1000 }); return; }
    var arr = f.ea || f.sa || (f.ed || f.sd) + 3 * 3600;
    if (now > arr + 3 * 3600) return; // terminé depuis plus de 3 h
    var x = Object.assign({}, f, { s: v.s || '', d: v.d });
    x.dl = f.ed && f.sd ? Math.round((f.ed - f.sd) / 60) : 0;
    if (rec.gp && now - rec.gpt < 2700) x.gp = rec.gp;
    if (now > (f.ed || f.sd) - 10 * 3600 && now < (f.ed || f.sd)) { try { x.in = volEntrant_(f); } catch (e) { console.error(e); } }
    if (now > (f.ed || f.sd) - 6 * 3600) { try { x.wx = meteoSimple_(f.ai); } catch (e) { x.wx = null; } }
    out.push(x);
  });
  out.sort(function (a, b) { return (a.sd || 0) - (b.sd || 0); });
  if (pourMontre) out = out.slice(0, 3).map(function (x) {
    var o = { n: x.n.replace(/^([A-Z0-9]{2})(\d)/, '$1 $2'), o: x.o, a: x.a, ac: x.ac2 ? x.ac2.toUpperCase().slice(0, 14) : '', st: x.st, sd: x.sd, ed: x.ed, sa: x.sa, ea: x.ea,
      oz: x.oz, az: x.az, g: x.g, t: x.t, b: x.b, s: x.s, dl: x.dl };
    if (x.gp) o.gp = x.gp;
    if (x.in) o.in = x.in.ici ? { h: 1 } : { o: x.in.o, st: x.in.st, ea: x.in.ea };
    if (x.wx) o.wx = x.wx;
    if (x.inconnu) o.u = 1;
    return o;
  });
  return out;
}
function boardingMontre_(m) {
  var b = boardingDe_(m);
  return { h: tzSecondes_(b.h, new Date()), hn: villeDe_(b.h), f: boardingListe_(b, true) };
}
function boardingEcrire_(id, b) {
  verrou_(function () { majLigne_('Montres', function (x) { return x.Id === id; }, { Vols: JSON.stringify(b) }); });
}
function boardingCharger_(jeton) {
  var m = montreDuJeton_(jeton), b = boardingDe_(m);
  return { ok: true, h: b.h, vols: boardingListe_(b, false), enregistres: b.v };
}
function boardingAjouter_(jeton, vol) {
  var m = montreDuJeton_(jeton), b = boardingDe_(m);
  vol = vol || {};
  var n = boardingNumero_(vol.n), d = boardingDate_(vol.d);
  if (!n) throw refus_('Invalid flight number (e.g. LG8803).', 'donnees');
  if (!d) throw refus_('Invalid date (from yesterday up to 11 months ahead).', 'donnees');
  var s = texte_(vol.s, 4).toUpperCase().replace(/[^0-9A-Z]/g, '');
  var o = texte_(vol.o, 3).toUpperCase().replace(/[^A-Z]/g, '');
  var deja = b.v.filter(function (x) { return x.n === n && x.d === d; })[0];
  if (!deja && b.v.length >= BOARDING.VOLS_MAX) throw refus_('You can follow up to ' + BOARDING.VOLS_MAX + ' flights. Remove one first.', 'limite');
  if (!volCle_()) throw refus_('Flight data is not available right now. Please try again later.', 'config');
  var rec = volStatut_(n, d, o, !deja);
  if (!rec || !rec.f) throw refus_('Flight ' + n + ' not found on ' + d + '. Check the number and the local departure date.', 'introuvable');
  if (deja) { if (s) deja.s = s; }
  else b.v.push({ n: n, d: d, s: s, o: rec.f.o });
  b.v.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : 0; });
  boardingEcrire_(m.Id, b);
  return { ok: true, vol: Object.assign({ s: s, d: d }, rec.f), vols: boardingListe_(b, false), enregistres: b.v };
}
function boardingSupprimer_(jeton, n, d) {
  var m = montreDuJeton_(jeton), b = boardingDe_(m);
  b.v = b.v.filter(function (x) { return !(x.n === n && x.d === d); });
  boardingEcrire_(m.Id, b);
  return { ok: true, vols: boardingListe_(b, false), enregistres: b.v };
}
function boardingMaison_(jeton, tz) {
  var m = montreDuJeton_(jeton), b = boardingDe_(m);
  tz = texte_(tz, 60);
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){1,2}$/.test(tz) || tzSecondes_(tz, new Date()) == null) throw refus_('Unknown time zone.', 'donnees');
  b.h = tz;
  boardingEcrire_(m.Id, b);
  return { ok: true, h: tz };
}
