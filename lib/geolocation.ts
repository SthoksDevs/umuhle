// lib/geolocation.ts
//
// Shared browser-geolocation hook. Used by:
//   - app/page.tsx (customer homepage — filters/sorts artists within 50km)
//   - app/stores/page.tsx (customer stores page — same, for salons)
//   - app/dashboard/page.tsx (artist side — pings their own current
//     position into artists.latitude/longitude so *other* customers' nearby
//     searches stay accurate as the artist moves around)
//
// Deliberately does NOT auto-prompt on first mount: browsers only show the
// permission dialog in response to (or shortly after) a page load, and
// silently doing so with no context reads as suspicious. Callers request()
// on their own trigger (a button, or a single mount-time call paired with
// visible copy explaining why).
"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type GeoStatus = "idle" | "checking" | "granted" | "denied" | "unsupported";

export type Coords = { latitude: number; longitude: number };

export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestingRef = useRef(false);

  const request = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (requestingRef.current) return;
    requestingRef.current = true;
    setStatus("checking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        requestingRef.current = false;
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setStatus("granted");
      },
      (err) => {
        requestingRef.current = false;
        setStatus("denied");
        setError(err.message);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  }, []);

  // On mount, silently check the *existing* permission state (this does not
  // itself prompt) so a returning visitor who already granted access gets
  // proximity results without re-clicking anything, while a first-time
  // visitor just sees "idle" until they hit the explicit prompt.
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (!("permissions" in navigator)) return; // Safari has no Permissions API — wait for explicit request()
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        if (result.state === "granted") request();
        else if (result.state === "denied") setStatus("denied");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request]);

  return { status, coords, error, request };
}
