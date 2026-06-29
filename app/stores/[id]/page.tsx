"use client";
// app/stores/[id]/page.tsx — Store detail page

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";

type OpeningHours = { days: string[]; open: string; close: string };
type Salon = {
  id: string; name: string; description: string | null;
  address: string | null; suburb: string | null; city: string | null;
  phone: string | null; email: string | null; website: string | null;
  opening_hours: OpeningHours | null; gallery_urls: string[] | null;
  instagram_username: string | null; youtube_url: string | null;
  services: string[] | null; latitude: number | null; longitude: number | null;
};
type IgPost = { id: string; media_url: string; permalink: string; caption?: string };
type StoreBookingInsert = { salon_id: string; client_id: string | null; client_name: string; client_phone: string; service: string; booking_date: string; booking_time: string; notes: string | null };

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TIMES: string[] = [];
for (let h = 7; h < 20; h++) { TIMES.push(`${String(h).padStart(2,"0")}:00`); TIMES.push(`${String(h).padStart(2,"0")}:30`); }

function isOpenNow(s: Salon) {
  const oh = s.opening_hours;
  if (!oh?.days?.length) return false;
  const now = new Date();
  const dayName = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oH, oM] = (oh.open ?? "08:00").split(":").map(Number);
  const [cH, cM] = (oh.close ?? "17:00").split(":").map(Number);
  return oh.days.includes(dayName) && cur >= oH * 60 + oM && cur < cH * 60 + cM;
}

