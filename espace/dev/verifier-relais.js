#!/usr/bin/env node
/* Vérifie que chaque paramètre envoyé par les montres au serveur (appel « a=w ») passe bien les relais PHP.
   Les relais jettent sans erreur tout paramètre absent de leur liste blanche, et test-serveur.js appelle le serveur
   directement : sans cette vérification, un nouveau paramètre peut être perdu en silence (incident « n », 27/11/2026).
   Usage : node espace/dev/verifier-relais.js <sources Monkey C qui appellent le serveur>… [--relais fichier.php]…
   Par défaut, relais : aviator/api.php (ce dépôt) et ../gokyo_site/watch/crosswind/api.php. */
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), sources = [], relais = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--relais') relais.push(args[++i]); else sources.push(args[i]); }
const racine = path.join(__dirname, '..', '..');
if (!relais.length) relais.push(path.join(racine, 'aviator', 'api.php'), path.join(racine, '..', 'gokyo_site', 'watch', 'crosswind', 'api.php'));
if (!sources.length) { console.error('Indiquer les fichiers .mc qui appellent le serveur.'); process.exit(2); }

// Paramètres de l'appel au serveur : dictionnaire littéral qui contient "a" => "w"
const envoyes = new Set();
sources.forEach((f) => {
  const txt = fs.readFileSync(f, 'utf8');
  (txt.match(/\{[^{}]*"a"\s*=>\s*"w"[^{}]*\}/g) || []).forEach((d) => {
    (d.match(/"([A-Za-z0-9_]+)"\s*=>/g) || []).forEach((k) => envoyes.add(k.match(/"([^"]+)"/)[1]));
  });
});
if (!envoyes.size) { console.error('Aucun appel « a => w » trouvé dans les sources.'); process.exit(2); }

let erreurs = 0;
relais.forEach((f) => {
  const php = fs.readFileSync(f, 'utf8'), permis = new Set();
  const liste = php.match(/foreach\s*\(\s*array\(([^)]*)\)\s*as\s*\$n\s*\)/);
  if (liste) (liste[1].match(/'([^']+)'/g) || []).forEach((x) => permis.add(x.slice(1, -1)));
  (php.match(/isset\(\$_GET\['([^']+)'\]\)/g) || []).forEach((x) => permis.add(x.match(/'([^']+)'/)[1]));
  const manquants = [...envoyes].filter((k) => !permis.has(k));
  if (manquants.length) { erreurs++; console.log('✗ ' + f + ' : paramètres perdus par le relais : ' + manquants.join(', ')); }
  else console.log('✓ ' + f + ' : les ' + envoyes.size + ' paramètres (' + [...envoyes].join(', ') + ') passent');
});
process.exit(erreurs ? 1 : 0);
