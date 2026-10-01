// ─── CHATBOT ───
// Widget partage sur toutes les pages du site (Assets/chatbot.css + ce fichier,
// + le fragment HTML #chatbot-btn/#chatbot-window duplique en fin de <body>).
// Les creneaux proposes viennent en direct de /.netlify/functions/get-availability
// (lecture de l'agenda Google en lecture seule) - plus de liste codee en dur.

let chatOpen = false;
let chatSel = {};
let lastAskAt = 0;
// Pile des etapes traversees, pour le bouton retour. Les sous-etapes du choix de
// creneau (periode, creneau) n'y figurent pas : elles ont leur propre retour interne.
let chatHistory = [];
let chatCurrentStep = null;
const ASK_COOLDOWN_MS = 8000;

// Fait toujours defiler jusqu'en bas (messages + boutons), quelle que soit la fonction
// qui vient de modifier la conversation, plutot que de rappeler un scroll a la main
// dans chaque fonction d'affichage (risque d'en oublier une).
const chatBodyEl = document.getElementById('chatBody');
function scrollChatToBottom() {
  chatBodyEl.scrollTop = chatBodyEl.scrollHeight;
}
new MutationObserver(scrollChatToBottom).observe(chatBodyEl, { childList: true, subtree: true });

const WA_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

const flow = {
  entry: {
    msg: "Salut champion 👋 Je suis l'assistant de Steven. Prêt à mieux récupérer ? Dis-moi ce qu'il te faut.",
    choices: [
      { label: "❓ Poser une question", key: null, val: null, next: "faq" },
      { label: "📅 Réserver une séance", key: null, val: null, next: "start" }
    ]
  },
  faq: {
    msg: "Dis-moi tout, je t'écoute 👇",
    isFreeText: true
  },
  start: {
    msg: "Tu veux quel type de massage ?",
    choices: [
      { label: "💪 Deep Tissue", key: "type", val: "Deep Tissue", next: "format" },
      { label: "🏃 Massage Sportif", key: "type", val: "Massage Sportif", next: "format" }
    ]
  },
  format: {
    msg: "Parfait. Tu préfères quelle formule ?",
    choices: [
      { label: "🏠 À domicile", key: "format", val: "à domicile", next: "duree" },
      { label: "🛋️ En cabinet", key: "format", val: "en cabinet", next: "duree" },
      { label: "🏋️ En salle", key: "format", val: "en salle", next: "salle" }
    ]
  },
  date_domicile: {
    msg: "Quelle date tu souhaites ?",
    isDateInput: true
  },
  duree: {
    msg: "Et quelle durée ?",
    choices: () => {
      const nextStep = "date_domicile"; // meme parcours date -> periode -> creneau pour domicile et cabinet
      const all = [
        { label: "30 min · 40€", key: "duree", val: "30 min (40€) — cabinet uniquement", minutes: 30, next: nextStep },
        { label: "45 min · 60€", key: "duree", val: "45 min (60€)", minutes: 45, next: nextStep },
        { label: "1h · 80€", key: "duree", val: "1h (80€)", minutes: 60, next: nextStep },
        { label: "1h30 · 120€", key: "duree", val: "1h30 (120€)", minutes: 90, next: nextStep },
        { label: "2h · 150€", key: "duree", val: "2h (150€)", minutes: 120, next: nextStep }
      ];
      // 30 min reserve au cabinet uniquement (non rentable en deplacement, voir CONTEXT.md)
      return chatSel.format === "à domicile" ? all.filter(c => c.minutes !== 30) : all;
    }
  },
  salle: {
    msg: "J'interviens dans 3 salles. Laquelle te correspond le mieux ?",
    choices: [
      { label: "On Air Ivry-sur-Seine (94)", key: "salle", val: "On Air Ivry-sur-Seine", next: "salle_confirm" },
      { label: "On Air La Ville-du-Bois (91)", key: "salle", val: "On Air La Ville-du-Bois", next: "salle_confirm" },
      { label: "Keepcool Savigny-sur-Orge (91)", key: "salle", val: "Keepcool Savigny-sur-Orge", next: "salle_confirm" }
    ]
  },
  nom: {
    msg: "Parfait, c'est à quel nom ?",
    isTextInput: true,
    key: "nom",
    placeholder: "Ton nom et prénom",
    next: "email"
  },
  email: {
    msg: "Ton email, pour que je t'envoie l'invitation dans ton agenda ?",
    isTextInput: true,
    key: "email",
    placeholder: "ton@email.com",
    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    invalidMsg: "Ça ne ressemble pas à une adresse email valide, tu peux revérifier ?",
    next: () => chatSel.format === "à domicile" ? "adresse" : "confirm"
  },
  adresse: {
    msg: "Et ton adresse complète, pour que je sache où venir ?",
    isTextInput: true,
    key: "adresse",
    placeholder: "Numéro, rue, ville, code postal",
    next: "confirm"
  }
};

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatbot-window').classList.toggle('open', chatOpen);
  if (chatOpen) {
    document.getElementById('chatNotif').style.display = 'none';
    if (!document.getElementById('chatMessages').children.length) startChat();
  }
}

