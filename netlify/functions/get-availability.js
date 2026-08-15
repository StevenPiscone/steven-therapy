// Feature 2 : le bot ne propose que des creneaux reellement libres, en lisant
// (lecture seule, freebusy) l'agenda Google de Steven via un compte de service.
// Aucune ecriture, aucune creation de RDV : la reservation reste finalisee a
// la main par Steven via le lien WhatsApp genere par le front-end.

const { google } = require('googleapis');
const { DateTime } = require('luxon');
const { isAllowedOrigin, jsonResponse } = require('./_shared');

const TIMEZONE = 'Europe/Paris';
const SLOT_STEP_MINUTES = 60;
const MIN_LEAD_HOURS = 3; // pas de creneau propose dans les 3h qui suivent
const BUFFER_BEFORE_MINUTES = 60; // marge avant un rdv existant (temps de trajet pour y arriver)
const BUFFER_AFTER_MINUTES = 60; // marge apres un rdv existant (temps de trajet pour repartir)
const MIN_DURATION = 30;
const MAX_DURATION = 120;

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Heures de debut de creneau possibles pour Steven, par jour de la semaine (Luxon .weekday :
// 1=lundi ... 7=dimanche). Liste explicite d'heures, pas une plage : chaque heure listee est
// bookable quelle que soit la duree demandee (pas de recul de l'heure de fin selon la duree).
function getWorkHours(weekday) {
  if (weekday === 1 || weekday === 3) return [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]; // lundi, mercredi : dernier creneau a 18h
  if (weekday === 6) return [9, 15, 16, 17, 18, 19, 20, 21, 22, 23]; // samedi : un creneau a 9h, reprise a 15h
  return [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]; // mardi, jeudi, vendredi, dimanche
}

// Tous les creneaux libres d'un jour donne (pas de plafond ici, le plafond se fait a
// l'affichage une fois la periode choisie par le visiteur). Reutilise par les deux modes.
function computeFreeSlotsForDay(now, dayOffset, minutes, paddedBusy, earliestAllowed) {
  const day = now.plus({ days: dayOffset }).startOf('day');
  const daySlots = [];
  const hours = getWorkHours(day.weekday);

  for (const hour of hours) {
    const slotStart = day.plus({ hours: hour });
    const slotEnd = slotStart.plus({ minutes });

    if (slotStart.toMillis() < earliestAllowed) continue;

    const blocked = paddedBusy.some((b) => overlaps(slotStart.toMillis(), slotEnd.toMillis(), b.start, b.end));
    if (blocked) continue;

    daySlots.push(slotStart.toFormat("H'h'mm"));
  }
  return daySlots;
}

// Regroupe des creneaux ("9h00", "14h30"...) par moment de la journee.
// Matin : 9h-12h inclus. Apres-midi : 13h-18h inclus. Soir : 19h-23h inclus.
function groupByPeriode(slots) {
  const groupes = { matin: [], apresmidi: [], soir: [] };
  slots.forEach((s) => {
    const heure = parseInt(s.split('h')[0], 10);
    if (heure <= 12) groupes.matin.push(s);
    else if (heure <= 18) groupes.apresmidi.push(s);
    else groupes.soir.push(s);
  });
  return groupes;
}

exports.handler = async (event) => {
  if (!isAllowedOrigin(event.headers)) {
    return jsonResponse(403, { error: 'Origine non autorisee' });
  }

  const requestedMinutes = parseInt((event.queryStringParameters || {}).minutes, 10);
  const minutes = Math.min(Math.max(requestedMinutes || 60, MIN_DURATION), MAX_DURATION);

  // Le visiteur choisit une date precise (domicile ou cabinet), on verifie cette date-la,
  // et si rien n'est libre on regarde J-1/J+1 comme alternatives proches.
  const requestedDate = (event.queryStringParameters || {}).date;
  if (!requestedDate) {
    return jsonResponse(400, { error: 'Date requise' });
  }

  try {
    const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!privateKey || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !calendarId) {
      throw new Error('Configuration Google Calendar manquante');
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const calendar = google.calendar({ version: 'v3', auth });
    const now = DateTime.now().setZone(TIMEZONE);

    const targetDay = DateTime.fromISO(requestedDate, { zone: TIMEZONE }).startOf('day');
    if (!targetDay.isValid) {
      return jsonResponse(400, { error: 'Date invalide' });
    }
    const dayOffset = Math.round(targetDay.diff(now.startOf('day'), 'days').days);
    if (dayOffset < 0) {
      return jsonResponse(400, { error: 'Cette date est passee' });
    }

    const timeMax = now.plus({ days: dayOffset + 2 }).toISO(); // couvre J-1 a J+1
    const fb = await calendar.freebusy.query({
      requestBody: { timeMin: now.toISO(), timeMax, timeZone: TIMEZONE, items: [{ id: calendarId }] },
    });
    const busy = (fb.data.calendars && fb.data.calendars[calendarId] && fb.data.calendars[calendarId].busy) || [];
    const paddedBusy = busy.map((b) => ({
      start: new Date(b.start).getTime() - BUFFER_BEFORE_MINUTES * 60000,
      end: new Date(b.end).getTime() + BUFFER_AFTER_MINUTES * 60000,
    }));
    const earliestAllowed = now.plus({ hours: MIN_LEAD_HOURS }).toMillis();

    const targetSlots = computeFreeSlotsForDay(now, dayOffset, minutes, paddedBusy, earliestAllowed);
    const targetLabel = capitalize(targetDay.setLocale('fr').toFormat('cccc d MMMM'));

    if (targetSlots.length) {
      return jsonResponse(200, { disponible: true, jour: targetLabel, creneauxParPeriode: groupByPeriode(targetSlots) });
    }

    const alternatives = [];
    for (const altOffset of [dayOffset - 1, dayOffset + 1]) {
      if (altOffset < 0) continue;
      const altSlots = computeFreeSlotsForDay(now, altOffset, minutes, paddedBusy, earliestAllowed);
      if (altSlots.length) {
        const altDay = now.plus({ days: altOffset }).startOf('day');
        alternatives.push({
          jour: capitalize(altDay.setLocale('fr').toFormat('cccc d MMMM')),
          creneauxParPeriode: groupByPeriode(altSlots),
        });
      }
    }

    return jsonResponse(200, { disponible: false, jour: targetLabel, alternatives });
  } catch (err) {
    console.error('get-availability error:', err);
    return jsonResponse(502, { error: 'Disponibilites indisponibles pour le moment' });
  }
};
