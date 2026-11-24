/**
 * shadcn/ui Card 基础卡片容器原语。
 */
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 卡片外层容器。
 *
 * @param props div 元素属性
 * @returns 卡片容器元素
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 卡片头部区域。
 *
 * @param props div 元素属性
 * @returns 卡片头部元素
 */
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />;
}

/**
 * 卡片标题文本。
 *
 * @param props h3 元素属性
 * @returns 卡片标题元素
 */
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('font-semibold leading-none tracking-tight text-base', className)} {...props} />
  );
}

/**
 * 卡片副标题/描述文本。
 *
 * @param props p 元素属性
 * @returns 卡片描述元素
 */
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

/**
 * 卡片主体内容区域。
 *
 * @param props div 元素属性
 * @returns 卡片内容元素
 */
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

/**
 * 卡片底部操作区。
 *
 * @param props div 元素属性
 * @returns 卡片底部元素
 */
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-5 pt-0', className)} {...props} />;
}
