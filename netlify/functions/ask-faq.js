// Feature 1 : le bot repond aux questions des visiteurs a partir de la FAQ
// du site (faq-data.json), via l'API Claude. Ne repond jamais hors de ce
// contenu -> pas d'invention, redirection WhatsApp si la question sort du cadre.

const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const faqData = require('./faq-data.json');
const { isAllowedOrigin, jsonResponse, getClientIp, checkRateLimit } = require('./_shared');

const MODEL = 'claude-haiku-4-5'; // choix delibere : cout/latence adaptes a une simple Q&A
const MAX_TOKENS = 400; // plafond de cout par appel
const MAX_QUESTION_LENGTH = 500;

function buildFaqContext() {
  return faqData.map((qa) => `Q: ${qa.question}\nR: ${qa.answer}`).join('\n\n');
}

const SYSTEM_PROMPT = `Tu es l'assistant du site de Steven Therapy (massage sportif et deep tissue, Paris et Ile-de-France).

Reponds UNIQUEMENT a partir de la FAQ ci-dessous. N'invente jamais une information qui n'y figure pas.
Si la question sort du cadre de la FAQ (sujet medical serieux, information non couverte, hors perimetre du site),
dis clairement que tu ne sais pas et invite la personne a contacter Steven directement sur WhatsApp.

Si la question porte sur la reservation ou la prise de rendez-vous, oriente toujours vers le bouton
"Reserver une seance" de cette meme conversation plutot que vers WhatsApp ou un autre canal : l'objectif
est que la personne reserve directement ici.

Reponds en francais, sur un ton direct et chaleureux, en 2 a 4 phrases maximum. Aere ta reponse avec des sauts
de ligne entre les idees pour que ce soit facile a lire, et utilise des tirets (-) pour une courte liste si utile.
Pas de markdown (pas d'astérisques, pas de titres) : le texte s'affiche tel quel, sans mise en forme.

FAQ :
${buildFaqContext()}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Methode non autorisee' });
  }

  if (!isAllowedOrigin(event.headers)) {
    return jsonResponse(403, { error: 'Origine non autorisee' });
  }

  let question;
  try {
    const body = JSON.parse(event.body || '{}');
    question = typeof body.question === 'string' ? body.question.trim() : '';
  } catch (err) {
    return jsonResponse(400, { error: 'Corps de requete invalide' });
  }

  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse(400, { error: 'Question manquante ou trop longue' });
  }

  const ip = getClientIp(event.headers);
  const rateLimit = await checkRateLimit('ask-faq-rate-limit', ip);
  if (!rateLimit.allowed) {
    const message = rateLimit.reason === 'daily_cap'
      ? "Beaucoup de questions aujourd'hui ! Contacte Steven directement sur WhatsApp, il te repondra vite."
      : 'Doucement, laisse quelques minutes avant de reposer une question, ou contacte Steven sur WhatsApp.';
    return jsonResponse(429, { error: message });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });

    const answer = response.content.find((block) => block.type === 'text')?.text || '';
    if (!answer) throw new Error('Reponse vide');

    return jsonResponse(200, { answer });
  } catch (err) {
    console.error('ask-faq error:', err);
    return jsonResponse(502, { error: "Je n'ai pas pu repondre. Contacte Steven directement sur WhatsApp." });
  }
};
