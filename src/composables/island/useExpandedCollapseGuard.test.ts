import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useExpandedCollapseGuard } from './useExpandedCollapseGuard';

describe('展开详情自动收起保护', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('拖拽期间忽略失焦和鼠标离开，结束后等待新的离开事件再收起', async () => {
    vi.useFakeTimers();
    const isDragging = ref(false);
    let isExpanded = true;
    const collapse = vi.fn(() => {
      isExpanded = false;
    });
    const guard = useExpandedCollapseGuard({
      isDragging,
      isExpanded: () => isExpanded,
      collapse,
    });

    guard.handleMouseLeave();
    isDragging.value = true;
    guard.handleDragStart();
    guard.handleWindowBlur();
    guard.handleMouseLeave();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(collapse).not.toHaveBeenCalled();

    isDragging.value = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(collapse).not.toHaveBeenCalled();

    guard.handleMouseLeave();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(collapse).toHaveBeenCalledOnce();
  });

  it('拖拽结束后的正常失焦仍会立即收起', () => {
    const isDragging = ref(false);
    const collapse = vi.fn();
    const guard = useExpandedCollapseGuard({
      isDragging,
      isExpanded: () => true,
      collapse,
    });

    guard.handleWindowBlur();

    expect(collapse).toHaveBeenCalledOnce();
  });
});
