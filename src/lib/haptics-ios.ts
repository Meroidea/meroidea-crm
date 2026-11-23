/**
 * The iPhone path for tactile feedback (ADR-073, amended by ADR-074).
 *
 * Safari has no `navigator.vibrate`. Since iOS 17.4 it plays a Taptic tick when an
 * `<input type="checkbox" switch>` toggles, and since iOS 26.5 only when that toggle comes from a
 * trusted click: `label.click()` from script no longer ticks. A real tap on a `<label>` tied to the
 * switch still does, because the label forwards the person's own, trusted click.
 *
 * So each pressable control gets a transparent label laid over it (`armIosTap`), tied by id to one
 * hidden switch shared by the page. The tap lands on the label; the label forwards it to the switch
 * (tick) and the click still bubbles to the control, so its handlers run as before. Two WebKit
 * behaviours need correcting (`installIosTapBridge`):
 * - a page handler calling `preventDefault()` (every client-side router link does) makes WebKit
 *   skip the label's forwarding. The call is recorded on the event instead of reaching WebKit, so
 *   the page still reads `defaultPrevented === true`;
 * - the label marks the click as handled, which stops a plain `<a href>` from navigating. When the
 *   page did not prevent the click, the link is followed through a detached copy of the anchor.
 * - engines disagree on whether the label's `DOMActivate` submits an enclosing form (WebKit's
 *   source says yes, Blink's no). For a submit or reset button the bridge cancels it and submits
 *   with `requestSubmit(button)` once the click has finished: one submit on every engine, none
 *   when the page prevented the click.
 *
 * The switch is never under the finger (WebKit marks a touchstart on a switch as handled, which
 * would stop the page scrolling), and `visibility: hidden` keeps it out of hit testing, the
 * accessibility tree and focus.
 */

export const IOS_SWITCH_ID = 'meroidea-haptic-switch';
const OVERLAY_ATTRIBUTE = 'data-haptic-overlay';

/** iPhone, iPod, or an iPad reporting itself as a Mac. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent ?? '';
  return (
    /iP(hone|od|ad)/.test(agent) || (/Macintosh/.test(agent) && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

let switchInput: HTMLInputElement | null = null;

/** The page's one hidden switch, created on first use. */
export function iosSwitch(): HTMLInputElement {
  if (switchInput?.isConnected) return switchInput;
  const existing = document.getElementById(IOS_SWITCH_ID);
  if (existing instanceof HTMLInputElement) {
    switchInput = existing;
    return existing;
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = IOS_SWITCH_ID;
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;margin:0;visibility:hidden;pointer-events:none;';
  document.body.appendChild(input);
  switchInput = input;
  return input;
}

let driverLabel: HTMLLabelElement | null = null;

/**
 * A tick from script, for moments that are not a direct tap (a drop, a saved form). Works on
 * iOS 17.4–26.4; iOS 26.5+ ignores it, as the forwarded click is untrusted.
 */
export function iosProgrammaticTick(): void {
  try {
    if (!driverLabel?.isConnected) {
      const label = document.createElement('label');
      label.htmlFor = iosSwitch().id;
      label.setAttribute('aria-hidden', 'true');
      label.dataset.hapticDriver = '';
      label.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none;';
      document.body.appendChild(label);
      driverLabel = label;
    }
    driverLabel.click();
  } catch {
    // No DOM, or a locked-down one: nothing to do.
  }
}

/** Has React already rendered (hydrated) this element? Adding a child before that breaks hydration. */
function isHydrated(element: Element): boolean {
  for (const key in element) {
    if (key.startsWith('__reactFiber$')) return true;
  }
  return false;
}

const INTERACTIVE_INSIDE = `a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"], label:not([${OVERLAY_ATTRIBUTE}])`;

/**
 * Whether a label can be laid over this control without changing what a tap does. Not over
 * controls that hold other controls (a tap meant for the inner one would land on the label),
 * native inputs (no children), labels, or `<summary>` (its toggle runs on the click's default).
 */
export function canArm(host: Element): boolean {
  if (!(host instanceof HTMLElement)) return false;
  if (host.matches('input, select, textarea, label, summary, details, img, svg, iframe')) {
    return false;
  }
  if (host.querySelector(INTERACTIVE_INSIDE)) return false;
  return isHydrated(host);
}

/** Lays the transparent label over a control. Returns whether it is (now) armed. */
export function armIosTap(host: Element): boolean {
  if (!(host instanceof HTMLElement)) return false;
  if (host.querySelector(`:scope > label[${OVERLAY_ATTRIBUTE}]`)) return true;
  if (!canArm(host)) return false;
  const style = getComputedStyle(host);
  if (style.display === 'contents' || style.display === 'none') return false;
  if (style.position === 'static') host.style.position = 'relative';
  const label = document.createElement('label');
  label.htmlFor = iosSwitch().id;
  label.setAttribute(OVERLAY_ATTRIBUTE, '');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:absolute;inset:0;border-radius:inherit;cursor:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent;';
  host.appendChild(label);
  return true;
}

/** Removes every label, e.g. when the person turns feedback off. */
export function disarmAll(): void {
  document.querySelectorAll(`label[${OVERLAY_ATTRIBUTE}]`).forEach((label) => label.remove());
}

export function isIosOverlay(target: EventTarget | null): target is HTMLLabelElement {
  return target instanceof HTMLLabelElement && target.hasAttribute(OVERLAY_ATTRIBUTE);
}

type PendingTap = { label: HTMLLabelElement; prevented: boolean };

const LINK_ATTRIBUTES = [
  'href',
  'target',
  'rel',
  'download',
  'referrerpolicy',
  'hreflang',
  'type',
  'ping',
];

/** The form button a tap was meant for, if it submits or resets a form. */
function formButtonOf(label: HTMLLabelElement): HTMLButtonElement | null {
  const control = label.parentElement?.closest('button, a[href]');
  return control instanceof HTMLButtonElement &&
    control.form &&
    !control.disabled &&
    (control.type === 'submit' || control.type === 'reset')
    ? control
    : null;
}

/**
 * Engines differ on whether the label's DOMActivate submits an enclosing form (WebKit's source
 * does; Blink's does not). So the bridge always cancels that DOMActivate and submits itself,
 * exactly once, after the click has finished: the same result on every engine.
 */
function activateFormButton(label: HTMLLabelElement): void {
  const button = formButtonOf(label);
  if (!button?.form) return;
  if (button.type === 'submit') button.form.requestSubmit(button);
  else button.form.reset();
}

/** Follows the link a tap was meant for, unless it was a form's submit or reset button. */
function followLink(label: HTMLLabelElement): void {
  for (let node = label.parentElement; node; node = node.parentElement) {
    if (
      node instanceof HTMLButtonElement &&
      (node.type === 'submit' || node.type === 'reset') &&
      node.form
    ) {
      return;
    }
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
      // A detached anchor still navigates (honouring target, download, rel), and its click
      // reaches no listener in the page, so nothing runs twice.
      const proxy = document.createElement('a');
      for (const name of LINK_ATTRIBUTES) {
        const value = node.getAttribute(name);
        if (value !== null) proxy.setAttribute(name, value);
      }
      proxy.click();
      return;
    }
  }
}

