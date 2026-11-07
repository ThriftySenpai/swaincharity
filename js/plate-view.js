/**
 * Mini license plate (plate.html): the top donor's plate text, read live from
 * the same sheet cell as the slideshow's plate slide (CONFIG.slideshow.plate).
 */
import { CONFIG } from './config.js';
import { fetchPlateText, loadPlateFont } from './plate.js';

const PLATE = CONFIG.slideshow?.plate;
const params = new URLSearchParams(window.location.search);
const box = document.getElementById('plate');
const text = document.getElementById('plate-text');

const chroma = params.get('chroma');
if (chroma) document.body.style.background = `#${chroma.replace(/^#/, '')}`;

/** Shrinks long text to fit the plate's blank area rather than clip it. */
function fitPlate() {
  text.style.fontSize = '';
  const room = text.parentElement.clientWidth;
  if (text.scrollWidth > room) {
    const base = parseFloat(getComputedStyle(text).fontSize);
    text.style.fontSize = `${Math.floor((base * room) / text.scrollWidth)}px`;
  }
}

function show(value) {
  if (value !== text.textContent) text.textContent = value;
  box.hidden = value === '';
  fitPlate();
}

async function refreshPlate() {
  try {
    show(await fetchPlateText(PLATE));
  } catch (err) {
    // Keep showing the last good text; the next poll will try again.
    console.warn('License plate text could not be read:', err.message);
  }
}

window.addEventListener('resize', fitPlate);
// Text measured in the fallback face fits wrong once Oswald arrives.
document.fonts.addEventListener('loadingdone', fitPlate);
loadPlateFont(PLATE, document.body).then(() => document.fonts.ready).then(fitPlate);

if (PLATE?.sheetId) {
  refreshPlate();
  setInterval(refreshPlate, Math.max(20, PLATE.refreshSeconds || 30) * 1000);
} else {
  console.warn('No license-plate sheet set in CONFIG.slideshow.plate.');
}
