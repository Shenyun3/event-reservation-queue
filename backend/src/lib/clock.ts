/**
 * 可注入时钟接口及系统/测试实现（保证写事务锁后时间轴统一与测试时间可控推进）。
 */

/** 时钟抽象接口。 */
export interface Clock {
  /** 返回当前 UTC 时间对象。 */
  now(): Date;
}

/** 生产/开发使用的系统时钟实现。 */
export class SystemClock implements Clock {
  /**
   * 返回当前系统时间。
   *
   * @returns 当前时刻的 `Date` 实例。
   */
  now(): Date {
    return new Date();
  }
}

/** 集成测试使用的可控假时钟，支持按毫秒或秒推进时间。 */
export class FakeClock implements Clock {
  private currentMs: number;

  /**
   * 创建假时钟实例。
   *
   * @param initial 初始时间（默认当前系统时间）。
   */
  constructor(initial: Date = new Date()) {
    this.currentMs = initial.getTime();
  }

  /**
   * 获取当前假时钟时刻。
   *
   * @returns 拷贝后的 `Date` 实例，避免外部误修改。
   */
  now(): Date {
    return new Date(this.currentMs);
  }

  /**
   * 直接设定假时钟时刻。
   *
   * @param date 目标时间。
   */
  set(date: Date): void {
    this.currentMs = date.getTime();
  }

  /**
   * 将时钟向前推进指定毫秒数。
   *
   * @param ms 推进的毫秒数。
   */
  advanceMs(ms: number): void {
    this.currentMs += ms;
  }

  /**
   * 将时钟向前推进指定秒数。
   *
   * @param seconds 推进的秒数。
   */
  advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
  }
}
