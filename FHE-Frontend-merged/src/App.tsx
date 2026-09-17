import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { ClientPortal } from './pages/ClientPortal';
import { BankPortal } from './pages/BankPortal';
// import { Test } from './pages/Test';
import { Web3Provider  } from './Web3Provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'


const queryClient = new QueryClient()
function App() {
  return (
    // <Web3Provider>
    //   <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#5B3CC4',
            borderRadius: 10,
            colorText: '#1A1740',
            colorBorder: '#E4E0F5',
            fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
        }}
      >
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="client" element={<ClientPortal />} />
              <Route path="bank" element={<BankPortal />} />
              {/* <Route path="test" element={<Test />} /> */}
            </Route>
          </Routes>
          </BrowserRouter>
        </ConfigProvider>
    //   </QueryClientProvider>
    // </Web3Provider>
  );
}

export default App;