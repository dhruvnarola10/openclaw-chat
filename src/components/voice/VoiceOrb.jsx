// Animated orb that reacts to mic level and voice state.
// Renders a layered set of circles that scale/pulse based on `level` (0–1)
// and the current `state`.

export default function VoiceOrb({ state, level, onClick }) {
  // Base scale + extra based on live audio level (only meaningful when listening)
  const liveScale = state === 'listening' ? 1 + level * 0.55 : 1;

  return (
    <div
      className={`voice-orb-wrap voice-orb--${state}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      {/* Outermost ripple ring — only when listening or speaking */}
      {(state === 'listening' || state === 'speaking') && (
        <>
          <div className="voice-ring voice-ring--3" />
          <div className="voice-ring voice-ring--2" />
        </>
      )}

      {/* Core orb */}
      <div
        className="voice-orb-core"
        style={{ transform: `scale(${liveScale})` }}
      >
        <OrbIcon state={state} />
      </div>
    </div>
  );
}

function OrbIcon({ state }) {
  if (state === 'listening') {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="8"  y1="22" x2="16" y2="22" />
      </svg>
    );
  }
  if (state === 'processing' || state === 'loading') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="orb-spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (state === 'speaking') {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    );
  }
  // idle — tap to speak
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8"  y1="22" x2="16" y2="22" />
    </svg>
  );
}
