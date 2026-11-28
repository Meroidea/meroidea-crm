/**
 * Where a field sits on a page, and the field kinds. Pure; shared by browser and server.
 *
 * The browser shows a page as pdf.js draws it: rotated by the page's /Rotate, cropped to its crop
 * box, origin at the top left. A field is stored as fractions (0–1) of that displayed page, so it
 * stays put at any zoom. Stamping happens in PDF user space, which is unrotated with its origin at
 * the bottom left; `toPdfBox` converts between the two.
 */

export const FIELD_KINDS = ['signature', 'initials', 'name', 'date', 'text', 'checkbox'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  name: 'Full name',
  date: 'Date signed',
  text: 'Text',
  checkbox: 'Checkbox',
};

/** A new field's size, as fractions of a portrait A4/Letter page. */
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { width: number; height: number }> = {
  signature: { width: 0.28, height: 0.06 },
  initials: { width: 0.1, height: 0.05 },
  name: { width: 0.28, height: 0.03 },
  date: { width: 0.18, height: 0.03 },
  text: { width: 0.28, height: 0.03 },
  checkbox: { width: 0.03, height: 0.022 },
};

/** Fractions of the displayed page, top-left origin. */
export type Box = { x: number; y: number; width: number; height: number };

/** A page's crop box in PDF user space and its /Rotate. */
export type PageGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type PdfBox = {
  /** Where to anchor drawing: the displayed box's bottom-left corner, in PDF user space. */
  anchorX: number;
  anchorY: number;
  /** The box's size as the reader sees it, in PDF units. */
  width: number;
  height: number;
  /** Counter-clockwise degrees to draw at, so content reads upright on a rotated page. */
  rotate: 0 | 90 | 180 | 270;
};

export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** The page's size as displayed, in PDF units. */
export function displayedSize(page: PageGeometry): { width: number; height: number } {
  const quarter = normalizeRotation(page.rotation) % 180 !== 0;
  return quarter
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * A displayed point (PDF units, top-left origin) in PDF user space. The page is shown turned
 * clockwise by its rotation, so each case undoes that turn.
 */
export function displayedPointToPdf(
  page: PageGeometry,
  u: number,
  v: number,
): { x: number; y: number } {
  switch (normalizeRotation(page.rotation)) {
    case 0:
      return { x: page.x + u, y: page.y + page.height - v };
    case 90:
      return { x: page.x + v, y: page.y + u };
    case 180:
      return { x: page.x + page.width - u, y: page.y + v };
    case 270:
      return { x: page.x + page.width - v, y: page.y + page.height - u };
  }
}

export function toPdfBox(page: PageGeometry, box: Box): PdfBox {
  const shown = displayedSize(page);
  const left = box.x * shown.width;
  const bottom = (box.y + box.height) * shown.height;
  const anchor = displayedPointToPdf(page, left, bottom);
  return {
    anchorX: anchor.x,
    anchorY: anchor.y,
    width: box.width * shown.width,
    height: box.height * shown.height,
    rotate: normalizeRotation(page.rotation),
  };
}

/**
 * A point inside the box, given in the box's own reading frame (dx right, dy up from its
 * bottom-left), in PDF user space. Text and lines inside a field are placed with this.
 */
export function pointInBox(box: PdfBox, dx: number, dy: number): { x: number; y: number } {
  switch (box.rotate) {
    case 0:
      return { x: box.anchorX + dx, y: box.anchorY + dy };
    case 90:
      return { x: box.anchorX - dy, y: box.anchorY + dx };
    case 180:
      return { x: box.anchorX - dx, y: box.anchorY - dy };
    case 270:
      return { x: box.anchorX + dy, y: box.anchorY - dx };
  }
}

/** Keeps a box on the page and at least a little bigger than nothing. */
export function clampBox(box: Box): Box {
  const width = Math.min(Math.max(box.width, 0.01), 1);
  const height = Math.min(Math.max(box.height, 0.01), 1);
  return {
    x: Math.min(Math.max(box.x, 0), 1 - width),
    y: Math.min(Math.max(box.y, 0), 1 - height),
    width,
    height,
  };
}
