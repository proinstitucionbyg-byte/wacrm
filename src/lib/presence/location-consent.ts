/** Keep location preferences separate when multiple advisers use one browser. */
export function locationConsentKey(userId: string): string {
  return `wacrm-share-location:${userId}`;
}

export function locationDeclinedKey(userId: string): string {
  return `wacrm-location-declined:${userId}`;
}
