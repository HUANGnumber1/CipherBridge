import React, { useState } from 'react';
import { Outlet, Link, NavLink } from 'react-router-dom';
import { Layout as AntLayout, Button } from 'antd';
import { MenuOutlined, CloseOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { ClientWalletModal } from './wallet/ClientWalletModal';
import { BankWalletModal } from './wallet/BankWalletModal';

const { Header, Content } = AntLayout;

const navItems = [
  { key: 'product', label: '产品', to: '/client' },
  { key: 'solution', label: '解决方案', to: '/bank' },
];

const desktopLinkClass = (isActive: boolean) =>
  'px-4 py-2 text-base font-medium whitespace-nowrap transition-colors border-b-2 ' +
  (isActive
    ? 'border-[#5B3CC4] text-[#5B3CC4] font-semibold'
    : 'border-transparent text-[#514D6B] hover:text-[#5B3CC4] hover:bg-[#5B3CC4]/5');

const mobileLinkClass = (isActive: boolean) =>
  'block px-6 py-3 text-base font-medium transition-colors border-l-2 ' +
  (isActive
    ? 'border-[#5B3CC4] bg-[#5B3CC4]/10 text-[#5B3CC4] font-semibold'
    : 'border-transparent text-[#514D6B] hover:bg-[#5B3CC4]/5');

export const Layout: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header className="ant-layout-header">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src="/logo.svg" alt="融鉴 FinLens" className="h-9 w-auto" />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-wide text-[#1A1740]">融鉴</span>
            <span className="text-[11px] font-semibold tracking-[0.16em] text-[#5B3CC4]">
              FinLens
            </span>
          </span>
        </Link>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center gap-1 mx-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              className={({ isActive }) => desktopLinkClass(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
          <a href="#about" className={desktopLinkClass(false)}>
            关于我们
          </a>
        </nav>

        <div className="ml-auto md:ml-0 flex items-center gap-2">
          <Link to="/client" className="hidden lg:block">
            <Button type="primary" shape="round" icon={<ArrowRightOutlined />} iconPosition="end">
              申请试用
            </Button>
          </Link>
          <ClientWalletModal />
          <BankWalletModal />
          <button
            className="md:hidden block p-2 rounded-lg text-[#1A1740] hover:bg-[#5B3CC4]/10 focus:outline-none"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="切换导航菜单"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <CloseOutlined className="text-xl" /> : <MenuOutlined className="text-xl" />}
          </button>
        </div>
      </Header>

      {/* Mobile navigation panel */}
      <div className={(menuOpen ? '' : 'hidden ') + 'md:hidden bg-white border-b border-[#E4E0F5] shadow-sm'}>
        <nav className="flex flex-col py-1">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => mobileLinkClass(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
          <a href="#about" onClick={() => setMenuOpen(false)} className={mobileLinkClass(false)}>
            关于我们
          </a>
        </nav>
      </div>

      <Content>
        <Outlet />
      </Content>
    </AntLayout>
  );
};