function ytId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|watch\?v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── YouTube embed (lazy, privacy-first) ──────────────────────────────────────
function YTEmbed({ videoId }: { videoId: string }) {
  const [active, setActive] = useState(false);
  const thumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  if (!active) return (
    <div onClick={() => setActive(true)} style={{ position: "relative", paddingBottom: "56.25%", borderRadius: 14, overflow: "hidden", cursor: "pointer" }}>
      <Image src={thumb} alt="Watch video" fill style={{ objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
        <div style={{ width: 64, height: 64, background: "rgba(255,255,255,0.92)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "1.6rem", color: "#FF0000", marginLeft: 4 }}>▶</span>
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", paddingBottom: "56.25%", borderRadius: 14, overflow: "hidden" }}>
      <iframe src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`} allow="autoplay;encrypted-media;picture-in-picture" allowFullScreen title="Store video" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
    </div>
  );
}

// ── Instagram feed ────────────────────────────────────────────────────────────
function IGFeed({ username }: { username: string }) {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetch(`/api/instagram/${encodeURIComponent(username)}`).then(r => r.json()).then(d => { setPosts(d.posts ?? []); setDone(true); }).catch(() => setDone(true));
  }, [username]);

  if (!done) return <p style={{ color: "var(--grey)", fontSize: "0.85rem" }}>Loading Instagram…</p>;
  if (!posts.length) return (
    <a href={`https://www.instagram.com/${username}`} target="_blank" rel="noopener noreferrer" style={{ color: "#C13584", fontWeight: 500, fontSize: "0.9rem" }}>📸 @{username} on Instagram →</a>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
        {posts.slice(0,9).map(p => (
          <a key={p.id} href={p.permalink} target="_blank" rel="noopener noreferrer" style={{ display: "block", aspectRatio: "1", overflow: "hidden", borderRadius: 10, position: "relative" }}>
            <Image src={p.media_url} alt={p.caption?.slice(0,60) ?? ""} fill style={{ objectFit: "cover" }} />
          </a>
        ))}
      </div>
      <a href={`https://www.instagram.com/${username}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.82rem", color: "#C13584", fontWeight: 500, display: "block", marginTop: 8 }}>Follow @{username} →</a>
    </div>
  );
}

// ── Gallery with lightbox ─────────────────────────────────────────────────────
function Gallery({ urls }: { urls: string[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!urls.length) return null;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8 }}>
        {urls.map((url,i) => (
          <div key={i} onClick={() => setActive(i)} style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", position: "relative", cursor: "pointer" }}>
            <Image src={url} alt={`Photo ${i+1}`} fill style={{ objectFit: "cover" }} />
          </div>
        ))}
      </div>
      {active !== null && (
        <div onClick={() => setActive(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <button onClick={e => { e.stopPropagation(); setActive(a => a === null || a === 0 ? urls.length-1 : a-1); }} style={{ position: "absolute", left: "1rem", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: "2rem", width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>‹</button>
          <Image src={urls[active]} alt="Gallery" width={900} height={700} style={{ objectFit: "contain", maxHeight: "90vh", maxWidth: "90vw", borderRadius: 12 }} />
          <button onClick={e => { e.stopPropagation(); setActive(a => a === null || a === urls.length-1 ? 0 : a+1); }} style={{ position: "absolute", right: "1rem", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: "2rem", width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>›</button>
        </div>
      )}
    </>
  );
}

// ── Booking form ──────────────────────────────────────────────────────────────
function BookingForm({ salon }: { salon: Salon }) {
  const supabase = createClient();
  const oh = salon.opening_hours;
  const services = salon.services?.length ? salon.services : ["hair","nails","makeup","lashes"];
  const [oH] = (oh?.open ?? "08:00").split(":").map(Number);
  const [cH] = (oh?.close ?? "17:00").split(":").map(Number);
  const validTimes = TIMES.filter(t => { const h = parseInt(t); return h >= oH && h < cH; });

  const [form, setForm] = useState({ name: "", phone: "", service: services[0], date: "", time: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const dayOk = () => {
    if (!form.date) return true;
    const d = new Date(form.date);
    const day = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
    return oh?.days?.includes(day) ?? true;
  };

  const submit = async () => {
    setError("");
    if (!form.name || !form.phone || !form.date || !form.time) { setError("Please fill in all required fields."); return; }
    if (!dayOk()) { setError(`The salon is closed that day. Open: ${oh?.days?.join(", ")}`); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload: StoreBookingInsert = { salon_id: salon.id, client_id: user?.id ?? null, client_name: form.name, client_phone: form.phone, service: form.service, booking_date: form.date, booking_time: form.time, notes: form.notes || null };
    const { error: err } = await supabase.from("store_bookings").insert(payload);
    setSaving(false);
    if (err) { setError("Something went wrong. Please try again."); return; }
    setDone(true);
  };

  const inp: React.CSSProperties = { width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "1.5px solid rgba(155,127,184,0.2)", fontSize: "0.9rem", outline: "none", background: "#fff", marginBottom: "0.85rem" };
  const lbl: React.CSSProperties = { fontSize: "0.8rem", fontWeight: 600, color: "#888", display: "block", marginBottom: "0.3rem" };

  if (done) return (
    <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Booking request sent!</h3>
      <p style={{ color: "var(--grey)", fontSize: "0.9rem" }}>The salon will confirm via WhatsApp or phone shortly.</p>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid rgba(155,127,184,0.15)", padding: "1.5rem" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem", marginBottom: "1.25rem" }}>Book an appointment</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div><label style={lbl}>Your name *</label><input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="Full name" style={inp} /></div>
        <div><label style={lbl}>WhatsApp / phone *</label><input value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="082 123 4567" type="tel" style={inp} /></div>
      </div>

      <label style={lbl}>Service *</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "0.85rem" }}>
        {services.map(svc => (
          <button key={svc} onClick={() => setForm(f=>({...f,service:svc}))} style={{ padding: "0.4rem 1rem", borderRadius: 100, fontSize: "0.85rem", cursor: "pointer", border: "1.5px solid", borderColor: form.service===svc?"var(--plum)":"rgba(155,127,184,0.25)", background: form.service===svc?"var(--plum)":"#fff", color: form.service===svc?"#fff":"var(--grey)", fontWeight: form.service===svc?600:400, textTransform: "capitalize" }}>{svc}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
        <div>
          <label style={lbl}>Date *</label>
          <input type="date" value={form.date} min={new Date().toISOString().split("T")[0]} onChange={e => setForm(f=>({...f,date:e.target.value}))} style={{ ...inp, colorScheme: "light" }} />
          {form.date && !dayOk() && <p style={{ color:"#E53935",fontSize:"0.78rem",marginTop:-8,marginBottom:"0.5rem" }}>Closed that day.</p>}
        </div>
        <div>
          <label style={lbl}>Time *</label>
          <select value={form.time} onChange={e => setForm(f=>({...f,time:e.target.value}))} style={{ ...inp, appearance: "none" }}>
            <option value="">Select a time</option>
            {validTimes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <label style={lbl}>Notes (optional)</label>
      <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Special requests, inspiration images link…" rows={3} style={{ ...inp, resize: "vertical" }} />

      {error && <p style={{ color: "#E53935", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{error}</p>}

      <button onClick={submit} disabled={saving} className="btn-plum" style={{ width: "100%", padding: "0.9rem", borderRadius: 100, fontSize: "1rem", fontWeight: 600, cursor: saving?"not-allowed":"pointer", opacity: saving?0.7:1 }}>
        {saving ? "Sending…" : "Request booking"}
      </button>
      <p style={{ fontSize: "0.75rem", color: "#bbb", textAlign: "center", marginTop: "0.75rem" }}>The salon will confirm via WhatsApp or phone.</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
      if (user) supabase.from("profiles").select("full_name,avatar_url,phone").eq("id",user.id).single().then(({data})=>{if(data)setProfile(data as Profile);});
    });
  },[]);

  useEffect(() => {
    if (!id) return;
    supabase.from("partner_salons").select("*").eq("id",id).single().then(({data,error})=>{
      if (!error && data) setSalon(data as Salon);
      setLoading(false);
    });
  },[id]);

  if (loading) return <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center" }}><p style={{ color:"var(--grey)" }}>Loading…</p></div>;
  if (!salon) return (
    <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem" }}>
      <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400 }}>Salon not found</h2>
      <Link href="/stores" style={{ color:"var(--plum)" }}>← Back to salons</Link>
    </div>
  );

  const open = isOpenNow(salon);
  const videoId = salon.youtube_url ? ytId(salon.youtube_url) : null;
  const oh = salon.opening_hours;

  return (
    <div style={{ minHeight:"100vh",background:"#FAFAF8" }}>
      <SiteHeader initialUser={user} initialProfile={profile} />

      {/* Hero — gradient plum with optional gallery photo overlay */}
      <div style={{ position:"relative", overflow:"hidden", minHeight:280 }}>
        {/* Gradient base */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, #6B4F8A 0%, #9B7FB8 40%, #C28070 80%, #D4956B 100%)" }} />
        {/* Gallery photo overlay when available */}
        {salon.gallery_urls?.[0] && (
          <Image src={salon.gallery_urls[0]} alt={salon.name} fill style={{ objectFit:"cover", opacity:0.28, mixBlendMode:"overlay" }} />
        )}
        {/* Dark vignette */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.08) 60%)" }} />

        {/* Open/closed badge */}
        <div style={{ position:"absolute", top:"1rem", right:"1rem", background:open?"rgba(43,107,69,0.92)":"rgba(30,30,30,0.72)", color:"#fff", borderRadius:100, padding:"0.3rem 0.9rem", fontSize:"0.82rem", fontWeight:600, backdropFilter:"blur(4px)", zIndex:2 }}>
          {open ? "Open now" : "Closed"}
        </div>

        {/* Centred text content */}
        <div style={{ position:"relative", zIndex:1, textAlign:"center", padding:"3.5rem 1.5rem 2.5rem", display:"flex", flexDirection:"column", alignItems:"center", gap:"0.4rem" }}>
          <Link href="/stores" style={{ color:"rgba(255,255,255,0.7)", fontSize:"0.8rem", textDecoration:"none", marginBottom:"0.25rem", letterSpacing:"0.04em" }}>
            ← All salons
          </Link>
          <h1 style={{ color:"#fff", fontFamily:"var(--font-display)", fontWeight:500, fontSize:"clamp(1.75rem,5vw,2.5rem)", margin:0, textShadow:"0 2px 12px rgba(0,0,0,0.25)" }}>{salon.name}</h1>
          <p style={{ color:"rgba(255,255,255,0.85)", fontSize:"0.95rem", margin:0 }}>📍 {salon.address}{salon.suburb ? `, ${salon.suburb}` : ""}{salon.city ? `, ${salon.city}` : ""}</p>
          {salon.services?.length ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginTop:"0.5rem" }}>
              {salon.services.map(s => (
                <span key={s} style={{ padding:"0.2rem 0.75rem", borderRadius:100, background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.35)", color:"#fff", fontSize:"0.78rem", fontWeight:500, textTransform:"capitalize", backdropFilter:"blur(4px)" }}>{s}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ maxWidth:900,margin:"0 auto",padding:"2rem 1.5rem" }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr min(380px,100%)",gap:"2rem",alignItems:"start" }}>

          {/* Left */}
          <div>
            {salon.description && (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>About</h2>
                <p style={{ color:"var(--grey)",lineHeight:1.7,fontSize:"0.95rem" }}>{salon.description}</p>
              </section>
            )}

            {salon.services?.length ? (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Services</h2>
                <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
                  {salon.services.map(s => <span key={s} style={{ padding:"0.4rem 1rem",borderRadius:100,border:"1.5px solid rgba(155,127,184,0.3)",color:"var(--plum)",fontWeight:500,fontSize:"0.88rem",textTransform:"capitalize" }}>{s}</span>)}
                </div>
              </section>
            ) : null}

            {salon.gallery_urls?.length ? (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Gallery</h2>
                <Gallery urls={salon.gallery_urls} />
              </section>
            ) : null}

            {salon.instagram_username && (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Instagram <span style={{ fontSize:"0.82rem",color:"#C13584",fontFamily:"var(--font-body)",fontWeight:400 }}>@{salon.instagram_username}</span></h2>
                <IGFeed username={salon.instagram_username} />
              </section>
            )}

            {videoId && (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Watch</h2>
                <YTEmbed videoId={videoId} />
              </section>
            )}

            {salon.latitude && salon.longitude && (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Find us</h2>
                <div style={{ borderRadius:14,overflow:"hidden",border:"1.5px solid rgba(155,127,184,0.15)" }}>
                  <iframe
                    src={`https://maps.google.com/maps?q=${salon.latitude},${salon.longitude}&output=embed`}
                    width="100%" height="280" style={{ border:"none",display:"block" }}
                    title={`Map for ${salon.name}`} loading="lazy" allowFullScreen
                  />
                </div>
                <p style={{ fontSize:"0.82rem",color:"var(--grey)",marginTop:"0.5rem" }}>📍 {salon.address}{salon.suburb ? `, ${salon.suburb}` : ""}{salon.city ? `, ${salon.city}` : ""}</p>
              </section>
            )}

            {oh && (
              <section style={{ marginBottom:"2rem" }}>
                <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Hours</h2>
                <div style={{ background:"#fff",borderRadius:14,border:"1.5px solid rgba(155,127,184,0.15)",padding:"1rem 1.25rem",display:"grid",gap:"0.4rem" }}>
                  {DAYS.map(day => {
                    const isOpen = oh.days?.includes(day);
                    const isToday = DAYS[new Date().getDay()===0?6:new Date().getDay()-1]===day;
                    return (
                      <div key={day} style={{ display:"flex",justifyContent:"space-between",fontSize:"0.88rem",fontWeight:isToday?600:400,color:isToday?"var(--plum)":"var(--grey)" }}>
                        <span>{day}{isToday?" (today)":""}</span>
                        <span style={{ color:isOpen?(isToday?"var(--plum)":"#333"):"#bbb" }}>{isOpen?`${oh.open} – ${oh.close}`:"Closed"}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section style={{ marginBottom:"2rem" }}>
              <h2 style={{ fontFamily:"var(--font-display)",fontWeight:400,fontSize:"1.25rem",marginBottom:"0.65rem" }}>Contact</h2>
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {salon.phone && <a href={`tel:${salon.phone}`} style={{ color:"var(--plum)",fontSize:"0.9rem",textDecoration:"none" }}>📞 {salon.phone}</a>}
                {salon.phone && <a href={`https://wa.me/${salon.phone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" style={{ color:"#25D366",fontSize:"0.9rem",textDecoration:"none" }}>💬 WhatsApp</a>}
                {salon.email && <a href={`mailto:${salon.email}`} style={{ color:"var(--plum)",fontSize:"0.9rem",textDecoration:"none" }}>✉️ {salon.email}</a>}
                {salon.website && <a href={salon.website} target="_blank" rel="noopener noreferrer" style={{ color:"var(--plum)",fontSize:"0.9rem",textDecoration:"none" }}>🌐 {salon.website.replace(/^https?:\/\//,"")}</a>}
              </div>
            </section>
          </div>

          {/* Right — sticky booking */}
          <div style={{ position:"sticky",top:"1.5rem" }}>
            <BookingForm salon={salon} />
          </div>

        </div>
      </div>
      <Footer />
    </div>
  );
}
