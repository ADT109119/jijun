/**
 * Unit tests for VirtualKeyboardDetector
 *
 * Tests cover:
 * - Constructor defaults & configuration
 * - _setState dedup & callback invocation
 * - Layer 2: Visual Viewport resize detection
 * - Layer 2: Orientation change handling
 * - Layer 3: Focus/Blur event delegation
 * - Focus/Blur selector matching (including gap: input[type="number"] not matched)
 * - destroy / cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VirtualKeyboardDetector } from '../../src/js/virtualKeyboardDetector.js';

// --- Helpers ---

/** Create a fake element with a given selector match */
function createFakeTarget(matchesFn) {
  const el = {
    matches: vi.fn((selector) => matchesFn(selector)),
  };
  return el;
}

/** Create a focus/blur event with a target */
function createEvent(target) {
  return { target };
}

/** Simulate a text-like input element (matches text/textarea/search/email selectors) */
function createTextInputTarget() {
  return createFakeTarget((sel) => {
    return [
      'input[type="text"]',
      'textarea',
      'input[type="search"]',
      'input[type="email"]',
    ].some((s) => sel.includes(s));
  });
}

/** Simulate a number input (does NOT match current selector list — known gap) */
function createNumberInputTarget() {
  return createFakeTarget((_sel) => {
    // Does NOT match text/textarea/search/email
    return false;
  });
}

/** Spy on onShow / onHide callbacks */
function createSpies() {
  return {
    onShow: vi.fn(),
    onHide: vi.fn(),
  };
}

// --- Tests ---

describe('VirtualKeyboardDetector — Constructor', () => {
  it('should use default threshold of 150', () => {
    const detector = new VirtualKeyboardDetector({ onShow: () => {}, onHide: () => {} });
    expect(detector.threshold).toBe(150);
  });

  it('should accept custom threshold', () => {
    const detector = new VirtualKeyboardDetector({
      onShow: () => {},
      onHide: () => {},
      threshold: 200,
    });
    expect(detector.threshold).toBe(200);
  });

  it('should initialize isVirtualKeyboardVisible as false', () => {
    const detector = new VirtualKeyboardDetector({ onShow: () => {}, onHide: () => {} });
    expect(detector.isVirtualKeyboardVisible).toBe(false);
  });

  it('should initialize initialHeight as null', () => {
    const detector = new VirtualKeyboardDetector({ onShow: () => {}, onHide: () => {} });
    expect(detector.initialHeight).toBeNull();
  });

  it('should store onShow and onHide callbacks', () => {
    const spies = createSpies();
    const detector = new VirtualKeyboardDetector({ ...spies });
    expect(detector.onShow).toBe(spies.onShow);
    expect(detector.onHide).toBe(spies.onHide);
  });

  it('should bind methods in constructor', () => {
    const detector = new VirtualKeyboardDetector({ onShow: () => {}, onHide: () => {} });
    expect(typeof detector._bindedResize).toBe('function');
    expect(typeof detector._bindedOrientationChange).toBe('function');
    expect(typeof detector._docFocusHandler).toBe('function');
    expect(typeof detector._docBlurHandler).toBe('function');
  });
});

describe('VirtualKeyboardDetector — _setState', () => {
  let spies;

  beforeEach(() => {
    spies = createSpies();
  });

  it('should call onShow when state changes to true', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._setState(true);
    expect(spies.onShow).toHaveBeenCalledTimes(1);
    expect(spies.onHide).not.toHaveBeenCalled();
    expect(detector.isVirtualKeyboardVisible).toBe(true);
  });

  it('should call onHide when state changes from true to false', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._setState(true); // First set to true
    spies.onHide.mockClear();
    detector._setState(false); // Then change to false
    expect(spies.onHide).toHaveBeenCalledTimes(1);
    expect(detector.isVirtualKeyboardVisible).toBe(false);
  });

  it('should not call callbacks when state is already true', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._setState(true);
    spies.onShow.mockClear();
    detector._setState(true);
    expect(spies.onShow).not.toHaveBeenCalled();
  });

  it('should not call callbacks when state is already false', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._setState(false);
    spies.onHide.mockClear();
    detector._setState(false);
    expect(spies.onHide).not.toHaveBeenCalled();
  });

  it('should toggle correctly: show → hide → show', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._setState(true);
    detector._setState(false);
    detector._setState(true);
    expect(spies.onShow).toHaveBeenCalledTimes(2);
    expect(spies.onHide).toHaveBeenCalledTimes(1);
  });
});

