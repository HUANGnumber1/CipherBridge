import React from 'react';
import { Card, Button } from 'antd';
import { UserOutlined, BankOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import heroBg from '../assets/hero-bg.png';

export const Home: React.FC = () => {
  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col bg-[#F7F6FC]">
      {/* Hero Section */}
      <section className="relative overflow-hidden flex items-center min-h-[520px] md:min-h-[600px] -mt-16 pt-16">
        {/* background image */}
        <img
          src={heroBg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        {/* transparent banner: background image shows through; only a short fade at the bottom */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#F7F6FC] to-transparent" />

        <div className="relative w-full max-w-7xl mx-auto px-4 py-16 md:py-24 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Left: copy */}
          <div className="text-center md:text-left">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight text-[#1A1740]">
              看清风险，
              <br />
              不看隐私。
            </h1>
            <p className="mt-6 text-lg text-[#3A3560] max-w-xl mx-auto md:mx-0">
              用隐私计算技术，
              <br className="hidden sm:block" />
              为中小企业构建更公平、更安全的融资环境。
            </p>
            <div className="mt-9 flex justify-center md:justify-start">
              <Link to="/client">
                <Button type="primary" size="large" shape="round" icon={<ArrowRightOutlined />} iconPosition="end" className="h-12 px-8 text-base">
                  开始体验
                </Button>
              </Link>
            </div>
          </div>

          {/* Right: slogan (no panel) */}
          <div className="relative text-right md:pr-2 md:self-center">
            <p className="text-2xl sm:text-3xl font-semibold leading-relaxed text-[#1A1740] md:text-[#C9C4E6] md:drop-shadow-[0_2px_14px_rgba(20,16,51,0.6)]">
              数据有界
              <br />
              信任无界
              <br />
              让更多可能发生
            </p>
            <div className="mt-8 ml-auto h-px w-16 bg-[#5B3CC4]/40 md:bg-[#C9C4E6]/70" />
            <p className="mt-4 text-[11px] sm:text-xs tracking-[0.28em] text-[#5B3CC4] md:text-[#C9C4E6] font-semibold md:drop-shadow-[0_2px_10px_rgba(20,16,51,0.6)]">
              MORE
              <br />
              POSSIBILITIES
              <br />
              FOR SMES
            </p>
          </div>
        </div>
      </section>

      {/* Portal Entrances */}
      <section className="max-w-6xl mx-auto px-4 py-12 w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-full">
          <Card hoverable className="transform transition-all duration-300 hover:scale-[1.02]">
            <div className="p-6 sm:p-8 text-center">
              <div className="bg-[#EDE8FC] w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                <UserOutlined className="text-4xl text-[#5B3CC4]" />
              </div>
              <h2 className="text-2xl font-bold text-[#1A1740] mb-4">客户端</h2>
              <p className="text-[#514D6B] mb-8 text-base">
                管理您的加密金融数据，发起隐私计算任务并查看结果
              </p>
              <Link to="/client">
                <Button type="primary" size="large" shape="round" className="h-12 px-6 sm:px-8 text-base">
                  进入客户端
                </Button>
              </Link>
            </div>
          </Card>

          <Card hoverable className="transform transition-all duration-300 hover:scale-[1.02]">
            <div className="p-6 sm:p-8 text-center">
              <div className="bg-[#EDE8FC] w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                <BankOutlined className="text-4xl text-[#5B3CC4]" />
              </div>
              <h2 className="text-2xl font-bold text-[#1A1740] mb-4">银行端</h2>
              <p className="text-[#514D6B] mb-8 text-base">
                管理隐私计算任务，处理加密数据并完成业务审批
              </p>
              <Link to="/bank">
                <Button type="primary" size="large" shape="round" className="h-12 px-6 sm:px-8 text-base">
                  进入银行端
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer id="about" className="mt-auto border-t border-[#E4E0F5] bg-white/60 scroll-mt-24">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="融鉴 FinLens" className="h-6 w-auto" />
            <span className="text-sm font-semibold text-[#1A1740]">融鉴 FinLens</span>
          </div>
          <p className="text-xs tracking-[0.18em] text-[#9C97B8] text-center">
            PRIVACY-PRESERVING RISK CONTROL FOR SMES
          </p>
        </div>
      </footer>
    </div>
  );
};
