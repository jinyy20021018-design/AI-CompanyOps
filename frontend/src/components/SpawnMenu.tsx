import { useEffect, useRef } from "react";

export type SpawnOption = "claude" | "codex";

type Props = {
  x: number;
  y: number;
  onSelect: (option: SpawnOption) => void;
  onClose: () => void;
};

const OPTIONS: { id: SpawnOption; label: string; hint: string }[] = [
  { id: "claude", label: "Claude", hint: "claude" },
  { id: "codex", label: "Codex", hint: "codex" },
];

export function SpawnMenu({ x, y, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="spawn-menu"
      style={{ left: x, top: y }}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          className="spawn-menu-item"
          onClick={() => onSelect(opt.id)}
        >
          <span className="spawn-menu-label">{opt.label}</span>
          <span className="spawn-menu-hint">{opt.hint}</span>
        </button>
      ))}
    </div>
  );
}