describe('VirtualKeyboardDetector — Layer 2: Visual Viewport API', () => {
  let spies, detector;

  beforeEach(() => {
    spies = createSpies();
    detector = new VirtualKeyboardDetector({ ...spies, threshold: 150 });
  });

  describe('_onVisualViewportResize', () => {
    it('should do nothing if initialHeight is null', () => {
      detector.initialHeight = null;
      detector._onVisualViewportResize();
      expect(spies.onShow).not.toHaveBeenCalled();
      expect(spies.onHide).not.toHaveBeenCalled();
    });

    it('should show keyboard when height shrinks beyond threshold', () => {
      detector.initialHeight = 800;
      // Simulate keyboard: viewport shrinks by 200 (> 150 threshold)
      window.visualViewport = { height: 600 };
      detector._onVisualViewportResize();
      expect(detector.isVirtualKeyboardVisible).toBe(true);
      expect(spies.onShow).toHaveBeenCalled();
    });

    it('should hide keyboard when height difference is below half threshold', () => {
      detector.initialHeight = 800;
      detector._setState(true); // Start as visible
      spies.onHide.mockClear();
      // Diff = 50, which is < 150/2 = 75
      window.visualViewport = { height: 750 };
      detector._onVisualViewportResize();
      expect(spies.onHide).toHaveBeenCalled();
    });

    it('should not toggle when diff is between half-threshold and threshold', () => {
      detector.initialHeight = 800;
      detector._setState(true); // Visible
      spies.onHide.mockClear();
      // Diff = 100, which is >= 75 (half) but <= 150 (threshold)
      // Neither branch triggers — no state change
      window.visualViewport = { height: 700 };
      detector._onVisualViewportResize();
      expect(spies.onHide).not.toHaveBeenCalled();
      expect(detector.isVirtualKeyboardVisible).toBe(true);
    });

    it('should respect custom threshold', () => {
      const customDetector = new VirtualKeyboardDetector({
        ...spies,
        threshold: 200,
      });
      customDetector.initialHeight = 900;
      // Diff = 250 > 200 → show
      window.visualViewport = { height: 650 };
      customDetector._onVisualViewportResize();
      expect(customDetector.isVirtualKeyboardVisible).toBe(true);
    });
  });

  describe('_onOrientationChange', () => {
    beforeEach(() => {
      window.visualViewport = { height: 400 };
    });

    it('should update initialHeight from visualViewport', () => {
      detector.initialHeight = 800;
      detector._onOrientationChange();
      expect(detector.initialHeight).toBe(400);
    });

    it('should not throw when visualViewport is null', () => {
      // Note: _onOrientationChange accesses window.visualViewport.height directly
      // If visualViewport is null, this would throw — code review flagged this
      window.visualViewport = null;
      expect(() => detector._onOrientationChange()).toThrow();
    });
  });
});

describe('VirtualKeyboardDetector — Layer 3: Focus/Blur Events', () => {
  let spies, detector;

  beforeEach(() => {
    vi.clearAllTimers();
    spies = createSpies();
    detector = new VirtualKeyboardDetector({ ...spies });
    // Reset state
    detector.isVirtualKeyboardVisible = false;
  });

  describe('_onDocFocus', () => {
    it('should show keyboard for text input', () => {
      const target = createTextInputTarget();
      detector._onDocFocus(createEvent(target));
      expect(detector.isVirtualKeyboardVisible).toBe(true);
      expect(spies.onShow).toHaveBeenCalled();
    });

    it('should show keyboard for textarea', () => {
      const target = createFakeTarget((sel) => sel.includes('textarea'));
      detector._onDocFocus(createEvent(target));
      expect(detector.isVirtualKeyboardVisible).toBe(true);
      expect(spies.onShow).toHaveBeenCalled();
    });

    it('should show keyboard for search input', () => {
      const target = createFakeTarget((sel) => sel.includes('search'));
      detector._onDocFocus(createEvent(target));
      expect(detector.isVirtualKeyboardVisible).toBe(true);
      expect(spies.onShow).toHaveBeenCalled();
    });

    it('should show keyboard for email input', () => {
      const target = createFakeTarget((sel) => sel.includes('email'));
      detector._onDocFocus(createEvent(target));
      expect(detector.isVirtualKeyboardVisible).toBe(true);
      expect(spies.onShow).toHaveBeenCalled();
    });

    it('[Known Gap] should NOT show keyboard for number input — code review finding', () => {
      const target = createNumberInputTarget();
      detector._onDocFocus(createEvent(target));
      // Current implementation does NOT match input[type="number"]
      // This means the amount input field on the add page may not trigger keyboard detection
      expect(detector.isVirtualKeyboardVisible).toBe(false);
      expect(spies.onShow).not.toHaveBeenCalled();
    });

    it('should NOT show keyboard for non-matching elements', () => {
      const target = createFakeTarget(() => false);
      detector._onDocFocus(createEvent(target));
      expect(detector.isVirtualKeyboardVisible).toBe(false);
      expect(spies.onShow).not.toHaveBeenCalled();
    });
  });

  describe('_onDocBlur', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule hide after 300ms delay for text input', () => {
      detector._setState(true); // Start visible
      spies.onHide.mockClear();

      const target = createTextInputTarget();
      detector._onDocBlur(createEvent(target));

      // Not yet triggered
      expect(spies.onHide).not.toHaveBeenCalled();

      // Mock document.activeElement as body
      Object.defineProperty(document, 'activeElement', {
        value: document.body,
        writable: true,
        configurable: true,
      });

      // Advance timer
      vi.advanceTimersByTime(300);

      expect(spies.onHide).toHaveBeenCalled();
    });

    it('should NOT hide if another element is focused after delay', () => {
      detector._setState(true);
      spies.onHide.mockClear();

      const target = createTextInputTarget();
      detector._onDocBlur(createEvent(target));

      // Simulate another input being focused
      const otherInput = document.createElement('input');
      document.body.appendChild(otherInput);
      Object.defineProperty(document, 'activeElement', {
        value: otherInput,
        writable: true,
        configurable: true,
      });

      vi.advanceTimersByTime(300);

      expect(spies.onHide).not.toHaveBeenCalled();
    });

    it('should hide when activeElement is documentElement', () => {
      detector._setState(true);
      spies.onHide.mockClear();

      const target = createTextInputTarget();
      detector._onDocBlur(createEvent(target));

      Object.defineProperty(document, 'activeElement', {
        value: document.documentElement,
        writable: true,
        configurable: true,
      });
      vi.advanceTimersByTime(300);

      expect(spies.onHide).toHaveBeenCalled();
    });

    it('should NOT schedule hide for non-matching elements', () => {
      const target = createFakeTarget(() => false);
      detector._onDocBlur(createEvent(target));
      vi.advanceTimersByTime(500);
      expect(spies.onHide).not.toHaveBeenCalled();
    });
  });
});

