import { useSyncExternalStore } from "react";
import { getProfilePhoto, subscribeProfilePhoto } from "@/lib/profile-photo";

export function useProfilePhoto(): string | null {
  return useSyncExternalStore(subscribeProfilePhoto, getProfilePhoto);
}
