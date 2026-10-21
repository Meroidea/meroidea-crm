import { ImageResponse } from 'next/og';

/*
 * The card shown when a Meroidea link is shared (WhatsApp, Messenger, LinkedIn, Slack, X…).
 * Generated once at build time. Colours are the brand palette (blanxer_ui_design.md); raw values
 * are needed here because the image renderer has no access to the CSS theme.
 */

export const alt = 'Meroidea — one workspace to run your business';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INDIGO = '#4B49AC';
const PERIWINKLE = '#7978E9';
const SKY = '#98BDFF';
const CORNFLOWER = '#7DA0FA';
const CORAL = '#F3797E';
const INK = '#1F2937';
const MUTED = '#6B7280';

function Mark({ size: px }: { size: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="og-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={INDIGO} />
          <stop offset="1" stopColor={PERIWINKLE} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#og-mark)" />
      <path
        d="M17 47V23l15 15 15-15v24"
        fill="none"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="49" cy="13.5" r="5" fill={SKY} />
    </svg>
  );
}

const COLUMNS = [
  { title: 'New', color: CORNFLOWER, cards: [78, 56] },
  { title: 'Meeting', color: PERIWINKLE, cards: [64, 82, 48] },
  { title: 'Won', color: INDIGO, cards: [70] },
];

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: 'linear-gradient(135deg, #F5F7FF 0%, #EEF1FF 55%, #E4E9FF 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Brand glows */}
      <div
        style={{
          position: 'absolute',
          top: -220,
          right: -140,
          width: 640,
          height: 640,
          borderRadius: 640,
          // Fades to the same colour, transparent: plain `transparent` is black here and greys the glow.
          background: 'radial-gradient(circle, rgba(152,189,255,0.55) 0%, rgba(152,189,255,0) 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -260,
          left: -160,
          width: 620,
          height: 620,
          borderRadius: 620,
          background: 'radial-gradient(circle, rgba(121,120,233,0.33) 0%, rgba(121,120,233,0) 70%)',
        }}
      />

      {/* Left: brand, headline, promise */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 0 0 80px',
          width: 640,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Mark size={64} />
          <span style={{ fontSize: 38, fontWeight: 700, color: INK, letterSpacing: -1 }}>
            Meroidea
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 44,
            fontSize: 66,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2.5,
            color: INK,
          }}
        >
          <span>One workspace to</span>
          <span
            style={{
              backgroundImage: `linear-gradient(90deg, ${INDIGO}, ${PERIWINKLE})`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            run your business
          </span>
        </div>
        <span style={{ marginTop: 28, fontSize: 27, lineHeight: 1.4, color: MUTED }}>
          People, sales, rosters, documents and the numbers behind them — in one place.
        </span>
      </div>

      {/* Right: a glimpse of the workspace */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          paddingRight: 70,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 450,
            borderRadius: 28,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(75,73,172,0.14)',
            boxShadow: '0 30px 80px rgba(75,73,172,0.25)',
            padding: 26,
            transform: 'rotate(-3deg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: CORAL }} />
            <div style={{ width: 12, height: 12, borderRadius: 12, background: SKY }} />
            <div style={{ width: 12, height: 12, borderRadius: 12, background: CORNFLOWER }} />
            <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600, color: INK }}>
              Sales pipeline
            </span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 22 }}>
            {COLUMNS.map((column) => (
              <div
                key={column.title}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  gap: 10,
                  padding: 12,
                  borderRadius: 16,
                  background: '#F5F7FF',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{ width: 10, height: 10, borderRadius: 10, background: column.color }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{column.title}</span>
                </div>
                {column.cards.map((width, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      padding: 11,
                      borderRadius: 12,
                      background: '#fff',
                      boxShadow: '0 4px 12px rgba(31,41,55,0.06)',
                    }}
                  >
                    <div
                      style={{
                        width: `${width}%`,
                        height: 9,
                        borderRadius: 9,
                        background: '#D9DEF5',
                      }}
                    />
                    <div
                      style={{
                        width: `${Math.max(30, width - 30)}%`,
                        height: 9,
                        borderRadius: 9,
                        background: column.color,
                        opacity: 0.55,
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer line */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          bottom: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 21,
          color: INDIGO,
          fontWeight: 600,
        }}
      >
        <div style={{ width: 36, height: 3, borderRadius: 3, background: INDIGO }} />
        crm.meroidea.com
      </div>
    </div>,
    size,
  );
}
