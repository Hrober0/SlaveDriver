import type { RendererState } from '../shared/types';

/** Renderer state before the per-window fields (`origin`, `active`) are filled in. */
export type BaseState = Omit<RendererState, 'origin' | 'active'>;
