/** Shared modal open/close for Settings pages (Tool-Master-Control pattern). */

export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.add('active');
  document.body.style.overflow = 'hidden';
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.remove('active');
  document.body.style.overflow = '';
}

export function bindModal(modalId, { onClose } = {}) {
  const el = document.getElementById(modalId);
  if (!el) return;

  el.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(modalId);
      onClose?.();
    });
  });

  const backdrop = el.querySelector('.modal-backdrop');
  backdrop?.addEventListener('click', () => {
    closeModal(modalId);
    onClose?.();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('active')) {
      closeModal(modalId);
      onClose?.();
    }
  });
}

export function showModalError(errorEl, message) {
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.add('visible');
}