function startChat() {
  chatSel = {};
  showStep('entry');
}

// Reinitialise et ouvre le chat : utilise par tous les raccourcis d'entree
// (boutons "rendez-vous", "offre decouverte", "poser une question"...).
function resetAndOpenChat() {
  chatOpen = true;
  document.getElementById('chatbot-window').classList.add('open');
  document.getElementById('chatNotif').style.display = 'none';
  chatSel = {};
  chatHistory = [];
  chatCurrentStep = null;
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('chatChoices').innerHTML = '';
}

// Raccourci pour tous les boutons "rendez-vous" du site (header, hero, bloc
// contact...) : ouvre le chat direct sur l'etape de reservation, sans passer
// par le choix question/reservation. offre="decouverte" tague la demande
// (bouton "Offre decouverte - 49€") pour que Steven la voie dans le recap.
function openBookingChat(offre) {
  resetAndOpenChat();
  if (offre === 'decouverte') {
    chatSel.offre = 'decouverte';
    setTimeout(() => {
      botMsg("Tu profites de l'offre découverte 🎁 : 1h de deep tissue ou sportif à 49€ au lieu de 80€, réservée à ta première séance.");
      showStep('start');
    }, 300);
  } else {
    showStep('start', "Salut champion, je vois que t'es prêt à mieux récupérer. Tu veux quel type de massage ?");
  }
}

// Raccourci pour les boutons "poser une question" (FAQ, articles...) : ouvre
// le chat direct sur la saisie libre de question.
function openFaqChat() {
  resetAndOpenChat();
  showStep('faq');
}

function botMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg-bot';
  el.textContent = text;
  document.getElementById('chatMessages').appendChild(el);
}

function userMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg-user';
  el.textContent = text;
  document.getElementById('chatMessages').appendChild(el);
}

// Revient a l'etape precedente reellement traversee. La pile gere seule les
// branchements (offre decouverte qui saute la duree, domicile/cabinet/salle).
function goBack() {
  const prev = chatHistory.pop();
  if (prev) showStep(prev, undefined, true);
}

function appendBackButton(el) {
  if (!chatHistory.length) return;
  const back = document.createElement('button');
  back.className = 'chat-btn chat-back-btn';
  back.innerHTML = '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13 7H1M6 2 1 7l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  back.title = 'Retour';
  back.setAttribute('aria-label', 'Retour');
  back.onclick = goBack;
  el.appendChild(back);
}

function setChoices(choices) {
  const el = document.getElementById('chatChoices');
  el.innerHTML = '';
  choices.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'chat-btn';
    btn.textContent = c.label;
    btn.onclick = () => pick(c);
    el.appendChild(btn);
  });
  appendBackButton(el);
}

function showStep(key, overrideMsg, isBack) {
  if (key === 'confirm') { showConfirm(); return; }
  const step = flow[key];
  if (!step) return;
  if (!isBack && chatCurrentStep && chatCurrentStep !== key) chatHistory.push(chatCurrentStep);
  chatCurrentStep = key;
  setTimeout(() => {
    botMsg(overrideMsg || step.msg);
    if (step.isFreeText) renderFaqInputUI();
    else if (step.isTextInput) renderTextInputUI(step);
    else if (step.isDateInput) renderDateInputUI();
    else setChoices(typeof step.choices === 'function' ? step.choices() : step.choices);
  }, 300);
}

