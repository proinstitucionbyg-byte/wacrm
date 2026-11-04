// Runs inside the isolated WhatsApp page. Never reads another browser/profile.
export function observeNativeQr(callbackName) {
  if (window.__wacrmNativeQrTimer) clearInterval(window.__wacrmNativeQrTimer);
  let previous = '';
  const tick = () => {
    const holder = document.querySelector('[data-ref]');
    const canvas = holder?.querySelector('canvas');
    if (!canvas || !holder.getAttribute('data-ref') || !canvas.width || !canvas.height) return;
    try {
      const png = canvas.toDataURL('image/png');
      if (png === previous || png.length > 200000 || !png.startsWith('data:image/png;base64,')) return;
      previous = png;
      Promise.resolve(window[callbackName](png)).catch(() => {});
    } catch { /* A transient canvas/navigation is retried without restarting. */ }
  };
  tick();
  window.__wacrmNativeQrTimer = setInterval(tick, 1000);
}
