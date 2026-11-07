/**
 * Between-games slideshow (slides.html).
 *
 * Rotates the images listed in CONFIG.slideshow.slides, skipping any slide
 * whose `days` don't include today's stream day, and prints the top donor's
 * license-plate text from the Google Sheet onto the plate slide.
 */
import { CONFIG } from './config.js';
import { fetchPlateText, loadPlateFont } from './plate.js';

const SHOW = CONFIG.slideshow;
const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage');

const seconds = Number(params.get('seconds')) || SHOW.seconds;
stage.style.setProperty('--fade', `${SHOW.fadeMs}ms`);

// ---- Fit the 1920 x 1080 stage to the source ------------------------------
function fitStage() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.setProperty('--scale', String(scale));
}
window.addEventListener('resize', fitStage);
fitStage();

// ---- Stream day -----------------------------------------------------------
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDayOverride(value) {
  if (value == null || value === '') return null;
  if (/^[0-6]$/.test(value)) return Number(value);
  const i = DAY_NAMES.indexOf(value.slice(0, 3).toLowerCase());
  return i === -1 ? null : i;
}
const dayOverride = parseDayOverride(params.get('day'));

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, weekday: 'short' });

/**
 * The stream day, 0 = Sunday. Before `dayRolloverHour` it is still the
 * previous day, so a Friday stream that runs to 1:30am keeps Friday's slides.
 */
function streamDay(now = Date.now()) {
  if (dayOverride !== null) return dayOverride;
  const shifted = new Date(now - SHOW.dayRolloverHour * 3600 * 1000);
  return DAY_NAMES.indexOf(weekdayFmt.format(shifted).slice(0, 3).toLowerCase());
}

function isEligible(slide, day) {
  return !Array.isArray(slide.days) || slide.days.includes(day);
}

// ---- Build the slides ------------------------------------------------------
let plateText = null;

const slides = SHOW.slides.map((slide) => {
  const el = document.createElement('section');
  el.className = 'slide';
  const img = document.createElement('img');
  img.src = SHOW.folder + slide.file;
  img.alt = '';
  img.decoding = 'async';
  el.append(img);

  if (slide.plate) {
    const plate = document.createElement('div');
    plate.className = 'plate';
    plateText = document.createElement('span');
    plateText.className = 'plate__text';
    plate.append(plateText);
    el.append(plate);
  }

  stage.append(el);
  return { ...slide, el };
});

// ---- Rotation ---------------------------------------------------------------
let current = -1;

/** The next slide allowed today, in config order, after `from`. */
function nextIndex(from) {
  const day = streamDay();
  for (let step = 1; step <= slides.length; step += 1) {
    const i = (from + step + slides.length) % slides.length;
    if (isEligible(slides[i], day)) return i;
  }
  return -1;
}

function show(i) {
  if (i === current) return;
  slides[current]?.el.classList.remove('is-active');
  current = i;
  slides[current]?.el.classList.add('is-active');
}

const startAt = params.get('start');
const firstIndex = startAt ? slides.findIndex((s) => s.file.includes(startAt)) : -1;
show(firstIndex !== -1 && isEligible(slides[firstIndex], streamDay()) ? firstIndex : nextIndex(-1));
setInterval(() => show(nextIndex(current)), seconds * 1000);

// ---- License plate ----------------------------------------------------------
const PLATE = SHOW.plate;
const PLATE_MAX_WIDTH = 1380; // inside the 1470px plate box, clear of the bolt holes
const PLATE_FONT_SIZE = 340;

function fitPlate() {
  if (!plateText) return;
  plateText.style.fontSize = `${PLATE_FONT_SIZE}px`;
  const width = plateText.scrollWidth;
  if (width > PLATE_MAX_WIDTH) {
    plateText.style.fontSize = `${Math.floor((PLATE_FONT_SIZE * PLATE_MAX_WIDTH) / width)}px`;
  }
}

async function refreshPlate() {
  if (!plateText || !PLATE?.sheetId) return;
  try {
    const text = await fetchPlateText(PLATE);
    if (text !== plateText.textContent) {
      plateText.textContent = text;
      fitPlate();
    }
  } catch (err) {
    // Keep showing the last good text; the next poll will try again.
    console.warn('License plate text could not be read:', err.message);
  }
}

if (plateText) {
  loadPlateFont(PLATE, stage).then(() => document.fonts.ready).then(fitPlate);
  refreshPlate();
  setInterval(refreshPlate, (PLATE.refreshSeconds || 30) * 1000);
}
