import { STORAGE_KEYS, STORAGE_TTLS } from '../../app/constants/storageKeys';
import { storage } from '../../app/utils/storage';

const STORAGE_KEY = STORAGE_KEYS.FULL_DATASET;
const SUMMARY_STORAGE_KEY = STORAGE_KEYS.AI_SUMMARIES;

function loadInitialCache() {
  return storage.get(STORAGE_KEY, { session: true });
}

let cachedDataset = loadInitialCache();
let cachedSummaries = (() => {
  const stored = storage.getWithTTL(SUMMARY_STORAGE_KEY, { session: true });
  return stored && typeof stored === 'object' ? stored : {};
})();

export function getCachedWorkDataset() {
  return cachedDataset;
}

export function setCachedWorkDataset(payload) {
  cachedDataset = payload;
  if (payload) {
    storage.set(STORAGE_KEY, payload, { session: true });
  } else {
    storage.remove(STORAGE_KEY, { session: true });
  }
}

export function getCachedAiMetricSummary(cacheKey) {
  return cachedSummaries[cacheKey] || '';
}

export function setCachedAiMetricSummary(cacheKey, summary) {
  cachedSummaries = {
    ...cachedSummaries,
    [cacheKey]: summary,
  };

  storage.setWithTTL(SUMMARY_STORAGE_KEY, cachedSummaries, STORAGE_TTLS.AI_SUMMARIES, { session: true });
}
