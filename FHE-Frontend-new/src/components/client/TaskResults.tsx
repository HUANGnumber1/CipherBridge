import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, message, Modal, Space, Typography, Form, Input, Select, Radio, Badge } from 'antd';
import { 
  CheckCircleOutlined, 
  SyncOutlined, 
  PlayCircleOutlined, 
  LockOutlined, 
  UnlockOutlined, 
  CloudUploadOutlined,
  PlusOutlined,
  BankOutlined,
  DownloadOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { Task } from '../../types';
import { ethers } from 'ethers';
import contractConfig from '../../config/contracts';
import { DataType } from '../../services/fheApi';
import {fheApi} from '../../services/fheApi';
import  messageApi from '../../App';
import jsPDF from 'jspdf';

const { Paragraph, Title, Text } = Typography;
const { Option } = Select;

interface BusinessTaskRequest {
  bankAddress: string;
  businessType: string;
}

interface TaskResult {
  taskId: string;
  encryptedResult: string;
  decryptedResult?: string;
  signature?: string;
}

// const mockTasks: Task[] = [
//   {
//     id: '1',
//     bankId: 'bank1',
//     businessType: '贷款申请',
//     status: 'pending'
//   },
//   {
//     id: '2',
//     bankId: 'bank2',
//     businessType: '信用评估',
//     status: 'pending'
//   }
// ];

// 添加用于存储和获取解密结果的工具函数
const storeDecryptedResult = (taskId: string, decryptedResult: string) => {
  try {
    const storedResults = localStorage.getItem('decryptedResults');
    const results = storedResults ? JSON.parse(storedResults) : {};
    results[taskId] = decryptedResult;
    localStorage.setItem('decryptedResults', JSON.stringify(results));
  } catch (error) {
    console.error('Failed to store decrypted result:', error);
  }
};

const getDecryptedResult = (taskId: string): string | null => {
  try {
    const storedResults = localStorage.getItem('decryptedResults');
    if (!storedResults) return null;
    const results = JSON.parse(storedResults);
    return results[taskId] || null;
  } catch (error) {
    console.error('Failed to get decrypted result:', error);
    return null;
  }
};

export const TaskResults: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isNewTaskModalVisible, setIsNewTaskModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [tasks, setTasks] = useState<Task[]>();
  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'published'>('pending');
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [publishedTasks, setPublishedTasks] = useState<Task[]>([]);
  const [expandedResult, setExpandedResult] = useState(false);
  const [isViewModalVisible, setIsViewModalVisible] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    refreshTasks();
  }, [isModalVisible]);

  // 将 handleViewDecryptedResult 移到组件内部
  const handleViewDecryptedResult = async (task: Task) => {
    try {
      const storedWallet = localStorage.getItem('client_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的账户！');
        return;
      }

      const wallet = JSON.parse(storedWallet);
      
      // 解密结果
      const decryptResponse = await fheApi.decrypt(
        wallet.address,
        task.businessType as DataType,
        task.encryptedResult || ''
      );

      // 更新当前任务的解密结果
      setCurrentTask(prev => ({
        ...prev!,
        decryptedResult: decryptResponse.value.toString()
      }));

    } catch (error: any) {
      console.error('Failed to decrypt result:', error);
      if (error.response?.data?.message) {
        messageApi.error('解密失败：' + error.response.data.message);
      } else {
        messageApi.error('解密失败：' + error.message);
      }
    }
  };

  // 修改 handleProcessTask 函数
  const handleProcessTask = async (task: Task) => {
    console.log('Processing task:', task);
    setCurrentTask(task);
    setTaskResult(null);
    setIsDecrypted(false);
    
    if (task.status === 'published') {
      await handleViewDecryptedResult(task);
      setIsViewModalVisible(true);
    } else {
      setIsModalVisible(true);
    }
  };

  const handleRequestResult = async () => {
    if (!currentTask) return;
    try {
      setTaskResult({
        taskId: currentTask.id,
        encryptedResult: currentTask.encryptedResult || ''
      });
      messageApi.success('加密结果获取成功！');
    } catch (error) {
      messageApi.error('结果获取失败！');
      console.error('Result retrieval failed:', error);
    }
  };

  const handleDecryptAndSign = async () => {
    if (!currentTask || !taskResult) return;
    try {
      setDecrypting(true);
      const storedWallet = localStorage.getItem('client_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的客户端账户！');
        return;
      }

      const wallet = JSON.parse(storedWallet);
      // const provider = new ethers.providers.JsonRpcProvider('/api');
      // const signer = new ethers.Wallet(wallet.privateKey, provider);
      console.log(wallet.address, currentTask?.businessType, taskResult?.encryptedResult);
      const decryptResponse = await fheApi.decrypt(
        wallet.address,
        currentTask?.businessType as DataType,
        taskResult?.encryptedResult
      );

      const decryptedResult = decryptResponse.value.toString();
      
      // 存储解密结果
      storeDecryptedResult(currentTask?.id, decryptedResult);
      
      const messageHash = ethers.utils.id(decryptedResult);
      const signature = await new ethers.Wallet(wallet.privateKey).signMessage(
        ethers.utils.arrayify(messageHash)
      );

      setTaskResult(prev => ({
        ...prev!,
        decryptedResult,
        signature
      }));
      setIsDecrypted(true);
      messageApi.success('结果解密并签名成功！');
    } catch (error) {
      messageApi.error('结果解密与签名失败！');
      console.error('Decryption failed:', error);
    } finally {
      setDecrypting(false);
    }
  };

  const handlePublishAndFinish = async () => {
    try {
      setPublishing(true);
      const storedWallet = localStorage.getItem('client_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的客户端账户！');
        return;
      }

      const wallet = JSON.parse(storedWallet);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(wallet.privateKey, provider);
      
      const taskManagement = new ethers.Contract(
        contractConfig.TaskManagement.address,
        contractConfig.TaskManagement.abi,
        signer
      );

      const tx = await taskManagement.publishTaskResult(
        currentTask?.id,
        taskResult?.signature
      );

      await tx.wait();
      messageApi.success('结果已发布，任务完成！');
      setIsModalVisible(false);
      setCurrentTask(null);
      setTaskResult(null);
      setIsDecrypted(false);
      refreshTasks();
    } catch (error) {
      messageApi.error('结果发布失败！');
      console.error('Publishing failed:', error);
    } finally {
      setPublishing(false);
    }
  };

  const handleNewTask = async (values: BusinessTaskRequest) => {
    try {
      const storedWallet = localStorage.getItem('client_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的账户！');
        return;
      }

      const wallet = JSON.parse(storedWallet);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(wallet.privateKey, provider);
      
      const taskManagement = new ethers.Contract(
        contractConfig.TaskManagement.address,
        contractConfig.TaskManagement.abi,
        signer
      );

      const tx = await taskManagement.createTask(
        values.bankAddress,
        values.businessType
      );

      console.log('Transaction sent:', tx.hash);
      
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt);

      const taskCreatedEvent = receipt.events?.find(
        (event: any) => event.event === 'TaskCreated'
      );

      if (taskCreatedEvent) {
        const taskId = taskCreatedEvent.args.taskId.toString();
        messageApi.success(`业务任务创建成功！任务 ID：${taskId}`);
        
        // Close modal and reset form
        setIsNewTaskModalVisible(false);
        form.resetFields();

        // Refresh tasks after successful creation
        await refreshTasks();
      } else {
        throw new Error('交易回执中未找到任务创建事件');
      }

    } catch (error: any) {
      console.error('Failed to create task:', error);
      
      if (error.message.includes('User not registered')) {
        messageApi.error('您必须是已注册用户才能创建任务！');
      } else if (error.message.includes('Invalid bank address')) {
        messageApi.error('提供的银行地址无效！');
      } else {
        messageApi.error('创建业务任务失败：' + error.message);
      }
    }
  };

  const refreshTasks = async () => {
    try {
      const storedWallet = localStorage.getItem('client_wallet');
      if (!storedWallet) return;

      const wallet = JSON.parse(storedWallet);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(wallet.privateKey, provider);

      const taskManagement = new ethers.Contract(
        contractConfig.TaskManagement.address,
        contractConfig.TaskManagement.abi,
        signer
      );

      const [pending, completed, published] = await Promise.all([
        taskManagement.getUserPendingTasks(wallet.address),
        taskManagement.getUserCompletedUnpublishedTasks(wallet.address),
        taskManagement.getUserCompletedAndPublishedTasks(wallet.address),
        [],[]
      ]);

      const formatTasks = (tasks: any[]): Task[] => tasks.map((task: any) => ({
        id: task.taskId.toString(),
        bankId: task.bankAddress,
        businessType: task.taskType,
        status: task.isCompleted 
          ? (task.is已发布 ? 'published' : 'completed') 
          : 'pending',
        createdAt: parseInt(task.createdAt._hex, 16),
        encryptedResult: task.encryptedResult || '',
        decryptedResult: task.decryptedResult || '',
        signature: task.signature || ''
      }));

      setPendingTasks(formatTasks(pending));
      setCompletedTasks(formatTasks(completed));
      setPublishedTasks(formatTasks(published));
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      messageApi.error('任务加载失败');
    }
  };

  const columns = [
    {
      title: '任务 ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: '银行 ID',
      dataIndex: 'bankId',
      key: 'bankId',
    },
    {
      title: '业务类型',
      dataIndex: 'businessType',
      key: 'businessType',
      render: (text: string) => <Tag color="blue">{text.toUpperCase()}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag
          icon={status === 'completed' ? <InfoCircleOutlined /> : status === 'published' ? <CheckCircleOutlined /> : <SyncOutlined spin />}
          color={status === 'published' ? 'success' : 'processing'}
        >
          {status.toUpperCase()}  
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record: Task) => (
        <Space>
          {record.status === 'pending' && (
            <Button
              type="default"
              icon={<SyncOutlined spin />}
            >
              等待银行处理
            </Button>
          )}
          {record.status === 'completed' && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handleProcessTask(record)}
            >
              处理结果
            </Button>
          )}
          {record.status === 'published' && (
            <Button
              type="link"
              icon={<CheckCircleOutlined />}
              onClick={() => handleProcessTask(record)}
            >
              查看结果
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const generateCertificate = () => {
    try {
      if (!currentTask) return;

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const maxLineWidth = pageWidth - 2 * margin;
      
      // 添加标题
      doc.setFontSize(20);
      doc.text('企业资质证明', pageWidth/2, 20, { align: 'center' });
      
      // 添加分隔线
      doc.setLineWidth(0.5);
      doc.line(margin, 25, pageWidth-margin, 25);
      
      // 设置正文字体大小
      doc.setFontSize(12);
      
      // 准备内容（除签名外）
      const basicContent = [
        `证明编号：${currentTask.id}`,
        `银行地址：${currentTask.bankId}`,
        `业务类型：${currentTask.businessType}`,
        `资质结果：${currentTask.decryptedResult}`,
        `签发日期：${new Date().toLocaleDateString()}`
      ];

      // 先添加基本内容
      let yPosition = 40;
      basicContent.forEach((text) => {
        doc.text(text, margin, yPosition);
        yPosition += 10;
      });

      // 处理签名的自动换行
      if (currentTask.signature) {
        doc.text('验证签名：', margin, yPosition);
        yPosition += 7; // 稍微缩小签名行间距

        // 将签名分成多行
        const signatureLines = doc.splitTextToSize(
          currentTask.signature,
          maxLineWidth
        );
        
        // 添加签名文本
        signatureLines.forEach((line: string) => {
          doc.text(line, margin, yPosition);
          yPosition += 7; // 签名行使用更小的行间距
        });
      }

      // 添加页脚
      doc.setFontSize(10);
      doc.text(
        '本证明已在区块链上进行数字签名与验证。',
        pageWidth/2,
        250,
        { align: 'center' }
      );
      
      // 保存PDF
      doc.save(`business-certificate-${currentTask.id}.pdf`);
      messageApi.success('证明生成成功！');
    } catch (error) {
      console.error('Failed to generate certificate:', error);
      messageApi.error('证明生成失败');
    }
  };

  return (
    <>
      {contextHolder}
      <Card 
        className="shadow-md hover:shadow-lg transition-shadow duration-300"
        title="任务管理"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsNewTaskModalVisible(true)}
          >
            <span className="!hidden sm:!inline">新建业务任务</span>
          </Button>
        }
      >
        <div className="flex flex-col space-y-6">
          <div className="flex justify-center flex-wrap">
            <Radio.Group 
              value={activeTab} 
              onChange={e => setActiveTab(e.target.value)}
              size="large"
              className="shadow-sm flex-wrap"
            >
              <Radio.Button value="pending">
                <div className="px-2 py-1">
                  <span>待处理任务 {" "}</span>
                  <Badge count={pendingTasks.length} className="ml-2" />
                </div>
              </Radio.Button>
              <Radio.Button value="completed">
                <div className="px-2 py-1">
                  <span>已完成未发布 {" "}</span>
                  <Badge count={completedTasks.length} className="ml-2" />
                </div>
              </Radio.Button>
              <Radio.Button value="published">
              <div className="px-2 py-1">
                <span>已发布 {" "}</span>
                <Badge
                  count={publishedTasks.length} 
                  className="ml-2"
                  style={{ backgroundColor: '#52c41a' }}  // 使用 Ant Design 的标准绿色
                />
              </div>
              </Radio.Button>
            </Radio.Group>
          </div>

          <div className="overflow-x-auto">
            <Table
              dataSource={
                activeTab === 'pending' 
                  ? pendingTasks 
                  : activeTab === 'completed' 
                    ? completedTasks 
                    : publishedTasks
              }
              columns={columns}
              rowKey="id"
              pagination={false}
              className="custom-table"
            />
          </div>
        </div>
      </Card>

      <Modal
        title={
          <div className="flex items-center space-x-2">
            <PlayCircleOutlined className="text-blue-500" />
            <span> 处理任务：{currentTask?.id}</span>
          </div>
        }
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setTaskResult(null);
          setIsDecrypted(false);
        }}
        footer={null}
        width={700}
        className="custom-modal"
      >
        <div className="space-y-6">
          {!taskResult ? (
            <Button
              type="primary"
              icon={<LockOutlined />}
              onClick={handleRequestResult}
              block
              size="large"
              className="rounded-lg h-12"
            >
              请求加密结果
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="mb-4">
                <Text strong className="text-lg mb-2 block">加密结果：</Text>
                <div className="bg-white p-3 rounded border border-gray-200">
                  <div className="font-mono break-all">
                    {expandedResult 
                      ? taskResult.encryptedResult
                      : taskResult.encryptedResult.substring(0, 50) + '...'
                    }
                  </div>
                  <Button 
                    type="link" 
                    onClick={() => setExpandedResult(!expandedResult)}
                    size="small"
                    className="mt-1 p-0"
                  >
                    {expandedResult ? '收起' : '展开'}
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    className="mt-1 p-0 ml-4"
                    onClick={() => {
                      navigator.clipboard.writeText(taskResult.encryptedResult);
                      messageApi.success('已复制到剪贴板！');
                    }}
                  >
                    复制
                  </Button>
                </div>
              </div>
              
              {isDecrypted && taskResult.decryptedResult && (
                <div className="space-y-4">
                  <div>
                    <Text strong className="text-lg mb-2 block">解密结果：</Text>
                    <Paragraph copyable className="mb-0 bg-white p-3 rounded border border-gray-200">
                      {taskResult.decryptedResult}
                    </Paragraph>
                  </div>

                  <div>
                    <Text strong className="text-lg mb-2 block">签名：</Text>
                    <div className="bg-white p-3 rounded border border-gray-200">
                      <div className="font-mono break-all">
                        {taskResult.signature}
                      </div>
                      <Button
                        type="link"
                        size="small"
                        className="mt-1 p-0"
                        onClick={() => {
                          if (taskResult.signature) {
                            navigator.clipboard.writeText(taskResult.signature);
                            messageApi.success('签名已复制到剪贴板！');
                          }
                        }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-4">
                {!isDecrypted ? (
                  <Button
                    type="primary"
                    icon={<UnlockOutlined />}
                    onClick={handleDecryptAndSign}
                    size="large"
                    className="rounded-lg"
                  >
                    解密并签名结果
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    onClick={handlePublishAndFinish}
                    size="large"
                    className="rounded-lg"
                  >
                    发布结果并完成任务
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title={
          <div className="flex items-center space-x-2">
            <PlusOutlined className="text-blue-500" />
            <span>新建业务任务</span>
          </div>
        }
        open={isNewTaskModalVisible}
        onCancel={() => setIsNewTaskModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form
          form={form}
          onFinish={handleNewTask}
          layout="vertical"
          className="mt-4"
        >
          <Form.Item
            name="bankAddress"
            label={<Text strong>银行地址</Text>}
            rules={[{ required: true, message: '请输入银行地址！' }]}
          >
            <Input 
              prefix={<BankOutlined className="text-gray-400" />} 
              placeholder="请输入银行地址"
              className="rounded-lg"
            />
          </Form.Item>

          <Form.Item
            name="businessType"
            label={<Text strong>业务类型</Text>}
            rules={[{ required: true, message: '请选择业务类型！' }]}
          >
            <Select 
              placeholder="选择业务类型"
              className="rounded-lg"
            >
              <Option value="loan">贷款申请</Option>
              <Option value="credit">信用评估</Option>
              <Option value="mortgage">抵押贷款申请</Option>
            </Select>
          </Form.Item>

          <div className="flex justify-end">
            <Button
              type="primary"
              htmlType="submit"
              className="rounded-lg"
              onClick={() => setIsNewTaskModalVisible(false)}
            >
              创建业务任务
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title={
          <div className="flex items-center space-x-2">
            <CheckCircleOutlined className="text-green-500" />
            <span> 查看已发布任务：{currentTask?.id}</span>
          </div>
        }
        open={isViewModalVisible}
        onCancel={() => {
          setIsViewModalVisible(false);
          setCurrentTask(null);
        }}
        footer={
          <div className="flex justify-end">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={generateCertificate}
              className="rounded-lg"
            >
              生成证明
            </Button>
          </div>
        }
        width={700}
        className="custom-modal"
      >
        <div className="space-y-4">
          <Card size="small" className="shadow-sm">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Text strong>任务详情 {" "}</Text>
                <Tag color="success">已发布</Tag>
              </div>
              
              <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                  <Text type="secondary">银行地址:</Text>
                  <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                    {currentTask?.bankId}
                  </div>
                </div>

                <div>
                  <Text type="secondary">业务类型：</Text>
                  <div className="text-sm mt-1">
                    {currentTask?.businessType}
                  </div>
                </div>

                <div>
                  <Text type="secondary">解密结果：</Text>
                  <div className="bg-white p-3 rounded border border-gray-200">
                    {currentTask?.decryptedResult || '解密中...'}
                  </div>
                </div>

                <div>
                  <Text type="secondary">签名：</Text>
                  <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                    <div className="break-all">
                      {currentTask?.signature}
                    </div>
                    <Button
                      type="link"
                      size="small"
                      className="mt-1 p-0"
                      onClick={() => {
                        if (currentTask?.signature) {
                          navigator.clipboard.writeText(currentTask.signature);
                          messageApi.success('签名已复制到剪贴板！');
                        }
                      }}
                    >
                      复制
                    </Button>
                  </div>
                </div>

                <div>
                  <Text type="secondary">创建时间：</Text>
                  <div className="text-sm mt-1">
                    {new Date(currentTask?.createdAt || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </Modal>
    </>
  );
};