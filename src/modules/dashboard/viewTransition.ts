interface ViewTransitionLike {
  finished: Promise<unknown>;
}

interface DashboardTransitionOptions {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
  prefersReducedMotion?: boolean;
  wait?: (duration: number) => Promise<void>;
  /**
   * 原生 View Transition 路径下等待响应式更新提交到 DOM。
   * 这里只等待一次渲染刷新，不能等待组件入场动画，否则旧快照会长时间遮住新内容。
   */
  awaitRender?: () => Promise<void>;
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
      if (options.awaitRender) {
        await options.awaitRender();
      }
    });
    await transition.finished;
    return;
  }

  update();
  await wait(360);
};
