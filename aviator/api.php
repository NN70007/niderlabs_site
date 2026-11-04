<?php
// Aviator METAR — relais pour les montres Garmin.
// Le téléphone de la montre appelle cette adresse (même domaine, réponse JSON directe, sans redirection) ;
// le relais transmet la demande au script Google (Apps Script) et renvoie sa réponse telle quelle.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$GAS = 'https://script.google.com/macros/s/AKfycbwjfALtYam9glF9Rb9pF_5IuImyFI4tler3PUiHPXBy5L3GOR-hItwuS33eI2wRHUQiAg/exec';
$p = array();
foreach (array('a', 'id', 'k', 'v', 'r') as $n) {
  if (isset($_GET[$n])) { $p[$n] = substr(preg_replace('/[^A-Za-z0-9._-]/', '', (string)$_GET[$n]), 0, 64); }
}
if (!isset($p['a']) || ($p['a'] !== 'w' && $p['a'] !== 'diag')) { http_response_code(400); echo '{"ok":false,"code":"requete"}'; exit; }
$ch = curl_init($GAS . '?' . http_build_query($p));
curl_setopt_array($ch, array(
  CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
  CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 25, CURLOPT_USERAGENT => 'NiderLabs-Aviator-Relay/1.0'
));
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
if ($body === false || $code !== 200 || substr(ltrim($body), 0, 1) !== '{') { http_response_code(502); echo '{"ok":false,"code":"relais"}'; exit; }
echo $body;
