/**
 * The top donor's license-plate text, shared by the slideshow's plate slide
 * (slides.html) and the mini plate on the bottom bar (bar.html).
 *
 * The text is one cell of a link-shared Google Sheet, read through the gviz
 * CSV endpoint, which needs no API key. Settings live in
 * CONFIG.slideshow.plate.
 */

/** Reads one cell of a CSV row: strips the quotes and un-doubles "" escapes. */
function parseCsvCell(csv) {
  const line = csv.trim();
  if (line.startsWith('"')) {
    const end = line.lastIndexOf('"');
    return line.slice(1, end > 0 ? end : undefined).replace(/""/g, '"');
  }
  return line.split(',')[0] ?? '';
}

/** Fetches the plate text. Throws on any failure so callers keep the last good text. */
export async function fetchPlateText(plate) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${plate.sheetId}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('headers', '0');
  url.searchParams.set('sheet', plate.tab);
  url.searchParams.set('range', plate.cell);
  url.searchParams.set('_', String(Date.now()));

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  // A sheet that isn't link-shared answers with a sign-in page, not CSV.
  if (/^\s*</.test(body)) throw new Error('sheet is not shared publicly');
  return parseCsvCell(body).trim();
}

/**
 * Loads the configured plate font, if any, as 'BCL Plate' and sets
 * --plate-font on `target` so the CSS picks it up. Resolves either way.
 */
export async function loadPlateFont(plate, target) {
  if (!plate?.font) return;
  try {
    const face = new FontFace('BCL Plate', `url("${plate.font}")`);
    document.fonts.add(await face.load());
    target.style.setProperty('--plate-font', "'BCL Plate'");
  } catch (err) {
    console.warn('License plate font could not be loaded:', err.message);
  }
}
