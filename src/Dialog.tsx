import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

interface Props {
  title: string;
  onCancel: () => void;
  wide?: boolean;
  children: ReactNode;
}

/** Native modal <dialog>: scrim via ::backdrop, Esc via the cancel event. Focuses `[data-autofocus]` on open. */
export function Dialog({ title, onCancel, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => d.close();
  }, []);

  // showModal makes the rest inert; this wraps Tab so focus never leaves the dialog.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const f = ref.current!.querySelectorAll<HTMLElement>("button:not([disabled])");
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={trap}
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/ or Ctrl+F", "Focus filter"],
  ["Esc", "In filter: clear it, then return focus to list · In dialog: cancel"],
  ["↑ / ↓", "Move selection"],
  ["Home / End", "First / last row"],
  ["PgUp / PgDn", "Move by a page"],
  ["Enter", "From filter: focus list and select first row"],
  ["Alt+1 / Alt+2 / Alt+3", "Protocol All / TCP / UDP"],
  ["Ctrl+C", "Copy address of selected row (when focus is not in a text field)"],
  ["Ctrl+Shift+C", "Copy PID"],
  ["O", "Open in browser (TCP rows)"],
  ["Delete", "Stop selected process (opens confirm)"],
  ["P", "Pause / resume auto-refresh"],
  ["F5 or Ctrl+R", "Refresh now"],
  ["?", "Show shortcuts overlay"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" wide onCancel={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([key, action]) => (
            <tr key={key}>
              <th scope="row"><kbd>{key}</kbd></th>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" className="btn" data-autofocus onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
