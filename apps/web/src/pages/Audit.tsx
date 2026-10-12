import { useState, useMemo } from 'react';
import { 
  Alert, 
  Button, 
  Drawer, 
  Input, 
  Select, 
  Space, 
  Table, 
  Tabs, 
  Tag, 
  Typography, 
  Card, 
  Row, 
  Col, 
  Tooltip, 
  Progress, 
  message, 
  Dropdown, 
  Divider, 
  Radio, 
  Badge 
} from 'antd';
import type { MenuProps } from 'antd';
import { 
  FileExcelOutlined, 
  FilePdfOutlined, 
  RobotOutlined, 
  UserOutlined, 
  WarningOutlined, 
  SafetyCertificateOutlined, 
  InboxOutlined, 
  EyeOutlined, 
  CopyOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined,
  DownOutlined, 
  LineChartOutlined, 
  ShoppingCartOutlined, 
  ApartmentOutlined, 
  TagsOutlined, 
  FileTextOutlined, 
  KeyOutlined,
  DollarOutlined,
  AccountBookOutlined,
  AuditOutlined,
  CheckOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import { AreaChart, Area, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';
import { useWorkspace } from '../api';
import { date, shortId, money, number } from '../components';
import { PagedTable } from '../PagedTable';
import type { Audit, Movement, Order } from '../types';

const { Text, Title, Paragraph } = Typography;

/** Ánh xạ tên tiếng Việt chuẩn hóa cho các đối tượng nghiệp vụ */
const entityMeta: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  product: { label: 'Mặt hàng', icon: <FileTextOutlined />, color: 'blue' },
  supplier: { label: 'Nhà cung cấp', icon: <UserOutlined />, color: 'geekblue' },
  price: { label: 'Giá tham khảo', icon: <TagsOutlined />, color: 'orange' },
  request: { label: 'Nhu cầu mua sắm', icon: <FileTextOutlined />, color: 'blue' },
  approval: { label: 'Hồ sơ phê duyệt', icon: <SafetyCertificateOutlined />, color: 'green' },
  rfq: { label: 'Yêu cầu báo giá (RFQ)', icon: <TagsOutlined />, color: 'purple' },
  quotation: { label: 'Báo giá NCC', icon: <TagsOutlined />, color: 'cyan' },
  ahp_session: { label: 'Phiên AHP', icon: <ApartmentOutlined />, color: 'gold' },
  order: { label: 'Đơn mua hàng (PO)', icon: <ShoppingCartOutlined />, color: 'magenta' },
  receipt: { label: 'Phiếu nhập kho', icon: <InboxOutlined />, color: 'green' },
  evaluation: { label: 'Đánh giá NCC', icon: <CheckCircleOutlined />, color: 'gold' },
  evaluations: { label: 'Đánh giá NCC', icon: <CheckCircleOutlined />, color: 'gold' },
  outbox: { label: 'Email giao dịch', icon: <FileTextOutlined />, color: 'blue' },
  user: { label: 'Tài khoản người dùng', icon: <KeyOutlined />, color: 'volcano' },
  agent_run: { label: 'Tiến trình AI Agent', icon: <RobotOutlined />, color: 'purple' }
};

/** Từ điển chuẩn hóa toàn bộ hành động sang tiếng Việt chuyên nghiệp */
const actionDictionary: Record<string, { label: string; color: string; badge: string; isAgent?: boolean; isSensitive?: boolean }> = {
  // Hành động do AI Agent thực hiện
  'tool:finalize': { label: 'Chốt & Lập đơn mua (AI)', color: '#722ed1', badge: 'AI Quyết định', isAgent: true },
  'tool:evaluate': { label: 'Phân tích & Xếp hạng AHP (AI)', color: '#722ed1', badge: 'AI Phân tích', isAgent: true },
  'tool:receive_quotations': { label: 'Thu nhận & Bóc tách Báo giá (AI)', color: '#722ed1', badge: 'AI OCR/Bóc tách', isAgent: true },
  'tool:read_quotations': { label: 'Kiểm duyệt Báo giá NCC (AI)', color: '#722ed1', badge: 'AI Trích xuất', isAgent: true },
  'tool:check_anomaly': { label: 'Quét Bất thường Báo giá (AI)', color: '#eb2f96', badge: 'AI Cảnh báo', isAgent: true },
  'tool:draft_email': { label: 'Soạn Email Đàm phán B2B (AI)', color: '#722ed1', badge: 'AI Soạn thảo', isAgent: true },
  'tool:send_email': { label: 'Gửi Email Đối tác (AI)', color: '#722ed1', badge: 'AI Tự động', isAgent: true },
  'startAgent': { label: 'Khởi chạy Chuỗi Tác vụ AI', color: '#531dab', badge: 'Kích hoạt AI', isAgent: true },

  // Cổng kiểm duyệt của con người
  'requestApprove': { label: 'Phê duyệt Nhu cầu (Gate 1)', color: '#52c41a', badge: 'Kiểm soát Cổng 1' },
  'decide': { label: 'Phê duyệt Kết quả & Lập PO (Gate 2)', color: '#52c41a', badge: 'Kiểm soát Cổng 2' },
  'approval2': { label: 'Trình duyệt Phương án AHP', color: '#13c2c2', badge: 'Trình phương án' },

  // Nghiệp vụ Mua hàng, Kế toán & Kho
  'request': { label: 'Đề xuất Nhu cầu Mua sắm', color: '#1677ff', badge: 'Nhu cầu mới' },
  'rfq': { label: 'Phát hành Yêu cầu Báo giá (RFQ)', color: '#722ed1', badge: 'Gửi RFQ' },
  'quotation': { label: 'Ghi nhận Báo giá từ NCC', color: '#13c2c2', badge: 'Báo giá' },
  'quotationUpdate': { label: 'Điều chỉnh Dữ liệu Báo giá', color: '#fa8c16', badge: 'Sửa báo giá', isSensitive: true },
  'ahp': { label: 'Tính toán Ma trận Nhất quán AHP', color: '#faad14', badge: 'Chấm điểm AHP' },
  'order': { label: 'Phát hành Đơn mua hàng (PO)', color: '#eb2f96', badge: 'Đơn mua' },
  'send': { label: 'Phát hành Email PO tới NCC', color: '#1677ff', badge: 'Email PO' },
  'receipt': { label: 'Xác nhận Nhập kho Hàng hóa', color: '#52c41a', badge: 'Nhập kho' },
  'evaluation': { label: 'Đánh giá Hiệu suất Giao hàng NCC', color: '#faad14', badge: 'Đánh giá NCC' },

  // Danh mục & Tài khoản (Khu vực có rủi ro cao)
  'catalog:prices:create': { label: 'Thêm Giá Tham khảo', color: '#1677ff', badge: 'Thêm giá' },
  'catalog:prices:update': { label: 'Sửa Giá Tham khảo', color: '#f5222d', badge: 'Đổi giá danh mục', isSensitive: true },
  'catalog:prices:delete': { label: 'Xóa Giá Tham khảo', color: '#cf1322', badge: 'Xóa giá', isSensitive: true },
  'catalog:products:create': { label: 'Tạo Mặt hàng mới', color: '#1677ff', badge: 'Mặt hàng' },
  'catalog:suppliers:create': { label: 'Đăng ký NCC mới', color: '#1677ff', badge: 'Nhà cung cấp' },
  'catalog:import': { label: 'Nhập hàng loạt Danh mục (Excel)', color: '#fa8c16', badge: 'Import Excel' },
  'accounts:create': { label: 'Cấp Tài khoản Mới', color: '#1677ff', badge: 'Cấp quyền' },
  'accounts:update': { label: 'Thay đổi Phân quyền Tài khoản', color: '#f5222d', badge: 'Đổi quyền', isSensitive: true },
  'account:register': { label: 'Đăng ký Tài khoản Người dùng', color: '#595959', badge: 'Đăng ký' }
};

export function AuditPage() {
  const { data, download, busy } = useWorkspace();
  const [selected, setSelected] = useState<Audit | null>(null);
  const [entityType, setEntityType] = useState<string>();
  const [actorFilter, setActorFilter] = useState<'all' | 'agent' | 'user'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'events' | 'matching' | 'financial' | 'movements'>('events');
  const [movementKind, setMovementKind] = useState<string>();
  const [showChart, setShowChart] = useState<boolean>(true);

  if (!data) return null;

  // 1. Tính toán KPI Kiểm toán
  const totalApprovals = data.approvals.length;
  const selfApprovedCount = data.approvals.filter(
    a => a.decidedBy && a.requestId && data.requests.find(r => r.id === a.requestId)?.createdBy === a.decidedBy
  ).length;
  const agentRunCount = data.agentRuns.length;
  const complianceScore = Math.max(80, Math.min(100, Math.round(100 - selfApprovedCount * 10)));

  // 2. Tính toán Nghiệp vụ Kế toán: Đối chiếu 3 bên (3-Way Matching)
  const matchingLines = useMemo(() => {
    const list: Array<{
      orderId: string;
      orderCreatedAt: string;
      supplierId: string;
      supplierName: string;
      lineId: string;
      productName: string;
      sku: string;
      unit: string;
      orderedQty: number;
      unitPrice: number;
      vat: number;
      poAmount: number;
      receivedQty: number;
      acceptedQty: number;
      payableAmount: number;
      status: 'MATCHED' | 'PARTIAL' | 'DEFECT' | 'AWAITING';
    }> = [];

    for (const order of data.orders) {
      const sup = data.suppliers.find(s => s.id === order.supplierId);
      const supName = sup?.name || shortId(order.supplierId);

      for (const line of order.items) {
        const ordered = line.quantity;
        const received = line.receivedQuantity || 0;
        const accepted = line.acceptedQuantity || 0;
        const price = line.unitPrice;
        const lineVat = line.vat || 0;
        const poAmt = line.total || (ordered * price * (1 + lineVat));
        const payableAmt = accepted * price * (1 + lineVat);

        let matchStatus: 'MATCHED' | 'PARTIAL' | 'DEFECT' | 'AWAITING' = 'AWAITING';
        if (received === 0) {
          matchStatus = 'AWAITING';
        } else if (accepted === ordered && received === ordered) {
          matchStatus = 'MATCHED';
        } else if (accepted < received) {
          matchStatus = 'DEFECT';
        } else {
          matchStatus = 'PARTIAL';
        }

        list.push({
          orderId: order.id,
          orderCreatedAt: order.createdAt,
          supplierId: order.supplierId,
          supplierName: supName,
          lineId: line.id,
          productName: line.productName,
          sku: line.productSku,
          unit: line.unit,
          orderedQty: ordered,
          unitPrice: price,
          vat: lineVat,
          poAmount: poAmt,
          receivedQty: received,
          acceptedQty: accepted,
          payableAmount: payableAmt,
          status: matchStatus
        });
      }
    }
    return list;
  }, [data.orders, data.suppliers]);

  // Tổng hợp chỉ số Kế toán
  const totalPoCommitted = matchingLines.reduce((sum, item) => sum + item.poAmount, 0);
  const totalPayableApproved = matchingLines.reduce((sum, item) => sum + item.payableAmount, 0);
  const fullyMatchedCount = matchingLines.filter(m => m.status === 'MATCHED').length;
  const matchRate = matchingLines.length ? Math.round((fullyMatchedCount / matchingLines.length) * 100) : 100;

  // 3. Tổng hợp Công nợ & Chi tiêu Kế toán theo Nhà cung cấp
  const supplierLedger = useMemo(() => {
    const map = new Map<string, {
      supplierId: string;
      name: string;
      reputation: number;
      orderCount: number;
      committed: number;
      acceptedPayable: number;
      pendingDelivery: number;
    }>();

    for (const sup of data.suppliers) {
      map.set(sup.id, {
        supplierId: sup.id,
        name: sup.name,
        reputation: sup.reputation,
        orderCount: 0,
        committed: 0,
        acceptedPayable: 0,
        pendingDelivery: 0
      });
    }

    for (const item of matchingLines) {
      const rec = map.get(item.supplierId) || {
        supplierId: item.supplierId,
        name: item.supplierName,
        reputation: 80,
        orderCount: 0,
        committed: 0,
        acceptedPayable: 0,
        pendingDelivery: 0
      };
      rec.orderCount += 1;
      rec.committed += item.poAmount;
      rec.acceptedPayable += item.payableAmount;
      rec.pendingDelivery += Math.max(0, item.poAmount - item.payableAmount);
      map.set(item.supplierId, rec);
    }

    return Array.from(map.values()).filter(s => s.committed > 0);
  }, [data.suppliers, matchingLines]);

  // Dữ liệu chi tiêu hàng tháng từ dashboard
  const monthlySpendData = useMemo(() => {
    return data.dashboard.monthlySpend
      .filter(m => m.value !== null)
      .map(m => ({
        month: m.month,
        spend: m.value || 0,
        history: m.historyValue || 0,
        orders: m.orderValue || 0
      }));
  }, [data.dashboard.monthlySpend]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    message.success(`Đã sao chép ${label}: ${text}`);
  };

  const exportMenu: MenuProps = {
    items: [
      {
        key: 'excel',
        icon: <FileExcelOutlined style={{ color: '#52c41a' }} />,
        label: 'Xuất Báo cáo Kiểm toán & Sổ cái Kế toán (Excel)',
        onClick: () => download('excel')
      },
      {
        key: 'pdf',
        icon: <FilePdfOutlined style={{ color: '#f5222d' }} />,
        label: 'Xuất Biên bản Đối chiếu Kế toán (PDF Document)',
        onClick: () => download('pdf')
      }
    ]
  };

  const renderChanges = (changes?: Record<string, { before: unknown; after: unknown }>) => {
    if (!changes || !Object.keys(changes).length) return null;
    const entries = Object.entries(changes);

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <Text strong style={{ fontSize: 14 }}>
            Bảng Đối chiếu Dữ liệu Trước & Sau (Data Diff):
          </Text>
        </div>
        <Table
          size="small"
          bordered
          pagination={false}
          dataSource={entries.map(([field, diff]) => ({
            key: field,
            field,
            before: typeof diff.before === 'object' ? JSON.stringify(diff.before) : String(diff.before ?? '—'),
            after: typeof diff.after === 'object' ? JSON.stringify(diff.after) : String(diff.after ?? '—'),
          }))}
          columns={[
            {
              title: 'Trường thay đổi',
              dataIndex: 'field',
              width: 160,
              render: f => <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{f}</Tag>
            },
            {
              title: 'Giá trị Trước khi sửa (Cũ)',
              dataIndex: 'before',
              render: v => (
                <span 
                  style={{ 
                    color: '#cf1322', 
                    background: '#fff1f0', 
                    padding: '3px 8px', 
                    borderRadius: 4, 
                    display: 'inline-block',
                    textDecoration: 'line-through',
                    fontFamily: 'monospace'
                  }}
                >
                  {v}
                </span>
              )
            },
            {
              title: 'Giá trị Sau khi sửa (Mới)',
              dataIndex: 'after',
              render: v => (
                <span 
                  style={{ 
                    color: '#389e0d', 
                    background: '#f6ffed', 
                    padding: '3px 8px', 
                    borderRadius: 4, 
                    fontWeight: 600,
                    display: 'inline-block',
                    fontFamily: 'monospace'
                  }}
                >
                  {v}
                </span>
              )
            },
          ]}
        />
      </div>
    );
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Executive Header Banner */}
      <div 
        style={{ 
          background: 'linear-gradient(135deg, #092b3f 0%, #11425b 50%, #0c3348 100%)', 
          borderRadius: 16, 
          padding: '24px 28px', 
          marginBottom: 24, 
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(9, 43, 63, 0.15)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} md={16}>
            <Space align="center" style={{ marginBottom: 6 }}>
              <SafetyCertificateOutlined style={{ fontSize: 28, color: '#13c2c2' }} />
              <Title level={2} style={{ color: '#ffffff', margin: 0, fontWeight: 700, letterSpacing: '-0.5px' }}>
                Trung tâm Kiểm toán & Kế toán Mua sắm
              </Title>
              <Tag color="cyan" style={{ marginLeft: 8, borderRadius: 12, padding: '2px 10px', fontWeight: 600 }}>
                Audit & Financial Hub
              </Tag>
            </Space>
            <Paragraph style={{ color: 'rgba(255,255,255,0.85)', margin: 0, fontSize: 14, maxWidth: 850 }}>
              Hệ thống tích hợp kép: Giám sát toàn vẹn vết kiểm toán (Audit Trail) chống gian lận, đồng thời tự động hóa Đối chiếu 3 bên Kế toán (3-Way Matching PO ⟷ Kho ⟷ Hóa đơn) và Quản lý Công nợ Phải trả (AP).
            </Paragraph>
          </Col>
          <Col xs={24} md={8} style={{ textAlign: 'right' }}>
            <Space wrap>
              <Dropdown menu={exportMenu} placement="bottomRight">
                <Button 
                  type="primary" 
                  size="large"
                  loading={busy}
                  style={{ 
                    background: '#13c2c2', 
                    borderColor: '#13c2c2', 
                    fontWeight: 600, 
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(19, 194, 194, 0.35)'
                  }}
                  icon={<FileExcelOutlined />}
                >
                  Xuất Hồ sơ Kiểm toán <DownOutlined style={{ fontSize: 12 }} />
                </Button>
              </Dropdown>
              <Button 
                ghost 
                size="large"
                style={{ borderRadius: 8, borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff' }}
                icon={<LineChartOutlined />}
                onClick={() => setShowChart(!showChart)}
              >
                {showChart ? 'Ẩn Biểu đồ' : 'Xem Biểu đồ'}
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* 4 Thẻ KPI Kiểm toán & Kế toán Cao cấp (Audit & Accounting KPI Cards) */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* KPI 1: Kiểm toán - Tuân thủ quy trình */}
        <Col xs={24} sm={12} lg={6}>
          <Card 
            size="small" 
            style={{ 
              borderRadius: 12, 
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Chỉ số Tuân thủ Kiểm toán</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: complianceScore >= 95 ? '#059669' : '#d97706', marginTop: 4 }}>
                  {complianceScore}%
                </div>
              </div>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 10, 
                  background: '#ecfdf5', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <SafetyCertificateOutlined style={{ fontSize: 20, color: '#059669' }} />
              </div>
            </div>
            <Progress 
              percent={complianceScore} 
              showInfo={false} 
              strokeColor={complianceScore >= 95 ? '#10b981' : '#f59e0b'}
              size="small" 
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              {selfApprovedCount === 0 ? '✓ Không có xung đột lợi ích (0 tự duyệt)' : `⚠ Phát hiện ${selfApprovedCount} vụ tự duyệt đơn`}
            </div>
          </Card>
        </Col>

        {/* KPI 2: Kế toán - Tỷ lệ Đối chiếu 3 bên khớp */}
        <Col xs={24} sm={12} lg={6}>
          <Card 
            size="small" 
            style={{ 
              borderRadius: 12, 
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Đối chiếu 3 bên (3-Way Matching)</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#2563eb', marginTop: 4 }}>
                  {matchRate}% <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>({fullyMatchedCount}/{matchingLines.length} dòng)</span>
                </div>
              </div>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 10, 
                  background: '#eff6ff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <CheckCircleOutlined style={{ fontSize: 20, color: '#2563eb' }} />
              </div>
            </div>
            <Progress 
              percent={matchRate} 
              showInfo={false} 
              strokeColor="#2563eb"
              size="small" 
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              Khớp chuẩn giữa Đơn PO ⟷ Kho ⟷ Hóa đơn
            </div>
          </Card>
        </Col>

        {/* KPI 3: Kế toán - Giá trị Đủ điều kiện thanh toán */}
        <Col xs={24} sm={12} lg={6}>
          <Card 
            size="small" 
            style={{ 
              borderRadius: 12, 
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Công nợ Đủ ĐK Thanh toán (AP)</Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>
                  {money(totalPayableApproved)}
                </div>
              </div>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 10, 
                  background: '#f0fdf4', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <DollarOutlined style={{ fontSize: 20, color: '#16a34a' }} />
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              Cam kết PO: <strong style={{ color: '#1e293b' }}>{money(totalPoCommitted)}</strong>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
              ✓ Đã nghiệm thu chất lượng đạt chuẩn
            </div>
          </Card>
        </Col>

        {/* KPI 4: Kiểm toán - Giám sát Vết & AI */}
        <Col xs={24} sm={12} lg={6}>
          <Card 
            size="small" 
            style={{ 
              borderRadius: 12, 
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Vết Kiểm toán & AI Agent</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed', marginTop: 4 }}>
                  {totalApprovals + agentRunCount} <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>sự kiện</span>
                </div>
              </div>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 10, 
                  background: '#f5f3ff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <RobotOutlined style={{ fontSize: 20, color: '#7c3aed' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <Tag color="purple" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{agentRunCount} lượt AI</Tag>
              <Tag color="blue" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{totalApprovals} lần duyệt</Tag>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              Lưu vết bất biến chống chối bỏ
            </div>
          </Card>
        </Col>
      </Row>

      {/* Biểu đồ Trực quan hóa Kế toán & Kiểm toán */}
      {showChart && (
        <Card 
          size="small" 
          style={{ 
            borderRadius: 12, 
            marginBottom: 24, 
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
          }}
          title={
            <Space>
              <LineChartOutlined style={{ color: '#13c2c2' }} />
              <span style={{ fontWeight: 600 }}>Biểu đồ Kế toán: Dòng tiền Chi tiêu Ngân sách & Hoạt động Kiểm toán theo Tháng</span>
            </Space>
          }
        >
          <Row gutter={[24, 16]} align="middle">
            <Col xs={24} lg={16}>
              <div style={{ height: 210, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlySpendData.length ? monthlySpendData : [{ month: '10/2026', spend: totalPoCommitted, history: 0, orders: totalPoCommitted }]} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickFormatter={val => `${Math.round(val / 1e6)} tr`} />
                    <ChartTooltip 
                      contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(val: any) => [money(Number(val)), 'Chi tiêu thanh toán']}
                    />
                    <Bar dataKey="spend" fill="#13c2c2" radius={[6, 6, 0, 0]} name="Tổng chi tiêu" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col xs={24} lg={8}>
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #edf2f7' }}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>
                  Chỉ số Phân bổ Tài chính Kế toán:
                </Text>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>Đã nghiệm thu (Được thanh toán)</span>
                    <span style={{ fontWeight: 600 }}>{money(totalPayableApproved)}</span>
                  </div>
                  <Progress percent={totalPoCommitted ? Math.round((totalPayableApproved / totalPoCommitted) * 100) : 100} strokeColor="#16a34a" size="small" showInfo={false} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#d97706', fontWeight: 600 }}>Đang chờ giao & nghiệm thu</span>
                    <span style={{ fontWeight: 600 }}>{money(Math.max(0, totalPoCommitted - totalPayableApproved))}</span>
                  </div>
                  <Progress percent={totalPoCommitted ? Math.round((Math.max(0, totalPoCommitted - totalPayableApproved) / totalPoCommitted) * 100) : 0} strokeColor="#d97706" size="small" showInfo={false} />
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
                  * Kế toán thanh toán chỉ giải ngân khi biên bản 3-Way Matching khớp 100%.
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* Thanh 4 Tab Nghiệp Vụ Kiểm Toán & Kế Toán Chuyên Sâu */}
      <Tabs
        activeKey={tab}
        onChange={k => setTab(k as any)}
        type="card"
        style={{ marginBottom: 16 }}
        items={[
          // TAB 1: KIỂM TOÁN VẾT HÀNH VI
          {
            key: 'events',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <SafetyCertificateOutlined style={{ color: '#13c2c2', marginRight: 6 }} />
                1. Nhật ký Kiểm toán & Vết hành vi (Audit Trail)
              </span>
            ),
            children: (
              <Card 
                bodyStyle={{ padding: 16 }} 
                style={{ 
                  borderRadius: 12, 
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                <PagedTable<Audit>
                  path="/audit"
                  params={{ 
                    entityType, 
                    from: from || undefined, 
                    to: to || undefined
                  }}
                  searchPlaceholder="Tìm theo người thực hiện, hành động, mã đối tượng..."
                  filters={
                    <Space wrap size="middle">
                      <Radio.Group 
                        value={actorFilter} 
                        onChange={e => setActorFilter(e.target.value)}
                        buttonStyle="solid"
                        size="middle"
                      >
                        <Radio.Button value="all">Tất cả</Radio.Button>
                        <Radio.Button value="agent">
                          <RobotOutlined style={{ marginRight: 4 }} /> Chỉ AI Agent
                        </Radio.Button>
                        <Radio.Button value="user">
                          <UserOutlined style={{ marginRight: 4 }} /> Người dùng
                        </Radio.Button>
                      </Radio.Group>

                      <Select
                        aria-label="Loại đối tượng"
                        allowClear
                        placeholder="Mọi module nghiệp vụ"
                        value={entityType}
                        onChange={setEntityType}
                        options={Object.entries(entityMeta).map(([value, meta]) => ({ 
                          value, 
                          label: (
                            <span>
                              {meta.icon} <span style={{ marginLeft: 6 }}>{meta.label}</span>
                            </span>
                          ) 
                        }))}
                        style={{ minWidth: 210 }}
                      />

                      <Space>
                        <Input
                          aria-label="Từ ngày"
                          type="date"
                          value={from}
                          max={to || undefined}
                          onChange={e => setFrom(e.target.value)}
                          style={{ width: 140 }}
                        />
                        <span style={{ color: '#94a3b8' }}>➔</span>
                        <Input
                          aria-label="Đến ngày"
                          type="date"
                          value={to}
                          min={from || undefined}
                          onChange={e => setTo(e.target.value)}
                          style={{ width: 140 }}
                        />
                      </Space>
                    </Space>
                  }
                  columns={[
                    {
                      title: 'Thời điểm',
                      dataIndex: 'createdAt',
                      width: 165,
                      render: t => (
                        <div style={{ lineHeight: 1.3 }}>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{date(t)}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {new Date(t).toLocaleTimeString('vi-VN')}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Tác nhân thực hiện',
                      width: 220,
                      render: (_, a) => {
                        const isAgent = a.actorId === 'agent' || a.actor === 'agent' || a.role === 'agent';
                        return isAgent ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div 
                              style={{ 
                                width: 32, 
                                height: 32, 
                                borderRadius: '50%', 
                                background: '#f5f3ff', 
                                border: '1px solid #ddd6fe',
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center' 
                              }}
                            >
                              <RobotOutlined style={{ color: '#7c3aed', fontSize: 16 }} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: '#5b21b6' }}>AI Agent Copilot</div>
                              <Tag color="purple" style={{ fontSize: 10, margin: 0, padding: '0 4px', borderRadius: 4 }}>
                                Tự hành
                              </Tag>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div 
                              style={{ 
                                width: 32, 
                                height: 32, 
                                borderRadius: '50%', 
                                background: '#eff6ff', 
                                border: '1px solid #bfdbfe',
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center' 
                              }}
                            >
                              <UserOutlined style={{ color: '#2563eb', fontSize: 15 }} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>
                                {a.actorName || shortId(a.actorId)}
                              </div>
                              {a.role && (
                                <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px', borderRadius: 4 }}>
                                  {a.role === 'admin' ? 'Quản trị viên' : a.role === 'buyer' ? 'Mua hàng' : a.role === 'manager' ? 'Quản lý' : a.role}
                                </Tag>
                              )}
                            </div>
                          </div>
                        );
                      },
                    },
                    {
                      title: 'Nghiệp vụ / Hành động',
                      dataIndex: 'action',
                      width: 240,
                      render: act => {
                        const item = actionDictionary[act];
                        if (item) {
                          return (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>
                                {item.label}
                              </div>
                              <Tag 
                                style={{ 
                                  color: item.color, 
                                  borderColor: item.color, 
                                  background: 'transparent',
                                  fontSize: 11, 
                                  margin: '2px 0 0 0',
                                  borderRadius: 4 
                                }}
                              >
                                {item.badge}
                              </Tag>
                            </div>
                          );
                        }
                        return <Tag>{act}</Tag>;
                      },
                    },
                    {
                      title: 'Đối tượng giám sát',
                      dataIndex: 'entityType',
                      width: 170,
                      render: v => {
                        const meta = entityMeta[v];
                        if (meta) {
                          return (
                            <Tag 
                              color={meta.color} 
                              icon={meta.icon}
                              style={{ borderRadius: 6, padding: '2px 8px', fontSize: 12 }}
                            >
                              {meta.label}
                            </Tag>
                          );
                        }
                        return v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>;
                      },
                    },
                    {
                      title: 'Mã tham chiếu',
                      dataIndex: 'entityId',
                      width: 140,
                      render: id => (
                        id ? (
                          <Space size={4}>
                            <Tag 
                              style={{ 
                                fontFamily: 'monospace', 
                                fontWeight: 600, 
                                color: '#475569',
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                borderRadius: 4
                              }}
                            >
                              #{shortId(id)}
                            </Tag>
                            <Tooltip title="Sao chép mã đối tượng">
                              <Button 
                                type="text" 
                                size="small" 
                                icon={<CopyOutlined style={{ fontSize: 11, color: '#94a3b8' }} />}
                                onClick={() => copyToClipboard(id, 'mã đối tượng')}
                              />
                            </Tooltip>
                          </Space>
                        ) : <Text type="secondary">—</Text>
                      ),
                    },
                    {
                      title: 'Đặc tính rủi ro',
                      width: 170,
                      render: (_, a) => {
                        const d = a.detail as any;
                        const hasSelf = d?.selfApproved === true;
                        const hasDiff = d?.changes && Object.keys(d.changes).length > 0;
                        const isSensitive = actionDictionary[a.action]?.isSensitive;
                        const isAgent = a.actorId === 'agent' || a.actor === 'agent';

                        if (hasSelf) {
                          return (
                            <Tooltip title="Người tạo yêu cầu và người duyệt là một (Xung đột lợi ích)">
                              <Tag 
                                color="error" 
                                icon={<WarningOutlined />}
                                style={{ fontWeight: 600, borderRadius: 6, padding: '2px 8px' }}
                              >
                                Tự duyệt đơn
                              </Tag>
                            </Tooltip>
                          );
                        }
                        if (isSensitive || hasDiff) {
                          return (
                            <Tag 
                              color="warning" 
                              style={{ borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}
                            >
                              Biến động dữ liệu
                            </Tag>
                          );
                        }
                        if (isAgent) {
                          return (
                            <Tag 
                              color="purple" 
                              style={{ borderRadius: 6, padding: '2px 8px' }}
                            >
                              AI tự động
                            </Tag>
                          );
                        }
                        return (
                          <Tag 
                            color="success" 
                            style={{ borderRadius: 6, padding: '2px 8px' }}
                          >
                            Chuẩn quy trình
                          </Tag>
                        );
                      },
                    },
                    {
                      title: 'Soát xét',
                      width: 110,
                      fixed: 'right',
                      render: (_, a) => (
                        <Button 
                          type="primary" 
                          size="small"
                          ghost
                          icon={<EyeOutlined />}
                          onClick={() => setSelected(a)}
                          style={{ borderRadius: 6, fontWeight: 500 }}
                        >
                          Chi tiết
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },

          // TAB 2: ĐỐI CHIẾU 3 BÊN KẾ TOÁN (3-WAY MATCHING)
          {
            key: 'matching',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <AccountBookOutlined style={{ color: '#2563eb', marginRight: 6 }} />
                2. Đối chiếu 3 bên Kế toán (3-Way Matching PO ⟷ Kho ⟷ Hóa đơn)
              </span>
            ),
            children: (
              <Card 
                bodyStyle={{ padding: 16 }} 
                style={{ 
                  borderRadius: 12, 
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Title level={4} style={{ margin: 0 }}>Bảng Đối soát Kế toán Mua sắm (Accounts Payable 3-Way Matching)</Title>
                    <Text type="secondary">
                      Đối chiếu tự động giữa (1) Hợp đồng Đơn mua PO, (2) Phiếu Nhập kho & Nghiệm thu chất lượng, và (3) Hóa đơn thanh toán NCC.
                    </Text>
                  </div>
                  <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px', borderRadius: 6, fontWeight: 600 }}>
                    Tỷ lệ khớp chuẩn: {matchRate}%
                  </Tag>
                </div>

                <Table
                  dataSource={matchingLines}
                  rowKey="lineId"
                  pagination={{ pageSize: 8 }}
                  columns={[
                    {
                      title: 'Chứng từ PO',
                      width: 140,
                      render: (_, item) => (
                        <div>
                          <strong style={{ color: '#2563eb' }}>PO #{shortId(item.orderId)}</strong>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{date(item.orderCreatedAt)}</div>
                          <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{item.supplierName}</div>
                        </div>
                      )
                    },
                    {
                      title: 'Mặt hàng vật tư',
                      render: (_, item) => (
                        <div>
                          <strong style={{ fontSize: 13 }}>{item.productName}</strong>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            SKU: <span style={{ fontFamily: 'monospace' }}>{item.sku}</span> | ĐVT: {item.unit}
                          </div>
                        </div>
                      )
                    },
                    {
                      title: '1. Đặt mua (PO)',
                      width: 130,
                      render: (_, item) => (
                        <div style={{ fontSize: 12 }}>
                          <div>Số lượng: <strong>{number(item.orderedQty)}</strong> {item.unit}</div>
                          <div style={{ color: '#64748b' }}>Đơn giá: {money(item.unitPrice)}</div>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>Tổng: {money(item.poAmount)}</div>
                        </div>
                      )
                    },
                    {
                      title: '2. Nhập kho & Kiểm định',
                      width: 160,
                      render: (_, item) => (
                        <div style={{ fontSize: 12 }}>
                          <div>Thực nhận: <strong>{number(item.receivedQty)}</strong> {item.unit}</div>
                          <div>
                            Đạt chuẩn: <strong style={{ color: '#16a34a' }}>{number(item.acceptedQty)}</strong> {item.unit}
                          </div>
                          {item.receivedQty > item.acceptedQty && (
                            <div style={{ color: '#dc2626', fontWeight: 600, fontSize: 11 }}>
                              ⚠ Loại bỏ: {item.receivedQty - item.acceptedQty} {item.unit}
                            </div>
                          )}
                        </div>
                      )
                    },
                    {
                      title: '3. Kết quả Đối soát',
                      width: 160,
                      render: (_, item) => {
                        switch (item.status) {
                          case 'MATCHED':
                            return (
                              <Tag color="success" icon={<CheckCircleOutlined />} style={{ borderRadius: 6, fontWeight: 600, padding: '3px 8px' }}>
                                Khớp hoàn hảo 100%
                              </Tag>
                            );
                          case 'PARTIAL':
                            return (
                              <Tag color="warning" icon={<ClockCircleOutlined />} style={{ borderRadius: 6, fontWeight: 600, padding: '3px 8px' }}>
                                Giao nhận một phần
                              </Tag>
                            );
                          case 'DEFECT':
                            return (
                              <Tag color="error" icon={<CloseCircleOutlined />} style={{ borderRadius: 6, fontWeight: 600, padding: '3px 8px' }}>
                                Có hàng lỗi / Lệch chuẩn
                              </Tag>
                            );
                          case 'AWAITING':
                          default:
                            return (
                              <Tag color="default" style={{ borderRadius: 6, padding: '3px 8px' }}>
                                Đang chờ giao hàng
                              </Tag>
                            );
                        }
                      }
                    },
                    {
                      title: 'Giá trị Đủ ĐK Thanh toán',
                      width: 170,
                      render: (_, item) => (
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: item.payableAmount > 0 ? '#16a34a' : '#94a3b8' }}>
                            {money(item.payableAmount)}
                          </div>
                          {item.status === 'MATCHED' ? (
                            <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Cho phép giải ngân</span>
                          ) : item.status === 'DEFECT' ? (
                            <span style={{ fontSize: 11, color: '#dc2626' }}>⛔ Treo thanh toán lỗi</span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>Chờ nhập kho đủ</span>
                          )}
                        </div>
                      )
                    }
                  ]}
                />
              </Card>
            ),
          },

          // TAB 3: SỔ CÁI TÀI CHÍNH & CÔNG NỢ NCC (AP SPEND LEDGER)
          {
            key: 'financial',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <DollarOutlined style={{ color: '#16a34a', marginRight: 6 }} />
                3. Sổ cái Tài chính & Công nợ NCC (AP Ledger)
              </span>
            ),
            children: (
              <Card 
                bodyStyle={{ padding: 16 }} 
                style={{ 
                  borderRadius: 12, 
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  <Title level={4} style={{ margin: 0 }}>Sổ Kế toán Công nợ Phải trả theo Nhà cung cấp</Title>
                  <Text type="secondary">
                    Theo dõi nghĩa vụ thanh toán, giá trị đã nghiệm thu, và phân tích công nợ tồn đọng.
                  </Text>
                </div>

                <Table
                  dataSource={supplierLedger}
                  rowKey="supplierId"
                  pagination={false}
                  columns={[
                    {
                      title: 'Nhà cung cấp',
                      render: (_, s) => (
                        <div>
                          <strong style={{ fontSize: 14 }}>{s.name}</strong>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            Điểm uy tín: <Tag color="blue">{s.reputation}/100</Tag>
                          </div>
                        </div>
                      )
                    },
                    {
                      title: 'Số đơn PO phát sinh',
                      dataIndex: 'orderCount',
                      width: 140,
                      render: c => <strong>{c} đơn hàng</strong>
                    },
                    {
                      title: 'Tổng Giá trị Cam kết (PO)',
                      dataIndex: 'committed',
                      width: 180,
                      render: val => <span style={{ fontWeight: 600 }}>{money(val)}</span>
                    },
                    {
                      title: 'Đã nghiệm thu (Đủ ĐK Trả)',
                      dataIndex: 'acceptedPayable',
                      width: 190,
                      render: val => (
                        <span style={{ fontWeight: 700, color: '#16a34a' }}>
                          {money(val)}
                        </span>
                      )
                    },
                    {
                      title: 'Chờ giao & Nghiệm thu',
                      dataIndex: 'pendingDelivery',
                      width: 190,
                      render: val => (
                        <span style={{ fontWeight: 600, color: '#d97706' }}>
                          {money(val)}
                        </span>
                      )
                    },
                    {
                      title: 'Tiến độ Thanh toán',
                      render: (_, s) => {
                        const pct = s.committed ? Math.round((s.acceptedPayable / s.committed) * 100) : 0;
                        return (
                          <div style={{ width: 140 }}>
                            <Progress percent={pct} size="small" strokeColor="#16a34a" />
                          </div>
                        );
                      }
                    }
                  ]}
                />
              </Card>
            ),
          },

          // TAB 4: SỔ CÁI KHO & DÒNG TIỀN HÀNG (STOCK LEDGER)
          {
            key: 'movements',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <InboxOutlined style={{ color: '#10b981', marginRight: 6 }} />
                4. Sổ cái Kho & Dòng tiền hàng (Stock Ledger)
              </span>
            ),
            children: (
              <Card 
                bodyStyle={{ padding: 16 }} 
                style={{ 
                  borderRadius: 12, 
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                <PagedTable<Movement>
                  path="/inventory/movements"
                  params={{ kind: movementKind }}
                  searchPlaceholder="Tìm theo mã SKU, tên hàng hóa, nhà cung cấp, thủ kho..."
                  filters={
                    <Select
                      aria-label="Loại biến động"
                      allowClear
                      placeholder="Mọi biến động kho"
                      value={movementKind}
                      onChange={setMovementKind}
                      options={[
                        { value: 'RECEIPT', label: '📥 Nhập kho theo Đơn mua (PO)' },
                        { value: 'OPENING', label: '📋 Số dư tồn kho đầu kỳ' },
                      ]}
                      style={{ minWidth: 240 }}
                    />
                  }
                  columns={[
                    {
                      title: 'Thời điểm',
                      dataIndex: 'createdAt',
                      width: 170,
                      render: t => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{date(t)}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {new Date(t).toLocaleTimeString('vi-VN')}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Mặt hàng & Mã SKU',
                      render: (_, m) => (
                        <div>
                          <strong style={{ fontSize: 14, color: '#1e293b' }}>{m.productName}</strong>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: 2 }}>
                            Mã SKU: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{m.sku}</span> | Đơn vị: {m.unit}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Loại nghiệp vụ',
                      dataIndex: 'kind',
                      width: 180,
                      render: k =>
                        k === 'RECEIPT' ? (
                          <Tag color="green" icon={<InboxOutlined />} style={{ borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                            Nhập từ Đơn PO
                          </Tag>
                        ) : (
                          <Tag color="default" style={{ borderRadius: 6, padding: '2px 8px' }}>
                            Số dư đầu kỳ
                          </Tag>
                        ),
                    },
                    {
                      title: 'Biến động (+/-)',
                      dataIndex: 'delta',
                      width: 140,
                      render: (d, m) => (
                        <div 
                          style={{ 
                            fontWeight: 700, 
                            fontSize: 14,
                            color: d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#64748b' 
                          }}
                        >
                          {d > 0 ? `+${d}` : d} {m.unit}
                        </div>
                      ),
                    },
                    {
                      title: 'Tồn sau biến động',
                      dataIndex: 'balanceAfter',
                      width: 150,
                      render: (b, m) => (
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>
                          {b} <span style={{ fontSize: 12, color: '#64748b' }}>{m.unit}</span>
                        </div>
                      ),
                    },
                    {
                      title: 'Chứng từ / Đối tác',
                      render: (_, m) => (
                        <div>
                          {m.supplierName && (
                            <div style={{ fontWeight: 500, color: '#334155' }}>
                              NCC: {m.supplierName}
                            </div>
                          )}
                          {m.receiptId && (
                            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                              Phiếu: #{shortId(m.receiptId)}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    {
                      title: 'Người xác nhận',
                      dataIndex: 'actorName',
                      width: 160,
                      render: n => (
                        <Space>
                          <UserOutlined style={{ color: '#2563eb' }} />
                          <span style={{ fontWeight: 500 }}>{n}</span>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* Drawer Soát xét Hồ sơ Kiểm toán Chuyên Sâu */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SafetyCertificateOutlined style={{ color: '#13c2c2', fontSize: 20 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Hồ Sơ Soát Xét Kiểm Toán Chi Tiết</div>
              {selected && (
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>
                  Mã sự kiện: #{selected.id} • Lúc {date(selected.createdAt)}
                </div>
              )}
            </div>
          </div>
        }
        open={!!selected}
        onClose={() => setSelected(null)}
        width={680}
        styles={{ body: { padding: 24 } }}
        extra={
          selected && (
            <Button 
              icon={<CopyOutlined />} 
              onClick={() => copyToClipboard(JSON.stringify(selected, null, 2), 'chứng thư kiểm toán')}
            >
              Sao chép JSON
            </Button>
          )
        }
      >
        {selected && (
          <div>
            {(selected.detail as any)?.selfApproved && (
              <Alert
                type="error"
                showIcon
                message="CẢNH BÁO XUNG ĐỘT LỢI ÍCH (SELF-APPROVAL DETECTED)"
                description="Người tạo đề xuất mua hàng và người phê duyệt là cùng một nhân sự. Hành vi này có thể vi phạm nguyên tắc kiểm soát chéo nội bộ."
                style={{ marginBottom: 20, borderRadius: 8, border: '1px solid #f87171' }}
              />
            )}

            <Card size="small" style={{ borderRadius: 10, marginBottom: 16, background: '#f8fafc' }}>
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Tác nhân thực hiện:</Text>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selected.actorId === 'agent' ? <RobotOutlined style={{ color: '#7c3aed' }} /> : <UserOutlined style={{ color: '#2563eb' }} />}
                    {selected.actorName || shortId(selected.actorId)}
                    {selected.role && <Tag color="blue">{selected.role}</Tag>}
                  </div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Hành vi nghiệp vụ:</Text>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>
                    {actionDictionary[selected.action]?.label || selected.action}
                  </div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Đối tượng tác động:</Text>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>
                    {entityMeta[selected.entityType || '']?.label || selected.entityType || '—'}
                  </div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Mã đối tượng gốc:</Text>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, marginTop: 2 }}>
                    {selected.entityId ? `#${selected.entityId}` : '—'}
                  </div>
                </Col>
              </Row>
            </Card>

            {(selected.detail as any)?.comment && (
              <div 
                style={{ 
                  background: '#f0fdf4', 
                  borderLeft: '4px solid #16a34a', 
                  padding: '12px 16px', 
                  borderRadius: '0 8px 8px 0',
                  marginBottom: 16 
                }}
              >
                <Text strong style={{ color: '#166534', display: 'block', marginBottom: 4 }}>
                  Ý kiến / Lý do ghi nhận:
                </Text>
                <Text style={{ color: '#15803d' }}>
                  {(selected.detail as any).comment}
                </Text>
              </div>
            )}

            {renderChanges((selected.detail as any)?.changes)}

            <Divider style={{ margin: '20px 0 16px 0' }} />
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                Payload Dữ liệu Thô (Audit Proof Payload):
              </Text>
              <pre 
                style={{ 
                  background: '#0f172a', 
                  color: '#e2e8f0', 
                  padding: 16, 
                  borderRadius: 8, 
                  fontSize: 12, 
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  maxHeight: 260
                }}
              >
                {JSON.stringify(selected, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
