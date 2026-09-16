import React, { useState, useEffect } from 'react';
import { Form, Input, Button, message, Typography, Row, Col, Card, Badge, Tooltip, Space } from 'antd';
import { BankOutlined, KeyOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import * as ethers from 'ethers';
import { contractConfig } from '../../config/contracts';

const { Text, Title, Paragraph } = Typography;

interface BankInfo {
  weId: string;
  publicKey: string;
  registrationTime: number;
  id: number;
  isActive: boolean;
}

export const BankRegistration: React.FC = () => {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [bankInfo, setBankInfo] = useState<BankInfo | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);

  useEffect(() => {
    const loadBankInfo = () => {
      const storedInfo = localStorage.getItem('bankInfo');
      if (storedInfo) {
        setBankInfo(JSON.parse(storedInfo));
      } else {
        setBankInfo(null);
        form.resetFields();
      }
    };

    loadBankInfo();

    const handleStorageChange = () => {
      loadBankInfo();
      setForceUpdate(prev => prev + 1);
    };

    const handleBankWalletChange = () => {
      // 当银行钱包被撤销时,清除银行信息
      const bankWallet = localStorage.getItem('bank_wallet');
      if (!bankWallet) {
        localStorage.removeItem('bankInfo');
        setBankInfo(null);
        form.resetFields();
        setForceUpdate(prev => prev + 1);
      }
      loadBankInfo();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('bankWalletChanged', handleBankWalletChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('bankWalletChanged', handleBankWalletChange);
    };
  }, [form]);

  const handleRegister = async (values: { weId: string }) => {
    try {
      const storedKeys = localStorage.getItem('bank_wallet');
      if (!storedKeys) {
        messageApi.error('请先生成银行密钥！');
        return;
      }
  
      const keys = JSON.parse(storedKeys);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(keys.privateKey, provider);
      
      const bankRegistry = new ethers.Contract(
        contractConfig.BankRegistry.address,
        contractConfig.BankRegistry.abi,
        signer
      );

      console.log('Bank address:', keys.address);
  
      const tx = await bankRegistry.registerBank(keys.address);
      console.log('Transaction sent:', tx.hash);
      
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt);
  
      const registerEvent = receipt.events?.find(
        (event: any) => event.event === 'BankRegistered'
      );
      const bankId = registerEvent?.args?.bankId.toNumber();
  
      const bankData = await bankRegistry.getBank(keys.address);
  
      const newBankInfo = {
        weId: values.weId,
        publicKey: keys.address,
        registrationTime: Date.now(),
        id: bankId,
        isActive: bankData.isActive
      };
      
      localStorage.setItem('bankInfo', JSON.stringify(newBankInfo));
      setBankInfo(newBankInfo);
      setForceUpdate(prev => prev + 1);
      messageApi.success('银行注册成功！');
      form.resetFields();
    } catch (error) {
      messageApi.error('注册失败！');
      console.error('Registration failed:', error);
    }
  };

  const handleRevoke = async () => {
    try {
      // 清除所有本地存储的数据
      const keysToRemove = [
        'bank_wallet',              
        'bankInfo',           
        'encryptedDataList',  
        'encryptionHistory',  
        'isRegistered',       
        'fheKeys',            
        'taskHistory',        
        'computationResults'  
      ];

      // 批量删除本地存储
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // 重置所有相关状态
      setBankInfo(null);
      form.resetFields();
      setForceUpdate(prev => prev + 1);
      
      // 发出事件通知其他组件
      window.dispatchEvent(new Event('bankWalletChanged'));
      window.dispatchEvent(new Event('storage'));
      
      messageApi.success('银行注册及相关数据已成功撤销！');
    } catch (error) {
      messageApi.error('撤销注册失败！');
      console.error('Revoke failed:', error);
    }
  };

  return (
    <>
      {contextHolder}
      <div className="space-y-6" key={forceUpdate}>
        {bankInfo ? (
          <div className="space-y-6">
            <Row gutter={24}>
              <Col span={16}>
                <Space direction="vertical" className="w-full" size="large">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Text type="secondary">银行 WeID</Text>
                    </div>
                    <Paragraph copyable className="font-mono bg-gray-50 p-3 rounded mb-0">
                      {bankInfo.weId}
                    </Paragraph>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Text type="secondary">公钥</Text>
                    </div>
                    <Paragraph copyable className="font-mono bg-gray-50 p-3 rounded mb-0 break-all">
                      {bankInfo.publicKey}
                    </Paragraph>
                  </div>

                  <Row gutter={24}>
                    <Col span={12}>
                      <Text type="secondary">注册时间</Text>
                      <div className="font-mono bg-gray-50 p-3rounded mt-1">
                        {new Date(bankInfo.registrationTime).toLocaleString()}
                      </div>
                    </Col>
                    <Col span={6}>
                      <Text type="secondary">银行 ID</Text>
                      <div className="font-mono bg-gray-50 p-3rounded mt-1">
                        #{bankInfo.id}
                      </div>
                    </Col>
                    <Col span={6}>
                      <Text type="secondary">状态</Text>
                      <div className="bg-gray-50 p-3 rounded mt-1">
                        <Badge 
                          status={bankInfo.isActive ? "success" : "error"} 
                          text={bankInfo.isActive ? "已激活" : "未激活"}
                        />
                      </div>
                    </Col>
                  </Row>
                </Space>
              </Col>

              <Col span={8} className="text-right">
                <Tooltip title="撤销银行注册并清除所有数据">
                  <Button 
                    danger
                    icon={<DeleteOutlined />}
                    onClick={handleRevoke}
                    size="large"
                  >
                    撤销注册
                  </Button>
                </Tooltip>
              </Col>
            </Row>
          </div>
        ) : (
          <Card>
            <Title level={4} className="mb-6 flex items-center">
              <BankOutlined className="mr-2" />
              银行注册
            </Title>
            <Form
              form={form}
              onFinish={handleRegister}
              layout="vertical"
            >
              <Form.Item
                name="weId"
                label="银行 WeID"
                rules={[{ required: true, message: '请输入您的 WeID！' }]}
              >
                <Input 
                  prefix={<KeyOutlined className="text-gray-400" />}
                  placeholder="请输入您的 WeID"
                />
              </Form.Item>

              <Form.Item>
                <Button 
                  type="primary" 
                  htmlType="submit"
                  icon={<CheckCircleOutlined />}
                  size="large"
                >
                  注册银行
                </Button>
              </Form.Item>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
};