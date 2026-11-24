/**
 * 前端应用根组件：挂载 React Query、全局身份上下文、通知系统与路由骨架。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserProvider } from '@/lib/user-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Phase 1 前端基础脚手架已就绪，业务页面将在 Phase 2 / Phase 3 接入。
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * 应用顶层组件。
 *
 * @returns 完整 React 应用树
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<PlaceholderPage title="活动大厅 / 实时看板" />} />
            <Route path="/events/:eventId" element={<PlaceholderPage title="活动详情" />} />
            <Route path="/my-reservations" element={<PlaceholderPage title="我的预约" />} />
            <Route path="/admin" element={<PlaceholderPage title="运营管理台" />} />
            <Route path="/stress-test" element={<PlaceholderPage title="20 人并发压测实验室" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
