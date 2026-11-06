<?php
// Boarding — relais Web Push (RFC 8291 aes128gcm + VAPID RFC 8292).
// Sans état : les clés VAPID sont gardées par le serveur Apps Script, qui les envoie à chaque appel.
//   GET  push.php?a=gen   -> nouvelle paire de clés VAPID { pub, priv } (appelé une seule fois par le serveur)
//   POST push.php?a=send  -> { vapid:{pub,priv}, subject, subs:[{endpoint,keys:{p256dh,auth}}], payload } -> { res:[{endpoint,code}] }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function b64u_enc($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec($s) { $s = strtr($s, '-_', '+/'); return base64_decode($s . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

// Clé publique EC P-256 (point non compressé 65 octets) -> PEM
function pub_pem($point) {
  $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $point;
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
function nouvelle_cle() {
  $k = openssl_pkey_new(array('curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC));
  $d = openssl_pkey_get_details($k);
  $pt = "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
  openssl_pkey_export($k, $pem);
  return array($k, $pt, $pem);
}
// Signature ECDSA DER -> r||s (64 octets) pour un JWT ES256
function der_vers_brut($der) {
  $o = 3; $lr = ord($der[$o]); $r = substr($der, $o + 1, $lr); $o += 1 + $lr + 1; $ls = ord($der[$o]); $s = substr($der, $o + 1, $ls);
  $r = str_pad(ltrim($r, "\0"), 32, "\0", STR_PAD_LEFT); $s = str_pad(ltrim($s, "\0"), 32, "\0", STR_PAD_LEFT);
  return $r . $s;
}
function jwt_vapid($aud, $subject, $privPem) {
  $h = b64u_enc(json_encode(array('typ' => 'JWT', 'alg' => 'ES256')));
  $c = b64u_enc(json_encode(array('aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $subject)));
  openssl_sign("$h.$c", $sig, $privPem, OPENSSL_ALGO_SHA256);
  return "$h.$c." . b64u_enc(der_vers_brut($sig));
}
// Chiffrement du message pour un abonné (RFC 8291)
function chiffrer($texte, $uaPub, $auth) {
  list($eph, $asPub) = nouvelle_cle();
  $secret = openssl_pkey_derive(openssl_pkey_get_public(pub_pem($uaPub)), $eph, 32);
  if ($secret === false) return null;
  $ikm = hash_hkdf('sha256', $secret, 32, "WebPush: info\0" . $uaPub . $asPub, $auth);
  $sel = random_bytes(16);
  $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $sel);
  $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $sel);
  $ct = openssl_encrypt($texte . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
  return $sel . pack('N', 4096) . chr(65) . $asPub . $ct . $tag;
}

if (PHP_SAPI === 'cli') return; // inclus par les tests

$a = isset($_GET['a']) ? $_GET['a'] : '';
if ($a === 'gen') {
  list($k, $pt, $pem) = nouvelle_cle();
  echo json_encode(array('pub' => b64u_enc($pt), 'priv' => $pem));
  exit;
}
if ($a !== 'send' || $_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(400); echo '{"ok":false}'; exit; }
$req = json_decode(file_get_contents('php://input'), true);
if (!is_array($req) || !isset($req['vapid']['pub'], $req['vapid']['priv'], $req['subs'], $req['payload'])) { http_response_code(400); echo '{"ok":false}'; exit; }
$payload = (string)$req['payload'];
if (strlen($payload) > 2000 || !is_array($req['subs']) || count($req['subs']) > 10) { http_response_code(400); echo '{"ok":false}'; exit; }
$subject = isset($req['subject']) ? (string)$req['subject'] : 'mailto:labs@nider.com';
$res = array();
foreach ($req['subs'] as $s) {
  $ep = isset($s['endpoint']) ? (string)$s['endpoint'] : '';
  $u = parse_url($ep);
  if (!$u || $u['scheme'] !== 'https' || empty($u['host'])) { $res[] = array('endpoint' => $ep, 'code' => 0); continue; }
  $corps = chiffrer($payload, b64u_dec($s['keys']['p256dh']), b64u_dec($s['keys']['auth']));
  if ($corps === null) { $res[] = array('endpoint' => $ep, 'code' => 0); continue; }
  $jwt = jwt_vapid('https://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : ''), $subject, $req['vapid']['priv']);
  $ch = curl_init($ep);
  curl_setopt_array($ch, array(
    CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corps, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => array('Content-Type: application/octet-stream', 'Content-Encoding: aes128gcm', 'TTL: 43200', 'Urgency: high',
      'Authorization: vapid t=' . $jwt . ', k=' . $req['vapid']['pub'])
  ));
  curl_exec($ch);
  $res[] = array('endpoint' => $ep, 'code' => curl_getinfo($ch, CURLINFO_HTTP_CODE));
  curl_close($ch);
}
echo json_encode(array('ok' => true, 'res' => $res));
