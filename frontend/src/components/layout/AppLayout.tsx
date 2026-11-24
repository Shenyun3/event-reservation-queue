/**
 * 全局应用外壳布局：挂载 Topbar 与主内容区，并处理账号初始化失败兜底提示。
 */
import { Outlet } from 'react-router-dom';
import { useUser } from '@/lib/user-context';
import { ErrorStateCard } from './QueryStateViews';
import { Topbar } from './Topbar';

/**
 * React Router 顶层布局路由组件。
 *
 * @returns 包含全局顶部导航与子路由出口的布局树
 */
export function AppLayout() {
  const { usersError, refetchUsers, isLoadingUsers } = useUser();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Topbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {usersError ? (
          <div className="mb-6">
            <ErrorStateCard
              title="无法连接后端身份服务"
              message={usersError.message || '加载模拟账号列表失败，请确认后端服务已启动。'}
              onRetry={() => {
                void refetchUsers();
              }}
              isRetrying={isLoadingUsers}
            />
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
