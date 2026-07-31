interface ViewTransitionLike {
  finished: Promise<unknown>;
}

interface DashboardTransitionOptions {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
  prefersReducedMotion?: boolean;
  wait?: (duration: number) => Promise<void>;
  /**
   * 原生 View Transition 路径下等待新页面挂载完成的回调。
   * out-in 模式下新页面要等旧页面离场后才插入 DOM，必须先等它再让浏览器捕获新快照，
   * 否则共享元素容器变形永远不会发生。
   */
  awaitNewPage?: () => Promise<void>;
}

const waitFor = (duration: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, duration);
  });

const getNativeTransition = () => {
  const transitionDocument = document as Document & {
    startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
  };
  return transitionDocument.startViewTransition?.bind(transitionDocument);
};

export const runDashboardViewTransition = async (
  update: () => void,
  options: DashboardTransitionOptions = {}
): Promise<void> => {
  const prefersReducedMotion =
    options.prefersReducedMotion ??
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
    false;
  const wait = options.wait ?? waitFor;
  const startViewTransition = options.startViewTransition ?? getNativeTransition();

  if (prefersReducedMotion) {
    update();
    await wait(120);
    return;
  }

  if (startViewTransition) {
    const transition = startViewTransition(async () => {
      update();
      if (options.awaitNewPage) {
        // 等新页面完成挂载后再让浏览器捕获新快照；超时兜底避免快照永久挂起
        // （上限需覆盖离场 360ms + 入场 360ms 的最坏情况）
        await Promise.race([options.awaitNewPage(), wait(800)]);
      }
    });
    await transition.finished;
    return;
  }

  update();
  await wait(360);
};
