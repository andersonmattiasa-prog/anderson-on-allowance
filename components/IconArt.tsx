// Rendered to PNG by next/og for the home-screen icon, favicon and manifest icons.
export function IconArt({ size, padded = false }: { size: number; padded?: boolean }) {
  const coin = Math.round(size * (padded ? 0.5 : 0.62));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(145deg, #0f5a41 0%, #0b3d2e 60%, #082a20 100%)',
      }}
    >
      <div
        style={{
          width: coin,
          height: coin,
          borderRadius: coin,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #f7dc8a 0%, #d4a72c 55%, #a97c12 100%)',
          boxShadow: `0 ${size * 0.02}px ${size * 0.06}px rgba(0,0,0,0.35)`,
          border: `${Math.max(2, size * 0.018)}px solid #f9e7a8`,
          color: '#0b3d2e',
          fontSize: coin * 0.62,
          fontWeight: 800,
          fontFamily: 'serif',
          lineHeight: 1,
          paddingBottom: coin * 0.04,
        }}
      >
        A
      </div>
    </div>
  );
}
