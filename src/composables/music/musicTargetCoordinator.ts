export interface MusicTargetCoordinator {
  select(player: string): MusicTargetSelection;
  enqueueOperation(
    selection: MusicTargetSelection,
    operation: () => Promise<void>
  ): Promise<boolean>;
  invalidate(): void;
  isCurrent(selection: MusicTargetSelection): boolean;
  waitForCurrent(): Promise<MusicTargetSelection | null>;
  currentPlayer(): string;
}

export interface MusicTargetSelection {
  player: string;
  committed: Promise<void>;
}

/** 串行提交目标播放器，保证后续选择最后写入 */
export const createMusicTargetCoordinator = (
  writeTarget: (player: string) => Promise<void>
): MusicTargetCoordinator => {
  let tail = Promise.resolve();
  let current: MusicTargetSelection | null = null;
  let invalidationId = 0;

  const enqueue = (player: string): Promise<void> => {
    const write = tail.then(() => writeTarget(player));
    tail = write.catch(() => undefined);
    return write;
  };

  const select = (player: string): MusicTargetSelection => {
    const selection = { player, committed: enqueue(player) };
    current = selection;
    return selection;
  };

  const waitForCurrent = async (): Promise<MusicTargetSelection | null> => {
    const expectedInvalidation = invalidationId;
    while (current && invalidationId === expectedInvalidation) {
      const selection = current;
      try {
        await selection.committed;
      } catch (error) {
        if (selection === current) throw error;
        continue;
      }
      if (selection === current) return selection;
    }
    return null;
  };

  const enqueueOperation = (
    selection: MusicTargetSelection,
    operation: () => Promise<void>
  ): Promise<boolean> => {
    const expectedInvalidation = invalidationId;
    const queued = tail.then(async () => {
      if (invalidationId !== expectedInvalidation) return false;
      try {
        await selection.committed;
      } catch {
        return false;
      }
      if (invalidationId !== expectedInvalidation) return false;
      await operation();
      return true;
    });
    tail = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  };

  return {
    select,
    enqueueOperation,
    invalidate: () => {
      invalidationId += 1;
      current = null;
    },
    isCurrent: (selection) => selection === current,
    waitForCurrent,
    currentPlayer: () => current?.player ?? '',
  };
};