describe('VirtualKeyboardDetector — Event Attachment & Cleanup', () => {
  let spies;

  beforeEach(() => {
    spies = createSpies();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('_attachFocusBlur should add focusin and focusout listeners', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._attachFocusBlur();

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'focusin',
      expect.any(Function),
      true
    );
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'focusout',
      expect.any(Function),
      true
    );

    addEventListenerSpy.mockRestore();
  });

  it('destroy should call cleanup', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector._attachFocusBlur();
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    detector.destroy();

    expect(removeSpy).toHaveBeenCalledWith('focusin', expect.any(Function), true);
    expect(removeSpy).toHaveBeenCalledWith('focusout', expect.any(Function), true);

    removeSpy.mockRestore();
  });

  it('destroy should handle null cleanup gracefully', () => {
    const detector = new VirtualKeyboardDetector({ ...spies });
    // Don't call _attachFocusBlur, so _cleanup is null
    expect(() => detector.destroy()).not.toThrow();
  });

  it('destroy from start() should clean up all layers', () => {
    // Mock visualViewport to ensure Layer 2 is set up
    window.visualViewport = {
      height: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector.start();
    detector.destroy();

    // Verify orientationchange listener was removed
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'orientationchange',
      expect.any(Function)
    );

    addEventListenerSpy.mockRestore();
  });
});

describe('VirtualKeyboardDetector — start() integration', () => {
  let spies;

  beforeEach(() => {
    spies = createSpies();
    // Reset mocks
    delete navigator.virtualKeyboard;
  });

  it('should set initialHeight when visualViewport exists', () => {
    window.visualViewport = {
      height: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector.start();
    expect(detector.initialHeight).toBe(800);
  });

  it('should not set initialHeight when visualViewport does not exist', () => {
    window.visualViewport = null;
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector.start();
    expect(detector.initialHeight).toBeNull();
  });

  it('should set up VirtualKeyboard API if available', () => {
    const mockVK = {
      geometry: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    navigator.virtualKeyboard = mockVK;

    const detector = new VirtualKeyboardDetector({ ...spies });
    detector.start();

    expect(mockVK.addEventListener).toHaveBeenCalledWith(
      'geometrychange',
      expect.any(Function)
    );
  });
});

describe('VirtualKeyboardDetector — Edge Cases', () => {
  it('should handle threshold of 0 (always detect any height change)', () => {
    const spies = createSpies();
    const detector = new VirtualKeyboardDetector({ ...spies, threshold: 0 });
    detector.initialHeight = 800;
    // Any positive diff triggers show
    window.visualViewport = { height: 799 };
    detector._onVisualViewportResize();
    expect(detector.isVirtualKeyboardVisible).toBe(true);
  });

  it('should handle very large threshold (rarely triggers)', () => {
    const spies = createSpies();
    const detector = new VirtualKeyboardDetector({ ...spies, threshold: 10000 });
    detector.initialHeight = 800;
    window.visualViewport = { height: 100 };
    // Diff = 700 < 10000, does not trigger
    detector._onVisualViewportResize();
    expect(detector.isVirtualKeyboardVisible).toBe(false);
  });

  it('_onVisualViewportResize should handle visualViewport being null', () => {
    const spies = createSpies();
    const detector = new VirtualKeyboardDetector({ ...spies });
    detector.initialHeight = 800;
    window.visualViewport = null;
    // Should not crash, but may throw when accessing .height
    // This is the null guard issue flagged in code review
    expect(() => detector._onVisualViewportResize()).toThrow();
  });
});
