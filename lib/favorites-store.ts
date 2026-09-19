const KEY = "restaurant-menu:favorites:v1";
const listeners = new Set<() => void>();
let snapshot: string[] = [];
let initialized = false;

function read(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  snapshot = read();
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      snapshot = read();
      listeners.forEach((listener) => listener());
    }
  });
}

export function subscribeFavorites(listener: () => void) {
  listeners.add(listener);
  init();
  return () => listeners.delete(listener);
}

export function getFavoritesSnapshot() {
  return snapshot;
}

export function toggleFavorite(itemId: string) {
  init();
  snapshot = snapshot.includes(itemId) ? snapshot.filter((id) => id !== itemId) : [...snapshot, itemId];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Favorites still work for this tab when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export const FAVORITES_SERVER_SNAPSHOT: string[] = [];
