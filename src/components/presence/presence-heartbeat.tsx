"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { HEARTBEAT_MS, IDLE_AFTER_MS, type StoredPresence } from "@/lib/presence";
import { locationConsentKey, locationDeclinedKey } from "@/lib/presence/location-consent";

/**
 * PresenceHeartbeat — headless. Mount ONCE per signed-in dashboard tab
 * (in the dashboard shell, below the auth gate). Reports this tab's
 * presence to the `member_presence` table via the `touch_presence` RPC
 * roughly every HEARTBEAT_MS.
 *
 * The client only ever reports 'online' or 'away':
 *   - 'away'   when the tab is hidden, or no user input for IDLE_AFTER_MS
 *   - 'online' otherwise
 * It keeps heartbeating while away (so the row stays fresh, i.e. not
 * offline). When the tab closes the beats simply stop and viewers derive
 * 'offline' from staleness — no unreliable unload write needed.
 */
export function PresenceHeartbeat() {
  const { accountId, user } = useAuth();

  // 0 = "never recorded"; set on mount so we don't read the clock during
  // render (impure). Until the effect runs the tab counts as active.
  const lastActivityRef = useRef<number>(0);

  useEffect(() => {
    // Hold off until the account is known. Beating during the brief
    // window on a fresh signup — authed but profile/account row not yet
    // created — would make touch_presence raise "No account for caller"
    // and log a spurious error. The effect re-runs once accountId lands.
    if (!accountId || !user) return;

    const supabase = createClient();
    let cancelled = false;
    let lastBeatAt = 0;
    let watchId: number | null = null;
    let locationRefreshId: ReturnType<typeof setInterval> | null = null;
    let latestLocation: { latitude: number; longitude: number; accuracy: number } | null = null;
    let locationDirty = false;
    lastActivityRef.current = Date.now();

    const startLocationWatch = () => {
      if (watchId !== null || !navigator.geolocation ||
          localStorage.getItem(locationConsentKey(user.id)) !== "yes") return;
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          latestLocation = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          };
          locationDirty = true;
        },
        (error) => {
          // A temporary GPS/network failure is not a withdrawal of consent.
          // Only a browser permission denial should request consent again.
          if (error.code === error.PERMISSION_DENIED) {
            stopLocationWatch();
            localStorage.removeItem(locationConsentKey(user.id));
            sessionStorage.setItem(locationDeclinedKey(user.id), "yes");
            void beat();
          }
        },
        { enableHighAccuracy: true, maximumAge: 30_000 },
      );
      const refreshLocation = () => navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          latestLocation = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          };
          locationDirty = true;
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
      refreshLocation();
      locationRefreshId = setInterval(refreshLocation, 10 * 60_000);
    };
    const stopLocationWatch = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (locationRefreshId !== null) clearInterval(locationRefreshId);
      watchId = null;
      locationRefreshId = null;
      latestLocation = null;
      locationDirty = false;
    };

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const currentStatus = (): StoredPresence => {
      if (typeof document !== "undefined" && document.hidden) return "away";
      if (Date.now() - lastActivityRef.current > IDLE_AFTER_MS) return "away";
      return "online";
    };

    const beat = async () => {
      if (cancelled) return;
      // Coalesce bursts: a tab refocus fires visibilitychange AND focus
      // together, so skip a beat within 1s of the last to avoid two RPCs
      // in the same frame. The 30s interval is never affected.
      const t = Date.now();
      if (t - lastBeatAt < 1_000) return;
      lastBeatAt = t;
      const { error } = await supabase.rpc("touch_presence", {
        p_status: currentStatus(),
      });
      if (error && !cancelled) {
        // Non-fatal: presence is best-effort. Log once per failure so a
        // misconfigured RPC is visible without spamming.
        console.error("[PresenceHeartbeat] touch_presence failed:", error.message);
      }
      const location = locationDirty ? latestLocation : null;
      locationDirty = false;
      try {
        await fetch("/api/account/security/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location, locationDeclined: sessionStorage.getItem(locationDeclinedKey(user.id)) === "yes" }),
        });
      } catch {
        // Session audit is best effort and must never interrupt presence.
      }
    };

    // Activity listeners. `passive` so we never block scroll/input.
    const activityEvents: (keyof DocumentEventMap)[] = [
      "mousemove",
      "keydown",
      "pointerdown",
      "scroll",
    ];
    activityEvents.forEach((e) =>
      document.addEventListener(e, markActive, { passive: true }),
    );

    // Returning to the tab should beat immediately so a member flips
    // back to online without a 30s wait. The debounce in beat() absorbs
    // the visibilitychange + focus double-fire.
    const onReturn = () => {
      if (!document.hidden) markActive();
      void beat();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("wacrm-location-enabled", startLocationWatch);
    window.addEventListener("wacrm-location-disabled", stopLocationWatch);
    window.addEventListener("wacrm-location-declined", beat);
    startLocationWatch();

    void beat();
    const interval = setInterval(() => void beat(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      activityEvents.forEach((e) =>
        document.removeEventListener(e, markActive),
      );
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("wacrm-location-enabled", startLocationWatch);
      window.removeEventListener("wacrm-location-disabled", stopLocationWatch);
      window.removeEventListener("wacrm-location-declined", beat);
      stopLocationWatch();
    };
  }, [accountId, user]);

  return null;
}
