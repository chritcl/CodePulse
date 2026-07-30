import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIslandAnimation } from './useIslandAnimation';

describe('useIslandAnimation', () => {
  let frameCallbacks: FrameRequestCallback[];
  let currentTime: number;

  beforeEach(() => {
    frameCallbacks = [];
    currentTime = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('点击按压回弹始终在目标缩放和原尺寸之间并恢复样式', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('div');
    element.style.transform = 'rotate(1deg)';
    element.style.transformOrigin = 'left top';
    element.style.willChange = 'opacity';

    const finished = animation.playPressSpring(element);

    currentTime = 45;
    frameCallbacks.shift()?.(45);
    const pressedScale = Number(element.style.transform.match(/^scale\(([\d.]+)\)$/)?.[1]);

    currentTime = 90;
    frameCallbacks.shift()?.(90);

    const releaseScales: number[] = [];
    for (const time of [110, 130, 150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350]) {
      const callback = frameCallbacks.shift();
      expect(callback).toBeDefined();
      currentTime = time;
      callback?.(time);
      const match = element.style.transform.match(/^scale\(([\d.]+)\)$/);
      expect(match).not.toBeNull();
      releaseScales.push(Number(match?.[1]));
    }

    currentTime = 370;
    frameCallbacks.shift()?.(370);
    await finished;

    expect(pressedScale).toBeGreaterThan(0.92);
    expect(pressedScale).toBeLessThan(1);
    expect(releaseScales.every((scale) => scale >= 0.92 && scale <= 1)).toBe(true);
    expect(element.style.transform).toBe('rotate(1deg)');
    expect(element.style.transformOrigin).toBe('left top');
    expect(element.style.willChange).toBe('opacity');
  });

  it('卫星内容换入主岛时变换轨迹不会越过起点与终点边界', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 0, 260, 42));
    const fromRect = new DOMRect(10, 8, 26, 26);

    const finished = animation.playFlipSpring(element, fromRect);
    const transforms: string[] = [element.style.transform];

    for (const time of [40, 80, 120, 160, 200, 240, 280, 320, 360]) {
      const callback = frameCallbacks.shift();
      expect(callback).toBeDefined();
      currentTime = time;
      callback?.(time);
      transforms.push(element.style.transform);
    }

    await finished;

    for (const transform of transforms.slice(0, -1)) {
      const match = transform.match(
        /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+), ([-\d.]+)\)$/
      );
      expect(match).not.toBeNull();

      const [, xText, yText, scaleXText, scaleYText] = match!;
      const x = Number(xText);
      const y = Number(yText);
      const scaleX = Number(scaleXText);
      const scaleY = Number(scaleYText);

      expect(x).toBeGreaterThanOrEqual(-187);
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(scaleX).toBeGreaterThanOrEqual(0.1);
      expect(scaleX).toBeLessThanOrEqual(1);
      expect(scaleY).toBeGreaterThanOrEqual(26 / 42);
      expect(scaleY).toBeLessThanOrEqual(1);
    }
  });

  it('原主岛内容换回卫星时不会反向越过卫星终点', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('div');
    const visual = document.createElement('span');
    visual.dataset.flipVisual = '';
    element.append(visual);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 8, 26, 26));
    const fromRect = new DOMRect(80, 0, 260, 42);

    const finished = animation.playFlipSpring(element, fromRect);
    const transforms: string[] = [element.style.transform];
    const visualOpacities: string[] = [visual.style.opacity];

    for (const time of [40, 80, 120, 160, 200, 240, 280, 320, 360]) {
      const callback = frameCallbacks.shift();
      expect(callback).toBeDefined();
      currentTime = time;
      callback?.(time);
      transforms.push(element.style.transform);
      visualOpacities.push(visual.style.opacity);
    }

    await finished;

    for (const transform of transforms.slice(0, -1)) {
      const match = transform.match(
        /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+), ([-\d.]+)\)$/
      );
      expect(match).not.toBeNull();

      const [, xText, yText, scaleXText, scaleYText] = match!;
      const x = Number(xText);
      const y = Number(yText);
      const scaleX = Number(scaleXText);
      const scaleY = Number(scaleYText);

      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(187);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(scaleX).toBeGreaterThanOrEqual(1);
      expect(scaleX).toBeLessThanOrEqual(10);
      expect(scaleY).toBeGreaterThanOrEqual(1);
      expect(scaleY).toBeLessThanOrEqual(42 / 26);
    }

    expect(visualOpacities.slice(0, 6)).toEqual(['0', '0', '0', '0', '0', '0']);
    expect(Number(visualOpacities[6])).toBeGreaterThan(0);
    expect(visual.style.opacity).toBe('');
  });

  it('原主岛退回卫星位时不会把卫星外壳拉成长条', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('button');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 8, 26, 26));
    const fromRect = new DOMRect(80, 0, 260, 42);

    const finished = animation.playFlipSpring(element, fromRect);
    const transforms: string[] = [element.style.transform];

    for (const time of [40, 80, 120, 160, 200, 240, 280, 320, 360]) {
      const callback = frameCallbacks.shift();
      expect(callback).toBeDefined();
      currentTime = time;
      callback?.(time);
      transforms.push(element.style.transform);
    }

    await finished;

    for (const transform of transforms.slice(0, -1)) {
      const match = transform.match(
        /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+), ([-\d.]+)\)$/
      );
      expect(match).not.toBeNull();

      const scaleX = Number(match?.[3]);
      const scaleY = Number(match?.[4]);
      expect(26 * scaleX).toBeLessThanOrEqual(26);
      expect(26 * scaleY).toBeLessThanOrEqual(26);
    }
  });

  it('详情向上缩退后主岛执行一次受边界约束的回弹', () => {
    const animation = useIslandAnimation();
    const stack = document.createElement('div');
    stack.className = 'island-stack';
    const main = document.createElement('div');
    main.className = 'main-island-frame';
    const detail = document.createElement('div');
    detail.className = 'expanded-detail-panel';
    stack.append(main, detail);
    const done = vi.fn();

    animation.onDetailLeave(detail, done);

    currentTime = 80;
    frameCallbacks.shift()?.(80);
    expect(detail.style.transform).toMatch(/^translateY\(-[\d.]+px\) scale\(0\.\d+\)$/);
    expect(done).not.toHaveBeenCalled();

    currentTime = 160;
    frameCallbacks.shift()?.(160);
    expect(done).toHaveBeenCalledOnce();
    expect(main.style.transform).toBe('scale(0.96)');

    const bounceScales: number[] = [];
    for (const time of [200, 240, 280, 320, 360, 400, 420]) {
      const callback = frameCallbacks.shift();
      expect(callback).toBeDefined();
      currentTime = time;
      callback?.(time);
      const match = main.style.transform.match(/^scale\(([\d.]+)\)$/);
      if (match) bounceScales.push(Number(match[1]));
    }

    expect(bounceScales.length).toBeGreaterThan(0);
    expect(bounceScales.every((scale) => scale >= 0.96 && scale <= 1)).toBe(true);
    expect(main.style.transform).toBe('');
  });
});
