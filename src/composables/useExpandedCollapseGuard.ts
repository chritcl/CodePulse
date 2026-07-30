import { getCurrentScope, onScopeDispose, type Ref } from 'vue';

export interface UseExpandedCollapseGuardOptions {
  isDragging: Readonly<Ref<boolean>>;
  isExpanded: () => boolean;
  collapse: () => void;
  delayMs?: number;
}

/** 管理展开详情的失焦与鼠标离开收起规则 */
export function useExpandedCollapseGuard(options: UseExpandedCollapseGuardOptions) {
  const delayMs = options.delayMs ?? 1_000;
  let collapseTimer: number | null = null;

  /** 清除尚未触发的自动收起 */
  const cancelScheduledCollapse = () => {
    if (collapseTimer === null) return;
    window.clearTimeout(collapseTimer);
    collapseTimer = null;
  };

  /** 拖拽开始后立即清除自动收起，松手不创建新计时器 */
  const handleDragStart = () => {
    cancelScheduledCollapse();
  };

  /** 鼠标离开后延迟收起，拖拽期间不安排任何收起 */
  const handleMouseLeave = () => {
    cancelScheduledCollapse();
    if (options.isDragging.value || !options.isExpanded()) return;

    collapseTimer = window.setTimeout(() => {
      collapseTimer = null;
      if (!options.isDragging.value && options.isExpanded()) {
        options.collapse();
      }
    }, delayMs);
  };

  /** 鼠标重新进入时取消自动收起 */
  const handleMouseEnter = () => {
    cancelScheduledCollapse();
  };

  /** 普通失焦立即收起，原生拖拽造成的失焦则忽略 */
  const handleWindowBlur = () => {
    if (options.isDragging.value || !options.isExpanded()) return;
    cancelScheduledCollapse();
    options.collapse();
  };

  if (getCurrentScope()) {
    onScopeDispose(cancelScheduledCollapse);
  }

  return {
    handleDragStart,
    handleMouseLeave,
    handleMouseEnter,
    handleWindowBlur,
    cancelScheduledCollapse,
  };
}
