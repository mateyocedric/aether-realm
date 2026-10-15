export function textEntryHasFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.isContentEditable || !!active.closest('input, textarea, select'));
}
