import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Select, Space, Typography } from 'antd';
import { BankOutlined, FileAddOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Option } = Select;

interface BusinessTaskRequest {
  bankWeId: string;
  businessType: string;
}

export const BusinessTask: React.FC = () => {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const handleSubmit = async (values: BusinessTaskRequest) => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      messageApi.success('业务任务创建成功！');
      form.resetFields();
    } catch (error) {
      messageApi.error('创建业务任务失败！');
      console.error('Task creation failed:', error);
    }
  };

  return (
    <Card 
      className="shadow-md hover:shadow-lg transition-shadow duration-300"
      title={
        <div className="flex items-center space-x-2">
          <FileAddOutlined className="text-blue-500" />
          <Title level={4} className="m-0">新建业务任务</Title>
        </div>
      }
    >
      {contextHolder}
      <Form
        form={form}
        onFinish={handleSubmit}
        layout="vertical"
        className="max-w-lg mx-auto"
      >
        <Form.Item
          name="bankWeId"
          label={<Text strong>银行 WeID</Text>}
          rules={[{ required: true, message: '请输入银行 WeID！' }]}
        >
          <Input 
            prefix={<BankOutlined className="text-gray-400" />} 
            placeholder="请输入银行 WeID"
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

        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            icon={<FileAddOutlined />}
            size="large"
            block
            className="rounded-lg h-12"
          >
            提交业务任务
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}; 