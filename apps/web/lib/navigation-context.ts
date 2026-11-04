const STORAGE_KEY = 'salesos.navigation';

type StoredNavigation = Record<string, string>;

function readMap(): StoredNavigation {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') as StoredNavigation;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberNavigation(resourceType: string, action: string, token: string) {
  const current = readMap();
  current[`${resourceType}:${action}`] = token;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function recallNavigation(resourceType: string, action: string): string | null {
  return readMap()[`${resourceType}:${action}`] ?? null;
}

export function clearNavigation() {
  sessionStorage.removeItem(STORAGE_KEY);
}
