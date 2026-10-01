export function PostalHeroBackground() {
  return (
    <svg className="cx-postal-hero-background" viewBox="0 0 1200 380" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="postal-building-front" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#075aa2" />
          <stop offset="1" stopColor="#003b73" />
        </linearGradient>
        <linearGradient id="postal-building-side" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#0b63ac" />
          <stop offset="1" stopColor="#003062" />
        </linearGradient>
        <filter id="postal-soft-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#003b73" floodOpacity=".16" />
        </filter>
      </defs>

      <circle className="cx-postal-hero-orb cx-postal-hero-orb-one" cx="973" cy="78" r="104" fill="#dceefa" />
      <circle className="cx-postal-hero-orb cx-postal-hero-orb-two" cx="1138" cy="305" r="92" fill="#fff3c4" />
      <path className="cx-postal-hero-route" d="M700 315 C770 248 824 330 884 274 S1000 182 1140 234" />

      <g className="cx-postal-hero-building" filter="url(#postal-soft-shadow)" transform="translate(864 116)">
        <path d="M25 43 L78 11 H216 L250 43 V220 H25Z" fill="url(#postal-building-side)" />
        <path d="M0 56 L53 24 H191 L216 56 V220 H0Z" fill="url(#postal-building-front)" />
        <path d="M0 56 L53 24 H191 L216 56 L179 75 H37Z" fill="#0d6db9" />
        <rect x="26" y="84" width="128" height="38" rx="12" fill="#ffffff" fillOpacity=".96" />
        <rect x="42" y="97" width="96" height="12" rx="6" fill="#f4c542" />
        <path d="M31 151 H90 V220 H31Z" fill="#eaf4fc" fillOpacity=".95" />
        <path d="M105 151 H180 V194 H105Z" fill="#7dd3c7" fillOpacity=".82" />
        <path d="M105 203 H180" stroke="#7dd3c7" strokeOpacity=".7" strokeWidth="9" strokeLinecap="round" />
        <path className="cx-postal-hero-building-glint" d="M15 69 H197" stroke="#ffffff" strokeOpacity=".45" strokeWidth="7" strokeLinecap="round" />
      </g>

      <g transform="translate(814 92) rotate(-11)">
        <g className="cx-postal-hero-envelope" filter="url(#postal-soft-shadow)">
          <rect x="-48" y="-32" width="96" height="64" rx="15" fill="#ffffff" />
          <path d="M-37 -20 L0 8 L37 -20 M-37 21 L-11 -2 M37 21 L11 -2" fill="none" stroke="#075aa2" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          <rect x="18" y="-19" width="17" height="17" rx="4" fill="#f4c542" />
        </g>
      </g>

      <g transform="translate(1060 290)">
        <g className="cx-postal-hero-parcel" filter="url(#postal-soft-shadow)">
          <path d="M0 18 L42 0 L86 20 L42 41Z" fill="#f4c542" />
          <path d="M0 18 L42 41 V88 L0 65Z" fill="#e5a91d" />
          <path d="M42 41 L86 20 V66 L42 88Z" fill="#efb72f" />
          <path d="M39 2 V84" stroke="#ffffff" strokeOpacity=".9" strokeWidth="7" />
        </g>
      </g>

      <g transform="translate(1124 82)">
        <g className="cx-postal-hero-pin" filter="url(#postal-soft-shadow)">
          <path d="M0 0 C-24 0 -39 18 -39 40 C-39 69 0 103 0 103 S39 69 39 40 C39 18 24 0 0 0Z" fill="#ffffff" stroke="#075aa2" strokeWidth="5" />
          <circle cx="0" cy="39" r="12" fill="#7dd3c7" />
        </g>
      </g>
    </svg>
  );
}
