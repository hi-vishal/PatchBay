/** The hero board's contents, shared by the 3D scene and its static fallback. */

export interface BoardModule {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  ink: string;
}

export const MODULES: BoardModule[] = [
  { id: 'ask', label: 'You ask', x: -4.3, y: 1.9, color: '#EEF0F2', ink: '#15171A' },
  { id: 'model', label: 'Model', x: -1.3, y: 0.3, color: '#6AA9FF', ink: '#0B1830' },
  { id: 'fetch', label: 'web_fetch', x: 2.5, y: 2.3, color: '#3FCFB4', ink: '#06231D' },
  { id: 'github', label: 'GitHub', x: 3.3, y: -0.3, color: '#B39BFF', ink: '#1A1038' },
  { id: 'approve', label: 'Approve', x: -1.6, y: -2.6, color: '#F285B5', ink: '#3A0B21' },
  { id: 'answer', label: 'Answer', x: 3.4, y: -2.9, color: '#EEF0F2', ink: '#15171A' },
];

export interface BoardCable {
  from: string;
  to: string;
  color: string;
  sag: number;
}

export const CABLES: BoardCable[] = [
  { from: 'ask', to: 'model', color: '#F07A2E', sag: 0.7 },
  { from: 'model', to: 'fetch', color: '#3FCFB4', sag: 1.1 },
  { from: 'model', to: 'github', color: '#B39BFF', sag: 1.4 },
  { from: 'github', to: 'approve', color: '#F285B5', sag: 1.5 },
  { from: 'approve', to: 'answer', color: '#F07A2E', sag: 1.0 },
];

/** The order a run moves through the cables. `reverse` is a tool result coming back. */
export const PULSE_ROUTE: { cable: number; reverse?: boolean }[] = [
  { cable: 0 },
  { cable: 1 },
  { cable: 1, reverse: true },
  { cable: 2 },
  { cable: 3 },
  { cable: 4 },
];

export const MODULE_WIDTH = 2.3;
export const MODULE_HEIGHT = 1.15;

export function moduleById(id: string): BoardModule {
  const found = MODULES.find((module) => module.id === id);
  if (!found) throw new Error(`Unknown board module: ${id}`);
  return found;
}

/** Cables leave from whichever side of a module faces the other end. */
export function jackPosition(module: BoardModule, toward: BoardModule): { x: number; y: number } {
  const side = toward.x >= module.x ? 1 : -1;
  return { x: module.x + (side * MODULE_WIDTH) / 2, y: module.y };
}
