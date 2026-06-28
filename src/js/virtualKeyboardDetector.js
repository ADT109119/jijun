/**
 * Virtual Keyboard Detector
 * Detects when the mobile virtual keyboard appears/disappears using a layered fallback strategy.
 *
 * Layer 1: VirtualKeyboard API (Chrome Android 118+)
 * Layer 2: Visual Viewport API (cross-platform)
 * Layer 3: Focus/Blur event delegation (universal fallback)
 */

export class VirtualKeyboardDetector {
  constructor({ onShow, onHide, threshold = 150 }) {
    this.onShow = onShow;
    this.onHide = onHide;
    this.threshold = threshold; // Height difference that counts as keyboard
    this.initialHeight = null;
    this.isVirtualKeyboardVisible = false;
    this._cleanup = null;
    this._bindedResize = this._onVisualViewportResize.bind(this);
    this._bindedOrientationChange = this._onOrientationChange.bind(this);
    this._docFocusHandler = this._onDocFocus.bind(this);
    this._docBlurHandler = this._onDocBlur.bind(this);
  }

  start() {
    const cleanups = [];

    // Layer 1: VirtualKeyboard API (Chrome Android 118+)
    if ('virtualKeyboard' in navigator) {
      const vk = navigator.virtualKeyboard;
      const handler = () => {
        const geom = vk.geometry;
        this._setState(!!geom && geom.height > 0);
      };
      vk.addEventListener('geometrychange', handler);
      cleanups.push(() => vk.removeEventListener('geometrychange', handler));
    }

    // Layer 2: Visual Viewport API (Chrome 60+, iOS Safari, Firefox)
    if (window.visualViewport) {
      this.initialHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', this._bindedResize);
      window.addEventListener('orientationchange', this._bindedOrientationChange);
      cleanups.push(() => {
        window.visualViewport.removeEventListener('resize', this._bindedResize);
        window.removeEventListener('orientationchange', this._bindedOrientationChange);
      });
    }

    // Layer 3: Focus/Blur event delegation (universal fallback)
    this._attachFocusBlur();
    if (this._cleanup) {
      cleanups.push(this._cleanup);
    }

    this._cleanup = () => {
      cleanups.forEach(fn => {
        try {
          fn();
        } catch (e) {
          console.error('Failed to cleanup keyboard detector:', e);
        }
      });
    };
  }

  /**
   * Visual Viewport resize handler.
   * Compares current height against initial height to detect keyboard.
   */
  _onVisualViewportResize() {
    if (!this.initialHeight) return;
    const diff = this.initialHeight - window.visualViewport.height;
    if (diff > this.threshold) {
      this._setState(true);
    } else if (diff < this.threshold / 2) {
      this._setState(false);
    }
  }

  /**
   * Reset initial height on orientation change to prevent false positives.
   */
  _onOrientationChange() {
    this.initialHeight = window.visualViewport.height;
  }

  /**
   * Document-level focus handler (Layer 3 fallback).
   */
  _onDocFocus(e) {
    const target = e.target;
    if (target.matches('input[type="text"], textarea, input[type="search"], input[type="email"]')) {
      this._setState(true);
    }
  }

  /**
   * Document-level blur handler (Layer 3 fallback).
   * Uses timeout to handle iOS Safari blur delay.
   */
  _onDocBlur(e) {
    const target = e.target;
    if (target.matches('input[type="text"], textarea, input[type="search"], input[type="email"]')) {
      setTimeout(() => {
        if (document.activeElement === document.body ||
            document.activeElement === document.documentElement) {
          this._setState(false);
        }
      }, 300);
    }
  }

  _attachFocusBlur() {
    // Use capturing phase so focus/blur events are caught
    document.addEventListener('focusin', this._docFocusHandler, true);
    document.addEventListener('focusout', this._docBlurHandler, true);
    this._cleanup = () => {
      document.removeEventListener('focusin', this._docFocusHandler, true);
      document.removeEventListener('focusout', this._docBlurHandler, true);
    };
  }

  _setState(isVisible) {
    if (this.isVirtualKeyboardVisible === isVisible) return;
    this.isVirtualKeyboardVisible = isVisible;
    if (isVisible) this.onShow();
    else this.onHide();
  }

  destroy() {
    if (this._cleanup) this._cleanup();
  }
}
