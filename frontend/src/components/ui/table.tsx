/**
 * shadcn/ui Table 数据表格原语。
 */
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 带水平滚动保护的表格组件。
 *
 * @param props table 元素属性
 * @returns 包裹后的 table 元素
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

/**
 * 表头分组组件。
 *
 * @param props thead 元素属性
 * @returns thead 元素
 */
export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b bg-muted/40', className)} {...props} />;
}

/**
 * 表体分组组件。
 *
 * @param props tbody 元素属性
 * @returns tbody 元素
 */
export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

/**
 * 表格行组件。
 *
 * @param props tr 元素属性
 * @returns tr 元素
 */
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 表头单元格组件。
 *
 * @param props th 元素属性
 * @returns th 元素
 */
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 数据单元格组件。
 *
 * @param props td 元素属性
 * @returns td 元素
 */
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('p-3 align-middle', className)} {...props} />;
}
