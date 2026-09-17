import React, { useState, useEffect } from 'react';
import { Modal, Button, Typography, Space, message, Input, Popconfirm } from 'antd';
import { WalletOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined, ImportOutlined, DeleteOutlined } from '@ant-design/icons';
import { ethers } from 'ethers';

const { Text, Paragraph } = Typography;

interface WalletInfo {
  address: string;
  privateKey: string;
}

export const ClientWalletModal: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [forceUpdate, setForceUpdate] = useState(0);

  useEffect(() => {
    const loadWallet = () => {
      const storedWallet = localStorage.getItem('client_wallet');
      if (storedWallet) {
        setWallet(JSON.parse(storedWallet));
      } else {
        setWallet(null);
      }
    };

    loadWallet();
    
    const handleStorageChange = () => {
      loadWallet();
      setForceUpdate(prev => prev + 1);
    };

    const handleOpenModal = () => {
      setIsModalOpen(true);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('clientWalletChanged', handleStorageChange);
    window.addEventListener('openClientWalletModal', handleOpenModal);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('clientWalletChanged', handleStorageChange);
      window.removeEventListener('openClientWalletModal', handleOpenModal);
    };
  }, []);

  const generateWallet = () => {
    const newWallet = ethers.Wallet.createRandom();
    const walletInfo = {
      address: newWallet.address,
      privateKey: newWallet.privateKey,
    };
    setWallet(walletInfo);
    localStorage.setItem('client_wallet', JSON.stringify(walletInfo));
    window.dispatchEvent(new Event('clientWalletChanged'));
    messageApi.success('新客户端钱包生成成功！');
  };

  const handleImportPrivateKey = () => {
    try {
      if (!importPrivateKey.startsWith('0x')) {
        throw new Error('Private key must start with 0x');
      }
      
      const wallet = new ethers.Wallet(importPrivateKey);
      const walletInfo = {
        address: wallet.address,
        privateKey: wallet.privateKey,
      };
      
      setWallet(walletInfo);
      localStorage.setItem('client_wallet', JSON.stringify(walletInfo));
      window.dispatchEvent(new Event('clientWalletChanged'));
      setShowImport(false);
      setImportPrivateKey('');
      messageApi.success('客户端钱包导入成功！');
    } catch (error) {
      messageApi.error('私钥无效！');
      console.error('Import failed:', error);
    }
  };

  const handleRevokeWallet = () => {
    localStorage.removeItem('client_wallet');
    setWallet(null);
    setShowPrivateKey(false);
    window.dispatchEvent(new Event('clientWalletChanged'));
    setForceUpdate(prev => prev + 1);
    window.dispatchEvent(new Event('storage'));
    messageApi.success('客户端钱包已撤销！');
    setIsModalOpen(false);
  };

  const handleCopy = (text: string, type: 'address' | 'privateKey') => {
    navigator.clipboard.writeText(text);
    messageApi.success(`${type === 'address' ? '地址' : '私钥'}已复制到剪贴板！`);
  };

  return (
    <>
      {contextHolder}
      <Button 
        icon={<WalletOutlined />}
        onClick={() => setIsModalOpen(true)}
        className="mr-2"
      >
        <span className="!hidden sm:!inline">客户端账户</span>
      </Button>

      <Modal
        title="客户端账户管理"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setShowImport(false);
          setImportPrivateKey('');
        }}
        footer={[
          <Button key="close" onClick={() => setIsModalOpen(false)}>
            关闭
          </Button>,
          !wallet && !showImport && (
            <Button 
              key="import"
              icon={<ImportOutlined />}
              onClick={() => setShowImport(true)}
            >
              导入账户
            </Button>
          ),
          !wallet && (
            <Button 
              key="generate" 
              type="primary" 
              onClick={generateWallet}
            >
              生成新账户
            </Button>
          ),
          wallet && (
            <Popconfirm
              key="revoke"
              title="撤销钱包"
              description="确定要撤销此钱包吗？该操作不可恢复。"
              onConfirm={handleRevokeWallet}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />}>
                撤销账户
              </Button>
            </Popconfirm>
          )
        ]}
      >
        {showImport ? (
          <Space direction="vertical" className="w-full">
            <Text>请输入您的私钥：</Text>
            <Input.Password
              value={importPrivateKey}
              onChange={(e) => setImportPrivateKey(e.target.value)}
              placeholder="0x..."
              className="font-mono"
            />
            <Space>
              <Button onClick={() => setShowImport(false)}>
                取消
              </Button>
              <Button 
                type="primary" 
                onClick={handleImportPrivateKey}
                disabled={!importPrivateKey}
              >
                导入
              </Button>
            </Space>
          </Space>
        ) : wallet ? (
          <Space direction="vertical" className="w-full">
            <div>
              <Text type="secondary">地址</Text>
              <div className="flex items-center gap-2 mt-1">
                <Text strong className="font-mono">{wallet.address}</Text>
                <Button 
                  type="text" 
                  icon={<CopyOutlined />} 
                  size="small"
                  onClick={() => handleCopy(wallet.address, 'address')}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Text type="secondary">私钥</Text>
                <Button
                  type="text"
                  icon={showPrivateKey ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  size="small"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Text strong className="font-mono">
                  {showPrivateKey 
                    ? wallet.privateKey 
                    : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                </Text>
                <Button 
                  type="text" 
                  icon={<CopyOutlined />} 
                  size="small"
                  onClick={() => handleCopy(wallet.privateKey, 'privateKey')}
                />
              </div>
            </div>

            <Text type="danger">
              警告：切勿向任何人泄露您的私钥！
            </Text>
          </Space>
        ) : (
          <div className="text-center py-8">
            <Text type="secondary">尚未生成钱包，请新建或导入已有钱包。</Text>
          </div>
        )}
      </Modal>
    </>
  );
}