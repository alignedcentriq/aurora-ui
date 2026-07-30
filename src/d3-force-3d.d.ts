// d3-force-3d ships no types; this covers only the forces MemoryBrainTab uses.
declare module "d3-force-3d" {
  export interface Node3D {
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
  }

  export interface Simulation3D<N extends Node3D> {
    tick(iterations?: number): Simulation3D<N>;
    stop(): Simulation3D<N>;
    alpha(): number;
    alphaMin(): number;
    force(name: string, force: object): Simulation3D<N>;
  }

  export interface ForceLink<N, L> {
    id(fn: (node: N) => string): ForceLink<N, L>;
    distance(fn: (link: L & { source: N; target: N }) => number): ForceLink<N, L>;
    strength(value: number): ForceLink<N, L>;
  }

  export interface ForceManyBody {
    strength(value: number): ForceManyBody;
    distanceMax(value: number): ForceManyBody;
  }

  export function forceSimulation<N extends Node3D>(nodes: N[], numDimensions?: number): Simulation3D<N>;
  export function forceLink<N, L extends { source: string; target: string }>(links: L[]): ForceLink<N, L>;
  export function forceManyBody(): ForceManyBody;
  export function forceCenter(x?: number, y?: number, z?: number): object;
}
