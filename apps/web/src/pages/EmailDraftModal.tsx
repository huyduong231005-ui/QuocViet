import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Space, Tag, Typography, Divider, Tooltip } from 'antd';
import { RobotOutlined, CopyOutlined, ReloadOutlined, GoogleOutlined, MailOutlined, BankOutlined, UserOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';

const { Text } = Typography;

export interface SupplierTarget {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface EmailDraftContext {
  type: 'rfq' | 'po';
  supplierName: string;
  supplierEmail?: string;
  suppliers?: SupplierTarget[];
  productName?: string;
  quantity?: number;
  unit?: string;
  deadline?: string;
  rfqId?: string;
  orderId?: string;
  buyerCompany?: string;
  buyerName?: string;
  buyerEmail?: string;
}

export interface EmailDraftModalProps {
  open: boolean;
  onClose: () => void;
  context: EmailDraftContext | null;
  onSend?: (subject: string, body: string) => Promise<boolean | void>;
  sendLabel?: string;
}

export function EmailDraftModal({ open, onClose, context, onSend, sendLabel = 'Gửi qua hệ thống' }: EmailDraftModalProps) {
  const { request, auth } = useWorkspace();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [draftSource, setDraftSource] = useState<'ai' | 'template' | 'fallback' | null>(null);

  // Selected supplier in case RFQ has multiple invited suppliers
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  
  // Custom terms
  const [paymentTerm, setPaymentTerm] = useState<string>('Thanh toán chuyển khoản sau 30 ngày kể từ ngày nhận đủ hàng (Net 30)');
  const [deliveryTerm, setDeliveryTerm] = useState<string>('Giao hàng tận nơi tại kho bên Mua (DDP), miễn phí bốc dỡ');
  const [warrantyTerm, setWarrantyTerm] = useState<string>('Bảo hành tối thiểu 12 tháng theo tiêu chuẩn nhà sản xuất; cung cấp đầy đủ CO/CQ và hóa đơn VAT');
  const [notes, setNotes] = useState<string>('');

  const currentSupplier = context?.suppliers?.find(s => s.id === selectedSupplierId) || {
    id: 'single',
    name: context?.supplierName || 'Nhà cung cấp',
    email: context?.supplierEmail || '',
  };

  const buyerCompany = context?.buyerCompany || 'Công ty TNHH Quốc Việt (ProcureIQ)';
  const buyerName = context?.buyerName || auth?.user?.name || 'Phòng Thu mua & Chuỗi Cung ứng';
  const buyerEmail = context?.buyerEmail || auth?.user?.email || '';

  const generateDraft = async (targetSupplier: { name: string; email: string }) => {
    if (!context) return;
    setLoading(true);
    try {
      const payload = {
        type: context.type,
        supplierName: targetSupplier.name,
        supplierEmail: targetSupplier.email,
        buyerCompany,
        buyerName,
        buyerEmail,
        productName: context.productName,
        quantity: context.quantity,
        unit: context.unit,
        deadline: context.deadline,
        rfqId: context.rfqId,
        orderId: context.orderId,
        paymentTerms: paymentTerm,
        deliveryTerms: deliveryTerm,
        warranty: warrantyTerm,
        notes: notes.trim() || undefined,
      };

      const res = await request<{ subject: string; body: string; source: 'ai' | 'template' | 'fallback'; tokensUsed: number }>('/email/draft', payload);
      form.setFieldsValue({
        subject: res.subject,
        body: res.body,
      });
      setDraftSource(res.source);
    } catch (e: any) {
      message.error(e?.message || 'Không thể tạo bản thảo email');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && context) {
      const firstId = context.suppliers?.[0]?.id || '';
      setSelectedSupplierId(firstId);
      const initialSupplier = context.suppliers?.[0] || {
        name: context.supplierName,
        email: context.supplierEmail || '',
      };
      void generateDraft(initialSupplier);
    } else {
      form.resetFields();
      setDraftSource(null);
      setNotes('');
    }
  }, [open, context]);

  const handleSupplierChange = (supId: string) => {
    setSelectedSupplierId(supId);
    const target = context?.suppliers?.find(s => s.id === supId);
    if (target) {
      void generateDraft(target);
    }
  };

  const handleCopy = () => {
    const values = form.getFieldsValue();
    const text = `Gửi tới: ${currentSupplier.name} <${currentSupplier.email}>\nTiêu đề: ${values.subject || ''}\n\n${values.body || ''}`;
    navigator.clipboard.writeText(text);
    message.success('Đã sao chép nội dung email vào bộ nhớ tạm');
  };

  const handleOpenGmail = () => {
    const values = form.getFieldsValue();
    const to = currentSupplier.email;
    const su = values.subject || '';
    const body = values.body || '';

    // Direct Google Mail Web Compose URL
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
  };

  if (!context) return null;

  const isRfq = context.type === 'rfq';
  const modalTitle = isRfq
    ? `Thư mời chào giá (RFQ) - ${currentSupplier.name}`
    : `Thư phát hành đơn đặt hàng (PO) - ${currentSupplier.name}`;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space wrap>
          <RobotOutlined style={{ color: '#1677ff', fontSize: '18px' }} />
          <span style={{ fontWeight: 600 }}>{modalTitle}</span>
          {draftSource === 'ai' && <Tag color="blue">✨ AI Gemini soạn</Tag>}
          {draftSource === 'template' && <Tag color="green">Mẫu chuẩn B2B</Tag>}
        </Space>
      }
      width={840}
      style={{ top: 20 }}
      footer={
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Button
              type="primary"
              danger
              icon={<GoogleOutlined />}
              onClick={handleOpenGmail}
            >
              Mở trong Gmail
            </Button>
            <Button icon={<CopyOutlined />} onClick={handleCopy}>
              Sao chép nội dung
            </Button>
          </Space>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void generateDraft(currentSupplier)}
            >
              AI soạn thảo lại
            </Button>
            {onSend && (
              <Button
                type="primary"
                icon={<MailOutlined />}
                onClick={async () => {
                  const values = form.getFieldsValue();
                  await onSend(values.subject, values.body);
                  message.success('Đã gửi thành công');
                  onClose();
                }}
              >
                {sendLabel}
              </Button>
            )}
            <Button onClick={onClose}>Đóng</Button>
          </Space>
        </Space>
      }
    >
      <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', paddingRight: 8 }}>
        {/* Organization identity headers */}
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <BankOutlined style={{ color: '#0958d9', marginRight: 6 }} />
                <strong>Bên Mua (Đơn vị phát hành):</strong> {buyerCompany}
              </span>
              <span style={{ fontSize: '12.5px', color: '#64748b' }}>
                <UserOutlined style={{ marginRight: 4 }} />
                Phụ trách: <strong>{buyerName}</strong> ({buyerEmail})
              </span>
            </div>

            {/* Target Supplier Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <MailOutlined style={{ color: '#10b981' }} />
              <strong>Gửi đích danh tới NCC:</strong>
              {context.suppliers && context.suppliers.length > 1 ? (
                <Select
                  value={selectedSupplierId}
                  onChange={handleSupplierChange}
                  style={{ minWidth: 320, flex: 1 }}
                  options={context.suppliers.map(s => ({
                    value: s.id,
                    label: `${s.name} (${s.email || 'Chưa có email'})`,
                  }))}
                />
              ) : (
                <Text strong style={{ color: '#0f172a' }}>
                  {currentSupplier.name} {currentSupplier.email ? `<${currentSupplier.email}>` : ''}
                </Text>
              )}
            </div>
          </Space>
        </div>

        {/* Commercial terms customization */}
        <div style={{ background: '#fafafa', padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px dashed #cbd5e1' }}>
          <Text strong style={{ display: 'block', marginBottom: 8, color: '#334155' }}>
            ⚙️ Tùy biến điều khoản thương mại & Yêu cầu cho AI:
          </Text>

          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: 4 }}>
                Điều khoản thanh toán mong muốn:
              </span>
              <Space wrap size={6}>
                {[
                  'Thanh toán chuyển khoản sau 30 ngày kể từ ngày nhận đủ hàng (Net 30)',
                  'Tạm ứng 30% khi phát hành PO, 70% sau khi nghiệm thu đủ số lượng',
                  'Thanh toán 100% trong vòng 07 ngày làm việc sau khi nhận hàng và hóa đơn VAT',
                ].map(term => (
                  <Button
                    key={term}
                    size="small"
                    type={paymentTerm === term ? 'primary' : 'default'}
                    onClick={() => setPaymentTerm(term)}
                  >
                    {term.includes('Net 30') ? 'Net 30 ngày' : term.includes('Tạm ứng 30%') ? 'Tạm ứng 30/70' : '7 ngày sau nhận hàng'}
                  </Button>
                ))}
              </Space>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: 4 }}>
                Điều kiện giao hàng & Tiêu chuẩn:
              </span>
              <Space wrap size={6}>
                {[
                  'Giao hàng tận nơi tại kho bên Mua (DDP), miễn phí bốc dỡ',
                  'Giao hàng từng đợt theo thông báo của bên Mua, bảo đảm đúng tiến độ',
                  'Bảo hành tối thiểu 12 tháng, cung cấp đầy đủ giấy chứng nhận xuất xứ CO/CQ',
                ].map(term => (
                  <Button
                    key={term}
                    size="small"
                    type={deliveryTerm.includes(term.slice(0, 15)) ? 'primary' : 'default'}
                    onClick={() => setDeliveryTerm(term)}
                  >
                    {term.includes('DDP') ? 'Giao tại kho bên mua (DDP)' : term.includes('từng đợt') ? 'Giao theo đợt' : 'Bảo hành 12 tháng & CO/CQ'}
                  </Button>
                ))}
              </Space>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: 4 }}>
                Ghi chú / Yêu cầu thêm cho AI:
              </span>
              <Input
                placeholder="VD: Cần giao hàng gấp trước ngày 15, yêu cầu đóng thùng carton quy chuẩn..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onPressEnter={() => void generateDraft(currentSupplier)}
              />
            </div>
          </Space>
        </div>

        <Form form={form} layout="vertical">
          <Form.Item
            name="subject"
            label={<strong>Tiêu đề email</strong>}
            rules={[{ required: true, message: 'Nhập tiêu đề thư' }]}
          >
            <Input size="large" placeholder="Tiêu đề email..." />
          </Form.Item>

          <Form.Item
            name="body"
            label={<strong>Nội dung thư (cho phép chỉnh sửa trực tiếp)</strong>}
            rules={[{ required: true, message: 'Nhập nội dung thư' }]}
          >
            <Input.TextArea
              rows={14}
              placeholder="Nội dung email..."
              style={{
                fontFamily: 'Consolas, Menlo, Monaco, monospace, inherit',
                fontSize: '13.5px',
                lineHeight: '1.6',
                background: '#ffffff',
              }}
            />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