function renderFaqInputUI() {
  const el = document.getElementById('chatChoices');
  el.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'chat-input-row';

  // Zone multiligne : une question tient rarement sur une ligne, et l'utilisateur
  // doit pouvoir relire ce qu'il ecrit avant d'envoyer.
  const input = document.createElement('textarea');
  input.className = 'chat-input chat-textarea';
  input.placeholder = 'Ta question...';
  input.maxLength = 300;
  input.rows = 2;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = 'Envoyer';
  sendBtn.onclick = () => askFaq(input.value, sendBtn, input);

  // Entree envoie, Maj+Entree passe a la ligne : convention des messageries.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askFaq(input.value, sendBtn, input);
    }
  });

  // Le champ grandit avec le texte jusqu'a la limite posee en CSS.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  row.appendChild(input);
  row.appendChild(sendBtn);
  el.appendChild(row);

  // Le prompt systeme invite le bot a renvoyer vers la reservation : le bouton
  // doit donc exister sur cet ecran, pas seulement sur l'accueil du chat.
  const reserverBtn = document.createElement('button');
  reserverBtn.className = 'chat-btn';
  reserverBtn.textContent = '📅 Réserver une séance';
  reserverBtn.onclick = () => { el.innerHTML = ''; showStep('start'); };
  el.appendChild(reserverBtn);

  // Pas de bouton retour ici, choix de Steven : sur l'ecran de questions la seule
  // action proposee est la reservation.

  input.focus();
}

function renderTextInputUI(step) {
  const el = document.getElementById('chatChoices');
  el.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'chat-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = step.placeholder || '';
  input.maxLength = 200;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = 'Envoyer';
  sendBtn.onclick = () => submitTextStep(step, input.value);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTextStep(step, input.value);
  });

  row.appendChild(input);
  row.appendChild(sendBtn);
  el.appendChild(row);
  appendBackButton(el);
  input.focus();
}

function submitTextStep(step, rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return;
  if (step.validate && !step.validate(value)) {
    botMsg(step.invalidMsg || "Ça ne semble pas correct, tu peux réessayer ?");
    return;
  }
  userMsg(value);
  chatSel[step.key] = value;
  const nextKey = typeof step.next === 'function' ? step.next() : step.next;
  showStep(nextKey);
}

async function askFaq(rawQuestion, sendBtn, inputEl) {
  const question = (rawQuestion || '').trim();
  if (!question) return;
  if (Date.now() - lastAskAt < ASK_COOLDOWN_MS) {
    botMsg("Patiente quelques secondes avant une nouvelle question 🙏");
    return;
  }
  lastAskAt = Date.now();
  userMsg(question);
  sendBtn.disabled = true;
  inputEl.disabled = true;

  try {
    const res = await fetch('/.netlify/functions/ask-faq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.answer) {
      botMsg(data.answer);
      renderFaqInputUI();
    } else {
      botMsg(data.error || "Je n'ai pas pu répondre. Contacte Steven directement sur WhatsApp.");
      waLink('Contacter sur WhatsApp', encodeURIComponent("Bonjour Steven, j'ai une question : " + question));
    }
  } catch (err) {
    botMsg("Je n'ai pas pu répondre. Contacte Steven directement sur WhatsApp.");
    waLink('Contacter sur WhatsApp', encodeURIComponent("Bonjour Steven, j'ai une question : " + question));
  }
}

// ─── Parcours domicile/cabinet : date precise choisie par le visiteur ───
const PERIODE_LABELS = { matin: '🌅 Le matin', apresmidi: '☀️ L\'après-midi', soir: '🌙 Le soir' };

function renderDateInputUI() {
  const el = document.getElementById('chatChoices');
  el.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'chat-input-row';

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'chat-input';
  input.min = new Date().toLocaleDateString('sv-SE');
  // Bloque la saisie clavier sans passer par readonly/disabled, qui desactivent
  // aussi le picker calendrier natif dans Chrome (teste, ca cassait tout).
  input.addEventListener('keydown', (e) => e.preventDefault());
  input.addEventListener('paste', (e) => e.preventDefault());

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = 'Envoyer';
  sendBtn.onclick = () => checkDateAvailability(input.value);

  row.appendChild(input);
  row.appendChild(sendBtn);
  el.appendChild(row);

  const back = document.createElement('button');
  back.className = 'chat-btn chat-back-btn';
  back.innerHTML = '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13 7H1M6 2 1 7l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  back.title = 'Retour';
  back.setAttribute('aria-label', 'Retour');
  back.onclick = goBack;
  el.appendChild(back);
}

