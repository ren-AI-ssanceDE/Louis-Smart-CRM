// pgvector: HNSW- und IVFFlat-Indizes unterstützen maximal 2.000 Dimensionen.
// Oberhalb dieser Grenze muss die Vektor-Suche auf sequentielle Scans zurückfallen.
// Technische Konstanten (kein Verhaltensparameter, Regel 12 nicht betroffen).
export const PGVECTOR_HNSW_MAX_DIMS = 2000;

/**
 * Entscheidet, ob ein HNSW-Index für eine Vektor-Spalte mit `dimensions`
 * Dimensionen ausgelassen werden muss (pgvector-Limit 2.000).
 */
export function shouldSkipHnsw(dimensions: number): boolean {
  return dimensions > PGVECTOR_HNSW_MAX_DIMS;
}
