export interface CatalogEntry {
  id: string;
  name: string;
  gm: string;
  range: [number, number];
  step: number;
}
export const INSTRUMENTS: CatalogEntry[];
