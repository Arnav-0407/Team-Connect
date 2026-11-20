(() => {
  const workspace = document.querySelector(".workspace");
  const sidebar = document.querySelector("#sidebar");
  const divider = document.querySelector("#sidebar-resizer");
  const storageKey = "teamconnect.sidebar-width.v1";
  const minimum = 200;
  const defaultWidth = 250;
  let preferredWidth = defaultWidth;
  let drag = null;

  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved >= minimum && saved <= 480) preferredWidth = saved;
  } catch { /* Resizing still works when browser storage is unavailable. */ }

  function maximum() {
    // Reserve enough space for the chat composer at the desktop breakpoint.
    return Math.max(minimum, Math.min(480, workspace.getBoundingClientRect().width - 366));
  }
  function applyWidth(width) {
    const bounded = Math.round(Math.max(minimum, Math.min(maximum(), width)));
    workspace.style.setProperty("--sidebar-width", `${bounded}px`);
    divider.setAttribute("aria-valuemax", String(maximum()));
    divider.setAttribute("aria-valuenow", String(bounded));
    divider.setAttribute("aria-valuetext", `${bounded} pixels`);
    return bounded;
  }
  function saveWidth() {
    try { localStorage.setItem(storageKey, String(preferredWidth)); } catch { /* Keep the current session's width. */ }
  }
  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const pointerId = drag.pointerId;
    drag = null;
    workspace.classList.remove("resizing");
    if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
    saveWidth();
  }
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus();
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebar.getBoundingClientRect().width };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add("resizing");
  });
  divider.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    preferredWidth = applyWidth(drag.startWidth + event.clientX - drag.startX);
  });
  divider.addEventListener("pointerup", finishDrag);
  divider.addEventListener("pointercancel", finishDrag);
  divider.addEventListener("lostpointercapture", finishDrag);
  divider.addEventListener("keydown", (event) => {
    const current = Number(divider.getAttribute("aria-valuenow"));
    const step = event.shiftKey ? 40 : 10;
    const widths = { ArrowLeft: current - step, ArrowRight: current + step, Home: minimum, End: maximum() };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    preferredWidth = applyWidth(widths[event.key]);
    saveWidth();
  });
  divider.addEventListener("dblclick", () => {
    preferredWidth = applyWidth(defaultWidth);
    saveWidth();
  });
  window.addEventListener("resize", () => {
    finishDrag();
    applyWidth(preferredWidth);
  });
  applyWidth(preferredWidth);
})();
