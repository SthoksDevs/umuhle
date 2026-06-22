// components/Footer.tsx
import Image from "next/image";
import Link from "next/link";

const ICON = "/umuhle-icon.png";

const SOCIALS = [
  { label: "Facebook",  href: "https://web.facebook.com/umuhlebeautiful" },
  { label: "Instagram", href: "https://www.instagram.com/umuhle_beautiful/" },
  { label: "TikTok",    href: "http://tiktok.com/@umuhle_beautiful" },
  { label: "WhatsApp",  href: "https://wa.me/27733014819" },
];

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid rgba(155,127,184,0.15)", background: "var(--white)", padding: "2rem 1.5rem" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Image src={ICON} alt="Umuhle" width={24} height={24} style={{ borderRadius: "50%" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.1rem", letterSpacing: "0.12em", color: "var(--plum)" }}>umuhle</span>
        </div>

        {/* Social + legal links */}
        <div className="footer-links" style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Social row */}
          <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
            {SOCIALS.map(s => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem", color: "var(--grey)", textDecoration: "none" }}>
                {s.label}
              </a>
            ))}
          </div>

          {/* Legal links */}
          <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/privacy-policy" style={{ fontSize: "0.78rem", color: "var(--grey)", textDecoration: "none" }}>Privacy Policy</Link>
            <Link href="/terms-and-conditions" style={{ fontSize: "0.78rem", color: "var(--grey)", textDecoration: "none" }}>Terms</Link>
          </div>
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--light)", margin: 0 }}>© {new Date().getFullYear()} Umuhle. All rights reserved.</p>
      </div>
    </footer>
  );
}
