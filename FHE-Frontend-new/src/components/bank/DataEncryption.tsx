import React, { useState, useEffect } from 'react';
import { Form, Input, Button, message, Typography, Row, Col, Card, Badge, Tooltip, Tag, Select, Modal } from 'antd';
import { 
  LockOutlined, 
  KeyOutlined, 
  CloudUploadOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { fheApi } from '../../services/fheApi';
import { DataType } from '../../services/fheApi';
import * as ethers from 'ethers';
import { contractConfig } from '../../config/contracts';
import { eventBus } from '../../utils/eventBus';

const { Text, Paragraph } = Typography;

interface EncryptedData {
  id: string;
  userPublicKey: string;
  fhePublicKey: string;
  dataType: string;
  encryptedValue: string;
  timestamp: number;
  onChain: boolean;
  uploading?: boolean;
}

// 添加数据类型枚举
const DATA_TYPES: Array<{
  value: DataType;
  label: string;
  task: string;
}> = [
  { value: 'monthly_income', label: '月收入', task: '信用卡申请' },
  { value: 'credit_score', label: '信用评分', task: '信用评估' },
  { value: 'property_value', label: '房产价值', task: '抵押贷款申请' }
] as const;

export const DataEncryption: React.FC = () => {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [encryptedDataList, setEncryptedDataList] = useState<EncryptedData[]>([]);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // 添加事件监听
  useEffect(() => {
    // 从 localStorage 加载历史记录
    const loadEncryptionHistory = () => {
      const storedData = localStorage.getItem('encryptedDataList');
      if (storedData) {
        setEncryptedDataList(JSON.parse(storedData));
      }
    };

    // 检查银行注册状态
    const checkBankStatus = () => {
      const bankInfo = localStorage.getItem('bankInfo');
      if (!bankInfo) {
        setEncryptedDataList([]); // 清空加密历史
        localStorage.removeItem('encryptedDataList');
      }
    };

    // 初始加载
    loadEncryptionHistory();
    checkBankStatus();

    // 监听银行撤销事件
    const handleBankRevoked = () => {
      setEncryptedDataList([]);
      setExpandedItems({});
      form.resetFields();
    };

    eventBus.on('bankRevoked', handleBankRevoked);

    // 清理函数
    return () => {
      eventBus.off('bankRevoked', handleBankRevoked);
    };
  }, [form]);

  // 在加密数据列表更新时保存到 localStorage
  useEffect(() => {
    if (encryptedDataList.length > 0) {
      localStorage.setItem('encryptedDataList', JSON.stringify(encryptedDataList));
    } else {
      localStorage.removeItem('encryptedDataList');
    }
  }, [encryptedDataList]);

  // 添加切换展开/收起的处理函数
  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // 请求FHE公钥
  const handleRequestFHEKey = async () => {
    try {
      const userPublicKey = form.getFieldValue('userPublicKey');
      if (!userPublicKey) {
        messageApi.warning('请先输入用户公钥！');
        return;
      }

      const fhePublicKey = await fheApi.getPublicKey(userPublicKey);
      form.setFieldsValue({ fhePublicKey });
      messageApi.success('FHE 公钥获取成功！');
    } catch (error) {
      messageApi.error('获取 FHE 公钥失败！');
      console.error('Failed to get FHE public key:', error);
    }
  };

  // 加密数据
  const handleEncrypt = async (values: any) => {
    try {
      if (!values.fhePublicKey) {
        messageApi.warning('请先请求 FHE 公钥！');
        return;
      }

      // 调用加密 API
      const encryptResponse = await fheApi.encrypt(
        values.userPublicKey,
        values.dataType,
        parseInt(values.data)
      );

      const newEncryptedData: EncryptedData = {
        id: Math.random().toString(36).substring(7),
        userPublicKey: values.userPublicKey,
        fhePublicKey: values.fhePublicKey,
        dataType: values.dataType,
        encryptedValue: encryptResponse.encrypted_value,
        timestamp: Date.now(),
        onChain: false,
      };

      setEncryptedDataList(prev => [newEncryptedData, ...prev]);
      messageApi.success('数据加密成功！');
      form.resetFields();
    } catch (error) {
      messageApi.error('数据加密失败！');
      console.error('Failed to encrypt data:', error);
    }
  };

  // 上传数据到链上
  const handleUploadToChain = async (dataId: string) => {
    try {
      const dataToUpload = encryptedDataList.find(item => item.id === dataId);
      if (!dataToUpload) {
        messageApi.error('未找到数据！');
        return;
      }

      const storedKeys = localStorage.getItem('bank_wallet');
      if (!storedKeys) {
        messageApi.error('未找到银行钱包！');
        return;
      }

      // 设置上传中状态
      setEncryptedDataList(prev => 
        prev.map(item => 
          item.id === dataId ? { ...item, uploading: true } : item
        )
      );

      const keys = JSON.parse(storedKeys);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(keys.privateKey, provider);
      
      const dataStorage = new ethers.Contract(
        contractConfig.DataStorage.address,
        contractConfig.DataStorage.abi,
        signer
      );

      // 获取当前区块时间戳
      const currentBlock = await provider.getBlock('latest');
      const currentBlockTimestamp = currentBlock.timestamp;
      
      // 设置过期时间为当前区块时间戳 + 30天（以秒为单位）
      const expiryDate = currentBlockTimestamp + (30 * 24 * 60 * 60);

      console.log('Current block timestamp:', currentBlockTimestamp);
      console.log('Expiry date:', expiryDate);

      console.log('dataToUpload.userPublicKey:', dataToUpload.userPublicKey);
      // 调用合约存储数据
      const tx = await dataStorage.storeUserData(
        dataToUpload.userPublicKey,  // 用户地址
        dataToUpload.dataType,       // 数据类型
        expiryDate,                  // 过期时间（以秒为单位）
        dataToUpload.encryptedValue  // 加密数据
      );

      console.log('Transaction sent:', tx.hash);
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt);

      const dataStoredEvent = receipt.events?.find(
        (event: any) => event.event === 'DataStored'
      );

      if (dataStoredEvent) {
        setEncryptedDataList(prev => 
          prev.map(item => 
            item.id === dataId ? { ...item, onChain: true, uploading: false } : item
          )
        );
        messageApi.success('数据已成功上传至区块链！');
      } else {
        throw new Error('交易回执中未找到数据存储事件');
      }

    } catch (error: any) {
      console.error('Failed to upload data:', error);
      
      // 错误处理
      if (error.message.includes('Invalid expiry date')) {
        messageApi.error('过期时间无效！');
      } else if (error.message.includes('Only bank can store data')) {
        messageApi.error('仅已注册银行可存储数据！');
      } else if (error.message.includes('Invalid user')) {
        messageApi.error('用户未注册！');
      } else {
        messageApi.error('数据上传区块链失败！');
      }

      // 重置上传中状态
      setEncryptedDataList(prev => 
        prev.map(item => 
          item.id === dataId ? { ...item, uploading: false } : item
        )
      );
    }
  };

  // 添加删除单条记录的函数
  const handleDeleteRecord = (id: string) => {
    Modal.confirm({
      title: '删除记录',
      content: '确定要删除这条记录吗？',
      okText: '确定',
      okType: 'danger',
      cancelText: '取消',
      onOk() {
        setEncryptedDataList(prev => {
          const newList = prev.filter(item => item.id !== id);
          // 如果列表为空，清除localStorage
          if (newList.length === 0) {
            localStorage.removeItem('encryptionHistory');
          } else {
            localStorage.setItem('encryptionHistory', JSON.stringify(newList));
          }
          return newList;
        });
        messageApi.success('记录已删除');
      },
    });
  };

  return (
    <>
      {contextHolder}
      {!localStorage.getItem('bankInfo') ? (
        <div className="text-center py-8">
          <Text type="secondary">
            请先注册银行，以使用数据加密功能。
          </Text>
        </div>
      ) : (
        <>
          <Form
            form={form}
            onFinish={handleEncrypt}
            layout="vertical"
            className="mb-8"
          >
            {/* 密钥输入区域 */}
            <Row gutter={16} className="mb-2">
              <Col span={16}>
                <Form.Item
                  name="userPublicKey"
                  label={<Text strong>用户公钥</Text>}
                  rules={[{ required: true, message: '请输入用户公钥！' }]}
                >
                  <Input
                    placeholder="请输入用户公钥"
                    className="font-mono h-10"
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="dataType"
                  label={<Text strong>数据类型</Text>}
                  rules={[{ required: true, message: '请选择数据类型！' }]}
                >
                  <Select
                    placeholder="选择数据类型"
                    className="h-10"
                    options={DATA_TYPES.map(type => ({
                      value: type.value,
                      label: (
                        <div>
                          <div>{type.label} · {type.task}</div>
                          {/* <div className="text-xs text-gray-400"></div> */}
                        </div>
                      )
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={16}>
                <Form.Item
                  name="fhePublicKey"
                  label={<Text strong>FHE 公钥</Text>}
                  rules={[{ required: true, message: '请先请求 FHE 公钥！' }]}
                >
                  <Input
                    placeholder="FHE 公钥将显示在此处"
                    readOnly
                    className="font-mono h-10 bg-gray-50"
                    suffix={
                      <Button
                        type="primary"
                        icon={<KeyOutlined />}
                        onClick={handleRequestFHEKey}
                        size="small"
                        className="ml-2"
                      >
                        请求 FHE 公钥
                      </Button>
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="data"
                  label={<Text strong>原始数据</Text>}
                  rules={[{ required: true, message: '请输入数据！' }]}
                >
                  <Input 
                    placeholder="请输入要加密的数据" 
                    className="h-10"
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* 加密按钮 */}
            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                icon={<LockOutlined />}
                className="h-10"
                block
              >
                加密数据
              </Button>
            </Form.Item>
          </Form>

          {/* 加密历史记录 */}
          {encryptedDataList.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-10">
                <div className="flex items-center gap-2">
                  <LockOutlined className="text-gray-400" />
                  <Text strong className="text-lg">
                    加密历史 {" "}
                  </Text>
                  <Badge 
                      count={encryptedDataList.length} 
                      className="ml-2"
                      style={{ backgroundColor: '#52c41a' }}
                    />
                </div>
              </div>
              <div className="space-y-4 mt-4">
                {encryptedDataList.map(item => (
                  <Card 
                    key={item.id} 
                    size="small" 
                    className="shadow-sm hover:shadow-md transition-shadow border border-gray-100"
                    extra={
                      <div className="flex items-center gap-2">
                        {item.onChain ? (
                          <Badge 
                            status="success" 
                            text={
                              <span className="flex items-center gap-10 px-2">
                                <CheckCircleOutlined className="text-green-500" />
                                <Text type="success" className="font-medium"> 已上链</Text>
                              </span>
                            }
                          />
                        ) : (
                          <Button
                            type="primary"
                            icon={item.uploading ? <LoadingOutlined /> : <CloudUploadOutlined />}
                            onClick={() => handleUploadToChain(item.id)}
                            loading={item.uploading}
                            size="small"
                            className="flex items-center gap-1.5"
                          >
                            <span>上传至链上</span>
                          </Button>
                        )}
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteRecord(item.id)}
                          size="small"
                        />
                      </div>
                    }
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Tag color="blue" className="m-0">
                            {item.dataType}
                          </Tag>
                        </div>
                        <Text type="secondary" className="text-sm">
                          {new Date(item.timestamp).toLocaleString()}
                        </Text>
                      </div>
                      
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <Text type="secondary" className="text-sm">加密值：</Text>
                          <Button 
                            type="link" 
                            size="small"
                            onClick={() => toggleExpand(item.id)}
                          >
                            {expandedItems[item.id] ? '收起' : '展开'}
                          </Button>
                        </div>
                        <Tooltip title="点击复制" placement="top">
                          <Paragraph 
                            copyable={{ 
                              text: item.encryptedValue,
                              tooltips: ['复制', '已复制！'],
                            }} 
                            className="mb-0 font-mono text-sm leading-relaxed break-all"
                          >
                            {expandedItems[item.id] 
                              ? item.encryptedValue
                              : `${item.encryptedValue.substring(0, 50)}...`
                            }
                          </Paragraph>
                        </Tooltip>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <Text type="secondary" className="block mb-1">用户公钥</Text>
                          <div className="font-mono bg-gray-50 p-2 rounded truncate">
                            {item.userPublicKey.substring(0, 20)}...
                          </div>
                        </div>
                        <div>
                          <Text type="secondary" className="block mb-1">FHE 公钥</Text>
                          <div className="font-mono bg-gray-50 p-2 rounded truncate">
                            {item.fhePublicKey.substring(0, 20)}...
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}; 