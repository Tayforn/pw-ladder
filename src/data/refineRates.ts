// =========================================================
// Шанси успіху заточки — скопійовано з pw-calc (src/modules/refine/data.ts),
// та сама таблиця, окремий репозиторій. RATES[method][level], level 1..12.
// =========================================================

export type StoneMethod = 'mirage' | 'sky' | 'under' | 'world';

export const RATES: Record<StoneMethod, Array<number | null>> = {
  mirage: [null, 0.50, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.30, 0.25, 0.20, 0.12, 0.05],
  sky:    [null, 0.60, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.40, 0.35, 0.27, 0.20],
  under:  [null, 0.535, 0.335, 0.335, 0.335, 0.335, 0.335, 0.335, 0.335, 0.285, 0.235, 0.155, 0.085],
  world:  [null, 1.00, 0.25, 0.10, 0.04, 0.0167, 0.0077, 0.0047, 0.0025, 0.0013, 0.0007, 0.0004, 0.0002],
};

export const STONE_LABEL: Record<StoneMethod, string> = {
  mirage: 'Міраж',
  sky: 'Небесний',
  under: 'Підземний',
  world: 'Світобудови',
};

export const MAX_LEVEL = 12;
