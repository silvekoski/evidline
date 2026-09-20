const storageKey = "tpm.profilePhoto";
export const maxProfilePhotoBytes = 2 * 1024 * 1024;

const listeners = new Set<() => void>();
let current: string | null = null;
try {
  current = localStorage.getItem(storageKey);
} catch {
  current = null;
}

export function getProfilePhoto(): string | null {
  return current;
}

export function setProfilePhoto(dataUrl: string | null): void {
  current = dataUrl;
  try {
    if (dataUrl) localStorage.setItem(storageKey, dataUrl);
    else localStorage.removeItem(storageKey);
  } catch {
    // Storage can be full or unavailable; keep the in-memory value for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeProfilePhoto(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
