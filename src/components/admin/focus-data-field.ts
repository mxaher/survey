/**
 * Focus the form control rendered inside `[data-field="<name>"]`.
 *
 * Used by the readiness «إصلاح» shortcut to land the admin on the exact
 * control that fixes an issue. The target may not be mounted yet (the
 * settings form sits behind a query and, from other pages, a tab switch),
 * so we poll briefly before giving up.
 */
export function focusDataField(field: string, timeoutMs = 5000): void {
  if (typeof document === "undefined" || !field) return;

  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tryFocus = (): boolean => {
    const el = document.querySelector<HTMLElement>(
      `[data-field="${field}"] textarea, [data-field="${field}"] input`
    );
    if (el) {
      if (timer) clearInterval(timer);
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }
    if (Date.now() - started > timeoutMs && timer) clearInterval(timer);
    return false;
  };

  if (tryFocus()) return;
  timer = setInterval(tryFocus, 100);
}
