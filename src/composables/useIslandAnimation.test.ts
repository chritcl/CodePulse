import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useIslandAnimation } from './useIslandAnimation';

interface ControlledAnimation {
  animation: Animation;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const createControlledAnimation = (): ControlledAnimation => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const finished = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const animation = {
    finished,
    cancel: vi.fn(() => reject(new DOMException('动画已取消', 'AbortError'))),
  } as unknown as Animation;

  return { animation, resolve, reject };
};

describe('useIslandAnimation', () => {
  const controlledAnimations: ControlledAnimation[] = [];
  let animateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    controlledAnimations.length = 0;
    animateMock = vi.fn(() => {
      const controlled = createControlledAnimation();
      controlledAnimations.push(controlled);
      return controlled.animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animateMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按压阶段在七十毫秒结束点独立完成', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('div');

    const pressed = animation.playPress(element);

    expect(animateMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 70, fill: 'forwards' })
    );

    controlledAnimations[0].resolve();
    await pressed;
  });

  it('同一元素的新动画会取消旧动画且最终恢复原始样式', async () => {
    const animation = useIslandAnimation();
    const element = document.createElement('div');
    element.style.transformOrigin = 'left top';
    element.style.willChange = 'opacity';

    const first = animation.playRelease(element);
    const second = animation.playRelease(element);

    expect(controlledAnimations[0].animation.cancel).toHaveBeenCalledOnce();

    controlledAnimations[1].resolve();
    await Promise.all([first, second]);

    expect(element.style.transformOrigin).toBe('left top');
    expect(element.style.willChange).toBe('opacity');
    expect(animation.activeAnimationCount()).toBe(0);
  });

  it('关闭弹簧后释放动画不包含中途回撤', async () => {
    const springEnabled = ref(false);
    const animation = useIslandAnimation({ springEnabled });
    const element = document.createElement('div');

    const finished = animation.playRelease(element);
    const [keyframes, options] = animateMock.mock.calls[0] as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];

    expect(keyframes).toHaveLength(2);
    expect(options.duration).toBe(140);

    controlledAnimations[0].resolve();
    await finished;
  });

  it('详情退场即使被取消也只完成一次 Vue 过渡回调', async () => {
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
    animation.cancelInteractionAnimations();
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledOnce();
    expect(animation.activeAnimationCount()).toBe(0);
  });
});
