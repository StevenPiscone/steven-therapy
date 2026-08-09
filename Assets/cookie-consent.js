// Bandeau de consentement cookies : GA4 et Meta Pixel ne se chargent
// qu'apres acceptation. Choix stocke en local, redemande jamais tant
// qu'il n'est pas efface via "Gerer les cookies" ou le stockage du navigateur.
(function () {
  var CONSENT_KEY = 'steventherapy_cookie_consent';
  var GA_ID = 'G-5BYWHV033K';
  var FB_PIXEL_ID = '982520081453666';

  function loadAnalytics() {
    if (window.__steventherapyAnalyticsLoaded) return;
    window.__steventherapyAnalyticsLoaded = true;

    var gaScript = document.createElement('script');
    gaScript.async = true;
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(gaScript);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID);

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', FB_PIXEL_ID);
    fbq('track', 'PageView');
  }

  function buildBanner() {
    var banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
      '<p class="cookie-banner-text">Ce site utilise des cookies de mesure d\'audience et publicitaires (Google Analytics, Meta). ' +
      '<a href="confidentialite.html">En savoir plus</a></p>' +
      '<div class="cookie-banner-actions">' +
      '<button type="button" id="cookie-refuse" class="cookie-btn cookie-btn-secondary">Refuser</button>' +
      '<button type="button" id="cookie-accept" class="cookie-btn cookie-btn-primary">Accepter</button>' +
      '</div></div>';
    document.body.appendChild(banner);

    document.getElementById('cookie-accept').addEventListener('click', function () {
      try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch (e) {}
      loadAnalytics();
      banner.remove();
    });
    document.getElementById('cookie-refuse').addEventListener('click', function () {
      try { localStorage.setItem(CONSENT_KEY, 'rejected'); } catch (e) {}
      banner.remove();
    });
  }

  function init() {
    var consent = null;
    try { consent = localStorage.getItem(CONSENT_KEY); } catch (e) {}

    if (consent === 'accepted') {
      loadAnalytics();
    } else if (consent !== 'rejected') {
      buildBanner();
    }
  }

  // Expose un moyen de revenir sur son choix depuis le lien "Gerer les cookies" du footer.
  window.steventherapyResetCookieConsent = function () {
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
    var existing = document.getElementById('cookie-banner');
    if (existing) existing.remove();
    buildBanner();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