/**
 * Window-level listeners that keep links, router links and forms behaving exactly as without the
 * labels. `resolveHost` finds the control a press belongs to (or null when it gives no feedback);
 * labels are added after hydration and, as a fallback, at the start of a touch.
 */
export function installIosTapBridge(resolveHost: (target: EventTarget | null) => Element | null) {
  let pending: PendingTap | undefined;

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === IOS_SWITCH_ID) {
      // The label's forwarded copy: its tick has played; the page must not see a second click.
      event.stopImmediatePropagation();
      if (event.isTrusted && pending && !pending.prevented) followLink(pending.label);
      return;
    }
    if (!isIosOverlay(target)) return;
    const host = target.parentElement;
    if (host?.matches(':disabled, [aria-disabled="true"], [data-disabled]')) {
      event.preventDefault();
      return;
    }
    const tap: PendingTap = { label: target, prevented: false };
    pending = tap;
    window.setTimeout(() => {
      if (pending === tap) pending = undefined;
      if (!tap.prevented) activateFormButton(tap.label);
    }, 0);
    Object.defineProperties(event, {
      preventDefault: {
        configurable: true,
        value: () => {
          if (event.cancelable) tap.prevented = true;
        },
      },
      defaultPrevented: { configurable: true, get: () => tap.prevented },
      returnValue: {
        configurable: true,
        get: () => !tap.prevented,
        set: (value: boolean) => {
          if (!value && event.cancelable) tap.prevented = true;
        },
      },
    });
  };

  // The label's DOMActivate may submit an enclosing form: cancel it when the page prevented the
  // tap, and for form buttons always, since activateFormButton submits instead.
  const onActivate = (event: Event) => {
    const tap = pending;
    if (!tap || event.target !== tap.label) return;
    if (tap.prevented || formButtonOf(tap.label)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };

  const armFrom = (target: EventTarget | null) => {
    const host = resolveHost(target);
    if (host) armIosTap(host);
  };
  const onPointerDown = (event: PointerEvent) => armFrom(event.target);

  // Arm what is on screen once the page is idle, then whatever arrives later.
  let scheduled = false;
  const armAll = () => {
    scheduled = false;
    document
      .querySelectorAll('button, a[href], [role], [data-haptic]')
      .forEach((element) => armFrom(element));
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const idle = (
      window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (idle) idle(armAll, { timeout: 500 });
    else window.setTimeout(armAll, 200);
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => Array.from(record.addedNodes).some((node) => !isIosOverlay(node)))
    ) {
      schedule();
    }
  });

  window.addEventListener('click', onClick, true);
  window.addEventListener('DOMActivate', onActivate, true);
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();

  return () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('DOMActivate', onActivate, true);
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    observer.disconnect();
    disarmAll();
  };
}

/** Test-only. */
export function resetIosHapticsForTests(): void {
  switchInput = null;
  driverLabel = null;
}
