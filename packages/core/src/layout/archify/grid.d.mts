export interface GridOptions {
  origin: [number, number];
  gapX: number;
  gapY: number;
  entityW: number;
}

export interface GridEntity {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface Bands {
  columnX: Map<number, number>;
  rowY: Map<number, number>;
  widths: Map<number, number>;
  heights: Map<number, number>;
  totalWidth: number;
  totalHeight: number;
}

export function bandedLayout(entities: GridEntity[], grid: GridOptions): Bands;
export function resolveEntityPos(entity: GridEntity, grid: GridOptions, bands: Bands): [number, number];
