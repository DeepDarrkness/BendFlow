export const PROFILES = ['native-cpu', 'multithreaded-cpu', 'gpu', 'graphics-audio'] as const;
export type ExecutionProfile = typeof PROFILES[number];

export const CPU_ARGS = runtimeArgs('native-cpu');

export function runtimeArgs(profile: ExecutionProfile, threads = 2): string[] {
  switch (profile) {
    case 'native-cpu':
      return ['+RTS', '--threads', '1', '--gpu', 'off', '-RTS'];
    case 'multithreaded-cpu':
      if (!Number.isInteger(threads) || threads < 2 || threads > 64) throw new RangeError('Invalid thread count');
      return ['+RTS', '--threads', String(threads), '--gpu', 'off', '-RTS'];
    case 'gpu':
      return ['+RTS', '--threads', '1', '--gpu', 'on', '-RTS'];
    case 'graphics-audio':
      return ['+RTS', '--threads', '1', '--gpu', 'off', '-RTS'];
    default: {
      const exhaustive: never = profile;
      throw new RangeError(`Unsupported profile: ${exhaustive}`);
    }
  }
}