async function checkDateAvailability(dateStr) {
  if (!dateStr) return;
  const humanDate = capitalizeFirst(new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
  userMsg("📅 " + humanDate);
  document.getElementById('chatChoices').innerHTML = '';
  botMsg("Je vérifie mes disponibilités...");

  let data = null;
  try {
    const res = await fetch('/.netlify/functions/get-availability?minutes=' + (chatSel.dureeMinutes || 60) + '&date=' + dateStr);
    const json = await res.json().catch(() => ({}));
    if (res.ok) data = json;
  } catch (err) {
    // repli WhatsApp gere ci-dessous
  }

  if (!data) {
    const s = chatSel;
    botMsg("Je n'arrive pas à vérifier mes disponibilités en direct. Contacte-moi sur WhatsApp 👇");
    waLink('Contacter sur WhatsApp', encodeURIComponent(
      "Bonjour Steven, je souhaite réserver une séance :\n" +
      "- Type : " + s.type + "\n" +
      "- Format : " + s.format + "\n" +
      "- Durée : " + s.duree
    ));
    return;
  }

  setTimeout(() => {
    if (data.disponible) {
      chatSel._creneauxParPeriode = data.creneauxParPeriode;
      chatSel._jourChoisi = data.jour;
      botMsg("Il y a de la dispo le " + data.jour + ". Tu préfères quel moment ?");
      renderPeriodeChoices();
    } else {
      renderDateIndisponible(data);
    }
  }, 300);
}

function renderPeriodeChoices() {
  const el = document.getElementById('chatChoices');
  el.innerHTML = '';
  const groupes = chatSel._creneauxParPeriode;
  Object.keys(PERIODE_LABELS).forEach((cle) => {
    if (groupes[cle] && groupes[cle].length) {
      const btn = document.createElement('button');
      btn.className = 'chat-btn';
      btn.textContent = PERIODE_LABELS[cle];
      btn.onclick = () => renderCreneauxPeriode(cle);
      el.appendChild(btn);
    }
  });
  const back = document.createElement('button');
  back.className = 'chat-btn chat-back-btn';
  back.innerHTML = '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13 7H1M6 2 1 7l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  back.title = 'Retour';
  back.setAttribute('aria-label', 'Retour');
  back.onclick = () => renderDateInputUI();
  el.appendChild(back);
}

function renderCreneauxPeriode(cle) {
  userMsg(PERIODE_LABELS[cle]);
  document.getElementById('chatChoices').innerHTML = '';
  setTimeout(() => {
    botMsg("Quel créneau ?");
    const el = document.getElementById('chatChoices');
    const jour = chatSel._jourChoisi;
    chatSel._creneauxParPeriode[cle].forEach((slot) => {
      const btn = document.createElement('button');
      btn.className = 'chat-btn';
      btn.textContent = "🕐 " + slot;
      btn.onclick = () => pick({ key: "creneau", val: jour + " à " + slot, next: "nom", label: "🕐 " + slot });
      el.appendChild(btn);
    });
    const back = document.createElement('button');
    back.className = 'chat-btn chat-back-btn';
    back.innerHTML = '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13 7H1M6 2 1 7l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    back.title = 'Retour';
    back.setAttribute('aria-label', 'Retour');
    back.onclick = () => renderPeriodeChoices();
    el.appendChild(back);
  }, 300);
}

function choisirJourAlternatif(alt) {
  chatSel._creneauxParPeriode = alt.creneauxParPeriode;
  chatSel._jourChoisi = alt.jour;
  userMsg("📅 " + alt.jour);
  document.getElementById('chatChoices').innerHTML = '';
  setTimeout(() => {
    botMsg("Tu préfères quel moment ?");
    renderPeriodeChoices();
  }, 300);
}

function renderDateIndisponible(data) {
  botMsg("Pas de dispo le " + data.jour + (data.alternatives.length ? ". Voici les jours juste à côté :" : ", ni les jours juste à côté."));
  setTimeout(() => {
    const el = document.getElementById('chatChoices');
    el.innerHTML = '';
    data.alternatives.forEach((alt) => {
      const btn = document.createElement('button');
      btn.className = 'chat-btn';
      btn.textContent = "📅 " + alt.jour;
      btn.onclick = () => choisirJourAlternatif(alt);
      el.appendChild(btn);
    });
    const autreDate = document.createElement('button');
    autreDate.className = 'chat-btn';
    autreDate.textContent = '📆 Choisir une autre date';
    autreDate.onclick = () => renderDateInputUI();
    el.appendChild(autreDate);
    const back = document.createElement('button');
    back.className = 'chat-btn chat-back-btn';
    back.innerHTML = '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13 7H1M6 2 1 7l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    back.title = 'Retour';
    back.setAttribute('aria-label', 'Retour');
    back.onclick = goBack;
    el.appendChild(back);
  }, 300);
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function waLink(text, msgEncoded) {
  const a = document.createElement('a');
  a.href = 'https://wa.me/33612829315?text=' + msgEncoded;
  a.target = '_blank';
  a.className = 'chat-wa-btn';
  a.innerHTML = WA_SVG + ' ' + text;
  document.getElementById('chatChoices').innerHTML = '';
  document.getElementById('chatChoices').appendChild(a);
}

function pick(choice) {
  if (choice.key) chatSel[choice.key] = choice.val;
  if (choice.minutes) chatSel.dureeMinutes = choice.minutes;
  userMsg(choice.label);
  document.getElementById('chatChoices').innerHTML = '';

  if (choice.next === 'salle_confirm') {
    setTimeout(() => {
      botMsg("Je t'envoie ça à Steven directement 👇");
      const waMsg = encodeURIComponent(
        "Bonjour Steven, je suis intéressé(e) par l'événement en salle de sport chez " + chatSel.salle + "."
      );
      waLink("Contacter sur WhatsApp", waMsg);
    }, 300);
    return;
  }

  // L'offre decouverte est fixee a 1h a 49E : on saute l'etape duree plutot que
  // d'afficher la grille de tarifs pleins, qui contredirait le prix annonce a
  // l'ouverture du chat (49E promis, 80E affiche trois ecrans plus loin).
  if (choice.next === 'duree' && chatSel.offre === 'decouverte') {
    chatSel.duree = '1h';
    chatSel.dureeMinutes = 60;
    showStep('date_domicile', "Ta séance découverte dure 1h. Quelle date tu souhaites ?");
    return;
  }

  showStep(choice.next);
}

function showConfirm() {
  const s = chatSel;
  setTimeout(() => {
    botMsg("Voici ta demande :");
    setTimeout(() => {
      let recap = (s.offre === 'decouverte' ? "🎁 Offre découverte — 49€\n" : "") +
        s.nom + "\n" + s.email + (s.adresse ? "\n" + s.adresse : "") +
        "\n\n" + s.type + " · " + s.format + " · " + s.duree +
        "\nCréneau : " + s.creneau;
      botMsg(recap);
      setTimeout(() => {
        botMsg("Je t'envoie ça à Steven directement 👇");
        const waMsg = encodeURIComponent(
          (s.offre === 'decouverte' ? "🎁 Offre découverte (1h à 49€) :\n" : "") +
          "Bonjour Steven, je souhaite réserver une séance :\n" +
          "- Nom : " + s.nom + "\n" +
          "- Email : " + s.email + "\n" +
          "- Type : " + s.type + "\n" +
          "- Format : " + s.format + "\n" +
          (s.adresse ? "- Adresse : " + s.adresse + "\n" : "") +
          "- Durée : " + s.duree + "\n" +
          "- Créneau souhaité : " + s.creneau
        );
        waLink("Finaliser sur WhatsApp →", waMsg);
      }, 500);
    }, 500);
  }, 300);
}

// Shake au démarrage après 5s, puis toutes les 30s si fermé
function shake() {
  if (!chatOpen) {
    const btn = document.getElementById('chatbot-btn');
    btn.classList.add('shake');
    setTimeout(() => btn.classList.remove('shake'), 700);
  }
}
setTimeout(shake, 5000);
setInterval(shake, 30000);
