/**
 * 管理员专属页面权限拦截卡（对齐 demo/admin.html 与 demo/app.js 角色守卫交互）。
 */
import { ArrowLeft, ShieldAlert, UserCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/lib/user-context';

/** 权限守卫卡片属性。 */
export interface AdminOnlyGuardProps {
  /** 受保护的页面名称（例如「运营管理台」）。 */
  pageTitle: string;
}

/**
 * 当非 ADMIN 用户访问运营管理台或压测实验室时展示的权限拦截与一键切换卡片。
 *
 * @param props 页面标题配置
 * @returns 权限拦截卡片元素
 */
export function AdminOnlyGuard({ pageTitle }: AdminOnlyGuardProps) {
  const { users, setCurrentUserId } = useUser();

  const handleQuickSwitchAdmin = () => {
    const adminUser = users.find((u) => u.role === 'ADMIN');
    const targetId = adminUser?.id ?? 'admin';
    setCurrentUserId(targetId);
    toast.success('已切换至管理员账号（解锁库存看板与运营后台）');
  };

  return (
    <Card className="mx-auto mt-6 max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
          <CardTitle>仅管理员可访问：{pageTitle}</CardTitle>
        </div>
        <CardDescription>
          当前模拟账号为普通用户（USER），无权查看后台库存统计、创建活动或执行并发压测。请在顶部切换为「Admin（运营管理员）」或点击下方按钮一键切换。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button onClick={handleQuickSwitchAdmin}>
          <UserCog className="h-4 w-4" />
          一键切换为管理员账号
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            返回活动大厅
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
