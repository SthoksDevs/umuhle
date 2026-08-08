// components/AddressMapPicker.tsx
//
// Lets a client drop/drag a pin on an OpenStreetMap (via Leaflet) to set
// their meeting location, then reverse-geocodes the pin to a human-
// readable address via /api/geocode/reverse. Built for BookingDrawer
// (app/page.tsx) as a fallback shown alongside the "couldn't get your
// location" message, so that isn't the only option — the client can point
// at a map instead of typing an address by hand.
//
// Leaflet is loaded from a CDN at runtime rather than installed via npm:
// no API key, no bundler config, nothing to `npm install` before this
// works. If Umuhle later adds maps elsewhere, this loader (loadLeaflet) is
// shared/safe to call more than once — it no-ops once window.L exists.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    L?: any;
  }
}

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

// Roughly the centre of South Africa, zoomed out to the whole country —
// the starting view when we have no better guess at where the pin should
// go (used only until the client clicks/drags somewhere specific).
const SA_CENTER: [number, number] = [-28.8166, 24.7499];
const SA_DEFAULT_ZOOM = 5;
const PIN_ZOOM = 15;

let leafletLoadPromise: Promise<void> | null = null;

function loadLeaflet(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[data-leaflet]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      link.setAttribute("data-leaflet", "1");
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[data-leaflet]`) as HTMLScriptElement | null;
    if (existing) {
      if (window.L) { resolve(); return; }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Leaflet")));
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.setAttribute("data-leaflet", "1");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Leaflet"));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

type LatLng = { lat: number; lng: number };

export default function AddressMapPicker({
  initialCenter,
  onConfirm,
  height = 220,
}: {
  initialCenter?: LatLng | null;
  onConfirm: (address: string, coords: LatLng) => void;
  height?: number;
}) {
  const mapElRef    = useRef<HTMLDivElement | null>(null);
  const mapRef      = useRef<any>(null);
  const markerRef   = useRef<any>(null);
  const requestSeq  = useRef(0);
  const [ready, setReady]                     = useState(false);
  const [mapError, setMapError]               = useState(false);
  const [coords, setCoords]                   = useState<LatLng | null>(initialCenter ?? null);
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [resolving, setResolving]             = useState(false);

  // Guards against a slow earlier reverse-geocode call landing after a
  // faster later one and overwriting it with a stale address.
  const reverseGeocode = useCallback(async (pos: LatLng) => {
    const seq = ++requestSeq.current;
    setResolving(true);
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${pos.lat}&lon=${pos.lng}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== requestSeq.current) return;
      setResolvedAddress(res.ok && data.address ? data.address : `Pinned location (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`);
    } catch {
      if (seq !== requestSeq.current) return;
      setResolvedAddress(`Pinned location (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`);
    } finally {
      if (seq === requestSeq.current) setResolving(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) setMapError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !mapElRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) { setMapError(true); return; }

    // Leaflet's default marker icon points at image paths relative to
    // wherever it *thinks* leaflet.js was loaded from, which isn't
    // reliable when loaded ad-hoc like this — pin those explicitly at the
    // same CDN copy, once, or the marker renders as a broken image.
    if (!L.Icon.Default._umuhlePatched) {
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon-2x.png`,
        iconUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon.png`,
        shadowUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-shadow.png`,
      });
      L.Icon.Default._umuhlePatched = true;
    }

    const start: [number, number] = coords ? [coords.lat, coords.lng] : SA_CENTER;
    const map = L.map(mapElRef.current).setView(start, coords ? PIN_ZOOM : SA_DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const marker = L.marker(start, { draggable: true }).addTo(map);
    const onMoved = (latlng: { lat: number; lng: number }) => {
      const next = { lat: latlng.lat, lng: latlng.lng };
      setCoords(next);
      reverseGeocode(next);
    };
    marker.on("dragend", () => onMoved(marker.getLatLng()));
    map.on("click", (e: any) => { marker.setLatLng(e.latlng); onMoved(e.latlng); });

    mapRef.current = map;
    markerRef.current = marker;

    if (coords) reverseGeocode(coords);

    // Leaflet measures its container at creation time; this map mounts
    // inside a drawer that may still be sliding into place, so its size
    // can be wrong the instant this runs. Re-measure once layout settles.
    const t = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div style={{ marginTop: "0.6rem", border: "1.5px solid rgba(155,127,184,0.25)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <p style={{ margin: "0.6rem 0.75rem 0", fontSize: "0.78rem", color: "var(--grey)" }}>
        Tap or drag the pin to your exact meeting spot
      </p>
      <div style={{ position: "relative", height, margin: "0.5rem 0.75rem", borderRadius: 8, overflow: "hidden" }}>
        {!ready && !mapError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F4EFF8", fontSize: "0.8rem", color: "var(--grey)" }}>
            Loading map…
          </div>
        )}
        {mapError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F4EFF8", fontSize: "0.8rem", color: "var(--grey)", padding: "0 1rem", textAlign: "center" }}>
            Map couldn&apos;t load — you can still type your address above.
          </div>
        )}
        <div ref={mapElRef} style={{ height: "100%", width: "100%" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", padding: "0 0.75rem 0.75rem" }}>
        <p style={{ fontSize: "0.78rem", color: "var(--onyx)", margin: 0, flex: 1, lineHeight: 1.4 }}>
          {!coords ? "Pick a spot on the map" : resolving ? "Finding address…" : resolvedAddress}
        </p>
        <button
          type="button"
          className="btn-plum"
          disabled={!coords || resolving}
          onClick={() => coords && onConfirm(resolvedAddress || `Pinned location (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`, coords)}
          style={{ padding: "0.45rem 0.9rem", fontSize: "0.8rem", flexShrink: 0, opacity: !coords || resolving ? 0.6 : 1 }}
        >
          Use this spot
        </button>
      </div>
    </div>
  );
}
