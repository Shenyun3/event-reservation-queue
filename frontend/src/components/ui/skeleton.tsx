/**
 * shadcn/ui Skeleton 骨架屏加载占位原语。
 */
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 骨架屏占位块组件。
 *
 * @param props div 元素属性
 * @returns 脉冲动画占位块元素
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
