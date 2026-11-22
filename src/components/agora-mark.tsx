export const AGORA_MARK_HUMAN =
  "M286 0A286 286 0 0 0 286 572ZM172 215a52 52 0 1 0 0 104a52 52 0 1 0 0-104Z";
export const AGORA_MARK_AGENT =
  "M334 0H510A110 110 0 0 1 620 110V572H334ZM396 214v104h104V214Z";

export function AgoraMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 620 572"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path fillRule="evenodd" d={AGORA_MARK_HUMAN + AGORA_MARK_AGENT} />
    </svg>
  );
}
