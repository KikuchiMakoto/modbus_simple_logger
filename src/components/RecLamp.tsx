// The tally light: a blinking dot and the word REC.
//
// Shared by the two places that report a running recording — the footer, which
// is on screen whatever else is, and the Camera card, which is next to the
// picture being recorded. One component so the blink rule below is stated once:
// having it in two files is how the two drift into flashing differently.
export function RecLamp({ className = '', title }: { className?: string; title?: string }) {
  return (
    <span className={className} translate="no" title={title}>
      {/* Only the lamp blinks, not the word: a flashing label is harder to read,
          and it is the light that carries the state. See .rec-blink in
          index.css for why it is a hard on/off rather than a fade. */}
      <span className="rec-blink">●</span> REC
    </span>
  );
}
