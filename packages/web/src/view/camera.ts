/**
 * Pan and zoom: screen = world · k + (x, y). Pure functions, so the viewer
 * only applies the result as an SVG transform.
 */

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Fitting never enlarges past this: a small level stays at reading size. */
const FIT_MAX = 1;
const FIT_PAD = 16;

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The whole scene centred in the viewport. */
export function fit(scene: Size, viewport: Size): Camera {
  const k = clampZoom(
    Math.min(FIT_MAX, (viewport.width - FIT_PAD * 2) / scene.width, (viewport.height - FIT_PAD * 2) / scene.height),
  );
  return { k, x: (viewport.width - scene.width * k) / 2, y: (viewport.height - scene.height * k) / 2 };
}

/** Zoom by `factor` keeping the world point under screen point (sx, sy) in place. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const k = clampZoom(cam.k * factor);
  const wx = (sx - cam.x) / cam.k;
  const wy = (sy - cam.y) / cam.k;
  return { k, x: sx - wx * k, y: sy - wy * k };
}

export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, x: cam.x + dx, y: cam.y + dy };
}

/** Centre world point (wx, wy) in the viewport at the current zoom. */
export function centerOn(cam: Camera, wx: number, wy: number, viewport: Size): Camera {
  return { ...cam, x: viewport.width / 2 - wx * cam.k, y: viewport.height / 2 - wy * cam.k };
}

/** The part of the world the viewport shows. */
export function visibleWorld(cam: Camera, viewport: Size): { x: number; y: number; width: number; height: number } {
  // (0 - x) rather than -x: no -0 for an unpanned camera.
  return { x: (0 - cam.x) / cam.k, y: (0 - cam.y) / cam.k, width: viewport.width / cam.k, height: viewport.height / cam.k };
}

export const transformOf = (cam: Camera) => `translate(${cam.x} ${cam.y}) scale(${cam.k})`;
