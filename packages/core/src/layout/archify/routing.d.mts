export type Side = "top" | "right" | "bottom" | "left";
export type Point = [number, number];

export interface RouterComponent {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface RouterConnection {
  id?: string;
  from: string;
  to: string;
  fromSide?: Side;
  toSide?: Side;
}

export interface RouterFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface Router<C extends RouterConnection> {
  pathFor(connection: C): { points: Point[]; d: string };
  connectionEndpointSide(connection: C, endpoint: "source" | "target"): Side;
}

export function createRouter<C extends RouterConnection>(
  components: Map<string, RouterComponent>,
  connections: C[],
  options?: {
    frames?: RouterFrame[];
    sideFor?: (connection: C, endpoint: "source" | "target") => Side | undefined;
    maxPortSpacing?: number;
    distinctAutomaticPorts?: boolean;
    preferReadableRoutes?: boolean;
    crossingFreeGridFirst?: boolean;
    componentGapPx?: number;
  },
): Router<C>;
