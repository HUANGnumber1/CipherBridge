import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, message, Modal, List, Typography, Spin, Radio, Badge, Space } from 'antd';
import { CheckCircleOutlined, SyncOutlined, LockOutlined, CalculatorOutlined } from '@ant-design/icons';
import { ethers } from 'ethers';
import contractConfig from '../../config/contracts';
import { DataType, fheApi } from '../../services/fheApi';

const { Text } = Typography;

//maps DataType to taskType
const taskTypeMap: Record<string, DataType> = {
  loan: 'monthly_income',
  credit: 'credit_score',
  mortgage: 'property_value'
};

interface ContractTask {
  taskId: string;
  bankAddress: string;
  userAddress: string;
  taskType: string;
  encryptedResult: string;
  signature: string;
  isCompleted: boolean;
  isPublished: boolean;
  createdAt: number;
}

// 添加验证签名的函数
const verifySignature = (message: string, signature: string) => {
  try {
    // 从签名中恢复地址
    const recoveredAddress = ethers.utils.verifyMessage(
      ethers.utils.arrayify(ethers.utils.id(message)),
      signature
    );
    return recoveredAddress;
  } catch (error) {
    console.error('Failed to verify signature:', error);
    return null;
  }
};

export const TaskList: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [currentTask, setCurrentTask] = useState<ContractTask | null>(null);
  const [tasks, setTasks] = useState<ContractTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  const [userDataLoading, setUserDataLoading] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [computationLoading, setComputationLoading] = useState(false);
  const [computationResult, setComputationResult] = useState<string | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [isDataModalVisible, setIsDataModalVisible] = useState(false);
  const [expandedData, setExpandedData] = useState<Record<number, boolean>>({});
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [expandedResult, setExpandedResult] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'published'>('pending');
  const [pendingTasks, setPendingTasks] = useState<ContractTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<ContractTask[]>([]);
  const [publishedTasks, setPublishedTasks] = useState<ContractTask[]>([]);

  // Add wallet change listener
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'bank_wallet') {
        fetchTasks();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 获取银行任务列表
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const storedWallet = localStorage.getItem('bank_wallet');
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

      // 获取三种类型的任务
      const [pending, completed, published] = await Promise.all([
        taskManagement.getBankPendingTasks(wallet.address),
        taskManagement.getBankCompletedUnpublishedTasks(wallet.address),
        taskManagement.getBankCompletedAndPublishedTasks(wallet.address)
      ]);

      // 转换任务数据格式的函数
      const formatTasks = (tasks: any[]) => tasks.map((task: any) => ({
        taskId: task.taskId.toString(),
        bankAddress: task.bankAddress,
        userAddress: task.userAddress,
        taskType: task.taskType,
        encryptedResult: task.encryptedResult,
        signature: task.signature,
        isCompleted: task.isCompleted,
        isPublished: task.isPublished,
        createdAt: parseInt(task.createdAt._hex, 16)
      }));

      setPendingTasks(formatTasks(pending));
      setCompletedTasks(formatTasks(completed));
      setPublishedTasks(formatTasks(published));
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      messageApi.error('任务加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleProcessTask = async (task: ContractTask) => {
    setCurrentTask(task);
    setIsModalVisible(true);
  };

  const handleRequestUserData = async () => {
    if (!currentTask) return;
    try {
      setUserDataLoading(true);
      const storedWallet = localStorage.getItem('bank_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的银行账户！');
        return;
      }

      const wallet = JSON.parse(storedWallet);
      const provider = new ethers.providers.JsonRpcProvider('/api');
      const signer = new ethers.Wallet(wallet.privateKey, provider);
      
      const dataStorage = new ethers.Contract(
        contractConfig.DataStorage.address,
        contractConfig.DataStorage.abi,
        signer
      );

      // 获取用户数据
      console.log('currentTask.taskType', currentTask.taskType);
      console.log('taskTypeMap[currentTask.taskType as DataType]', taskTypeMap[currentTask.taskType as DataType]);
      console.log('currentTask.userAddress', currentTask.userAddress);
      const data = await dataStorage.getDataByUserAndType(
        currentTask.userAddress,
        taskTypeMap[currentTask.taskType as DataType]
      );

      console.log('data', data);

      setUserData(data);
      messageApi.success('用户数据获取成功！');
    } catch (error: any) {
      console.error('Failed to get user data:', error);
      messageApi.error('获取用户数据失败：' + error.message);
    } finally {
      setUserDataLoading(false);
    }
  };

  const handleRequestComputation = async () => {
    if (!currentTask || !userData) return;
    try {
      setComputationLoading(true);
      const storedWallet = localStorage.getItem('bank_wallet');
      if (!storedWallet) {
        messageApi.error('请先连接您的账户！');
        return;
      }
      
      // 从用户数据中提取加密值
      const encryptedValues = userData.map((entry: any) => entry.encryptedData);
      
      // 调用 FHE 计算接口
      const computationResponse = await fheApi.compute(
        currentTask.userAddress,
        currentTask.taskId,
        taskTypeMap[currentTask.taskType as DataType],
        encryptedValues
      );

      console.log('Computation response:', computationResponse);
      
      // 保存计算结果
      setComputationResult(computationResponse.result);
      messageApi.success('FHE 计算完成！');
    } catch (error: any) {
      console.error('Failed to compute result:', error);
      if (error.response?.data?.message) {
        messageApi.error('计算失败：' + error.response.data.message);
      } else {
        messageApi.error('计算结果失败：' + error.message);
      }
    } finally {
      setComputationLoading(false);
    }
  };

  const handlePublishResult = async () => {
    if (!currentTask || !computationResult) return;
    try {
      setPublishLoading(true);
      const storedWallet = localStorage.getItem('bank_wallet');
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

      console.log('computationResult', computationResult);

      const tx = await taskManagement.completeTask(
        currentTask.taskId,
        computationResult
      );


      console.log('Transaction sent:', tx.hash);
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt);

      messageApi.success('任务完成！');
      setIsModalVisible(false);
      setCurrentTask(null);
      setUserData(null);
      setComputationResult(null);
      fetchTasks();
    } catch (error: any) {
      console.error('Failed to publish result:', error);
      messageApi.error('结果发布失败：' + error.message);
    } finally {
      setPublishLoading(false);
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedData(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const columns = [
    {
      title: '任务 ID',
      dataIndex: 'taskId',
      key: 'taskId',
    },
    {
      title: '用户地址',
      dataIndex: 'userAddress',
      key: 'userAddress',
      render: (text: string) => (
        <div className="flex items-center">
          <Text copyable className="mb-0 leading-none">
            {text.substring(0, 10)}...
          </Text>
        </div>
      ),
    },
    {
      title: '业务类型',
      dataIndex: 'taskType',
      key: 'taskType',
      render: (text: string) => <Tag color="blue">{text.toUpperCase()}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (timestamp: number) => new Date(timestamp).toLocaleString(),
    },
    {
      title: '状态',
      key: 'status',
      render: (_, record: ContractTask) => (
        <Tag color={
          !record.isCompleted 
            ? 'blue' 
            : record.is已发布 
              ? 'green' 
              : 'orange'
        }>
          {!record.isCompleted 
            ? '待处理' 
            : record.is已发布 
              ? '已发布' 
              : '已完成'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: ContractTask) => (
        <Space>
          {!record.isCompleted && (
            <Button 
              type="primary"
              onClick={() => handleProcessTask(record)}
            >
              处理
            </Button>
          )}
          {record.isCompleted && !record.is已发布 && (
            <Button type="default" disabled>
              等待用户处理
            </Button>
          )}
          {record.is已发布 && (
            <Button 
              type="link" 
              onClick={() => {
                setCurrentTask(record);
                setComputationResult(record.encryptedResult);
                setIsResultModalVisible(true);
              }}
            >
              查看结果
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Card title="银行任务" className="w-full">
        <div className="flex flex-col space-y-6">
          {/* Tabs Container */}
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

          {/* Table Container */}
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <Spin size="large" />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <Table
                dataSource={
                  activeTab === 'pending' 
                    ? pendingTasks 
                    : activeTab === 'completed' 
                      ? completedTasks 
                      : publishedTasks
                }
                columns={columns}
                rowKey="taskId"
                pagination={false}
                className="custom-table"
              />
            </div>
          )}
        </div>
      </Card>

      <Modal
        title={`处理任务：${currentTask?.taskId}`}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setUserData(null);
          setComputationResult(null);
        }}
        footer={null}
        width={600}
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">任务详情：</h3>
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <p><strong>用户地址：</strong> {currentTask?.userAddress}</p>
              <p><strong>业务类型：</strong> {currentTask?.taskType}</p>
              <p><strong>创建时间：</strong> {currentTask?.createdAt && 
                new Date(currentTask.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Button
                type="primary"
                icon={<LockOutlined />}
                onClick={handleRequestUserData}
                loading={userDataLoading}
                disabled={!!userData}
                block
              >
                按业务类型请求用户数据
              </Button>
              {userData && (
                <div className="mt-2 space-y-2">
                  <div className="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
                    <Text type="success">User data retrieved successfully!</Text>
                    <Button 
                      type="link" 
                      onClick={() => setIsDataModalVisible(true)}
                      className="ml-2"
                    >
                      查看数据
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Button
                type="primary"
                icon={<CalculatorOutlined />}
                onClick={handleRequestComputation}
                loading={computationLoading}
                disabled={!userData || !!computationResult}
                block
              >
                请求 FHE 计算
              </Button>
              {computationResult && (
                <div className="mt-2 space-y-2">
                  <div className="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
                    <Text type="success">计算完成！</Text>
                    <Button 
                      type="link" 
                      onClick={() => setIsResultModalVisible(true)}
                      className="ml-2"
                    >
                      查看结果
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handlePublishResult}
                loading={publishLoading}
                disabled={!computationResult}
                block
              >
                发布结果并完成任务
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        title="用户数据详情"
        open={isDataModalVisible}
        onCancel={() => {
          setIsDataModalVisible(false);
          setExpandedData({});
        }}
        footer={null}
        width={500}
      >
        <div className="max-h-96 overflow-y-auto">
          <div className="space-y-4">
            {userData && userData.map((entry: any, index: number) => (
              <Card key={index} size="small" className="shadow-sm">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Text strong>数据条目 {index + 1} {" "} </Text>
                    <Tag color="blue">{entry.dataType}</Tag>
                  </div>
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    <div>
                      <Text type="secondary">银行地址：</Text>
                      <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                        {entry.bankAddress}
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">加密数据：</Text>
                      <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                        <div className="break-all">
                          {expandedData[index] 
                            ? entry.encryptedData
                            : entry.encryptedData.substring(0, 50) + '...'
                          }
                        </div>
                        <Button 
                          type="link" 
                          onClick={() => toggleExpand(index)}
                          size="small"
                          className="mt-1 p-0"
                        >
                          {expandedData[index] ? '收起' : '展开'}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">过期时间：</Text>
                      <div className="text-sm mt-1">
                        {new Date(entry.expiryDate * 1000).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        title="计算结果"
        open={isResultModalVisible}
        onCancel={() => {
          setIsResultModalVisible(false);
          setExpandedResult(false);
        }}
        footer={null}
        width={500}
      >
        <div className="space-y-4">
          <Card size="small" className="shadow-sm">
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2">
                <Text strong>任务 ID：{currentTask?.taskId} {" "} </Text>
                <Tag color="green">已完成</Tag>
              </div>
              <div className="grid grid-cols-1 gap-2 mt-2">
                <div>
                  <Text type="secondary">业务类型：</Text>
                  <div className="text-sm mt-1">
                    {currentTask?.taskType}
                  </div>
                </div>
                <div>
                  <Text type="secondary">加密结果：</Text>
                  <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                    <div className="break-all">
                      {expandedResult 
                        ? computationResult
                        : computationResult?.substring(0, 50) + '...'
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
                  </div>
                </div>
                {currentTask?.signature && currentTask?.signature !== "0x" && (
                  <div>
                    <Text type="secondary">签名：</Text>
                    <div className="font-mono bg-gray-50 p-2 rounded text-sm mt-1">
                      <div className="break-all">
                        {currentTask.signature}
                      </div>
                      <div className="flex space-x-4">
                        <Button
                          type="link"
                          size="small"
                          className="mt-1 p-0"
                          onClick={() => {
                            navigator.clipboard.writeText(currentTask.signature);
                            messageApi.success('签名已复制到剪贴板！');
                          }}
                        >
                          复制
                        </Button>
                        {/* <Button
                          type="link"
                          size="small"
                          className="mt-1 p-0"
                          onClick={() => {
                            if (computationResult) {
                              const recoveredAddress = verifySignature(
                                computationResult,
                                currentTask.signature
                              );
                              if (recoveredAddress) {
                                messageApi.success('Signature verified! Signer: ' + recoveredAddress);
                              } else {
                                messageApi.error('Invalid signature!');
                              }
                            }
                          }}
                        >
                          Verify
                        </Button> */}
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <Text type="secondary">计算时间：</Text>
                  <div className="text-sm mt-1">
                    {new Date().toLocaleString()}
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