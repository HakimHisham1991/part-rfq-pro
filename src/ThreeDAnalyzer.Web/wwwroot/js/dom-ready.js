/**
 * Run `fn` when the DOM is ready. Safe for ES modules that may finish
 * loading after DOMContentLoaded already fired (common on slower hosts).
 */
export function onDomReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      Promise.resolve(fn()).catch((err) => console.error(err));
    });
  } else {
    Promise.resolve(fn()).catch((err) => console.error(err));
  }
}
