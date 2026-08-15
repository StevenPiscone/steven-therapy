// Helpers partages par les fonctions du bot (ask-faq, get-availability).
// Pas de framework : Netlify Functions "classiques" (event, context) => response.

const { getStore } = require('@netlify/blobs');

const ALLOWED_ORIGINS = [
  'https://steventherapy.fr',
  'https://www.steventherapy.fr',
];

// Autorise aussi localhost, mais uniquement quand le code tourne via
// `netlify dev` (NETLIFY_DEV est positionne par le CLI, jamais en prod) -
// ca ne relache donc rien sur le site en ligne.
const DEV_ORIGINS = ['http://localhost:8888', 'http://127.0.0.1:8888'];

// Le site n'a pas de config CORS -> les appels viennent forcement du meme
// domaine via fetch('/.netlify/functions/...'). Cette verif d'Origin/Referer
// bloque les scripts externes qui appelleraient l'URL directement depuis un
// autre site, mais ne protege pas contre quelqu'un qui rejoue la requete
// depuis les outils de dev du navigateur sur steventherapy.fr lui-meme -
// c'est le role du rate-limiting ci-dessous.
function isAllowedOrigin(headers = {}) {
  const origin = (headers.origin || headers.referer || headers.Referer || '').toLowerCase();
  if (!origin) return false;
  const allowList = process.env.NETLIFY_DEV === 'true' ? ALLOWED_ORIGINS.concat(DEV_ORIGINS) : ALLOWED_ORIGINS;
  return allowList.some((allowed) => origin.startsWith(allowed));
}

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function getClientIp(headers = {}) {
  // Header fourni par Netlify avec l'IP reelle du visiteur.
  if (headers['x-nf-client-connection-ip']) return headers['x-nf-client-connection-ip'];
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

// --- Rate limiting (Netlify Blobs) ---
// Objectif : pas d'empecher 100% des abus, mais plafonner le cout maximum
// possible si quelqu'un contourne le cooldown cote client (devtools, script).
const IP_LIMIT = 8; // max requetes...
const IP_WINDOW_MS = 10 * 60 * 1000; // ...par fenetre de 10 min et par IP
const DAILY_CAP = 300; // plafond global, toutes IP confondues, par jour

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-07-16"
}

// Retourne { allowed: true } ou { allowed: false, reason: "ip_limit" | "daily_cap" }.
// Best-effort : pas de verrou atomique (Netlify Blobs n'en fournit pas), un leger
// depassement en cas de requetes simultanees est acceptable pour cet usage.
async function checkRateLimit(store_name, ip) {
  // Netlify Blobs a besoin que le projet local soit lie a un vrai site Netlify
  // (`netlify link`) pour fonctionner. En dev non lie, on laisse tout passer -
  // le rate-limiting reste pleinement actif une fois deploye en production.
  if (process.env.NETLIFY_DEV === 'true') {
    return { allowed: true };
  }

  const store = getStore(store_name);

  const dayKey = `day:${todayKey()}`;
  const dayCount = (await store.get(dayKey, { type: 'json' })) || 0;
  if (dayCount >= DAILY_CAP) {
    return { allowed: false, reason: 'daily_cap' };
  }

  const ipKey = `ip:${ip}`;
  const now = Date.now();
  const ipState = (await store.get(ipKey, { type: 'json' })) || { count: 0, windowStart: now };
  const windowExpired = now - ipState.windowStart > IP_WINDOW_MS;
  const count = windowExpired ? 0 : ipState.count;

  if (count >= IP_LIMIT) {
    return { allowed: false, reason: 'ip_limit' };
  }

  await Promise.all([
    store.setJSON(dayKey, dayCount + 1),
    store.setJSON(ipKey, { count: count + 1, windowStart: windowExpired ? now : ipState.windowStart }),
  ]);

  return { allowed: true };
}

module.exports = { isAllowedOrigin, jsonResponse, getClientIp, checkRateLimit };
