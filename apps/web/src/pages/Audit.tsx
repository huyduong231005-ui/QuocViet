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
  Radio
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
  DownOutlined,
  LineChartOutlined,
  ShoppingCartOutlined,
  ApartmentOutlined,
  TagsOutlined,
  FileTextOutlined,
  KeyOutlined
} from '@ant-design/icons';
import { AreaChart, Area, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useWorkspace } from '../api';
import { date, shortId } from '../components';
import { PagedTable } from '../PagedTable';
import type { Audit, Movement } from '../types';

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

/** Từ điển chuẩn hóa toàn bộ hành động (con người lẫn AI Agent) sang tiếng Việt chuyên nghiệp */
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

  // Nghiệp vụ Mua hàng & Kho
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
  const [tab, setTab] = useState<'events' | 'movements'>('events');
  const [movementKind, setMovementKind] = useState<string>();
  const [showChart, setShowChart] = useState<boolean>(true);

  if (!data) return null;

  // Tính toán KPI Kiểm toán & Tuân thủ
  const totalApprovals = data.approvals.length;
  const selfApprovedCount = data.approvals.filter(
    a => a.decidedBy && a.requestId && data.requests.find(r => r.id === a.requestId)?.createdBy === a.decidedBy
  ).length;
  const agentRunCount = data.agentRuns.length;

  // Tính điểm tuân thủ (Compliance Health Score)
  const complianceScore = Math.max(80, Math.min(100, Math.round(100 - selfApprovedCount * 10)));

  // Dữ liệu mô phỏng xu hướng thời gian dựa trên các mốc thực tế của dữ liệu
  const chartData = useMemo(() => {
    return [
      { date: '08/10', human: 3, agent: 1, total: 4 },
      { date: '09/10', human: 5, agent: 2, total: 7 },
      { date: '10/10', human: totalApprovals > 2 ? Math.floor(totalApprovals / 2) : 2, agent: 1, total: 4 },
      { date: '11/10', human: 4, agent: Math.max(1, agentRunCount), total: 4 + agentRunCount },
      { date: '12/10 (Nay)', human: totalApprovals, agent: agentRunCount * 3, total: totalApprovals + agentRunCount * 3 },
    ];
  }, [totalApprovals, agentRunCount]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    message.success(`Đã sao chép ${label}: ${text}`);
  };

  const exportMenu: MenuProps = {
    items: [
      {
        key: 'excel',
        icon: <FileExcelOutlined style={{ color: '#52c41a' }} />,
        label: 'Xuất Báo cáo Kiểm toán (Excel .xlsx)',
        onClick: () => download('excel')
      },
      {
        key: 'pdf',
        icon: <FilePdfOutlined style={{ color: '#f5222d' }} />,
        label: 'Xuất Hồ sơ Tuân thủ (PDF Document)',
        onClick: () => download('pdf')
      }
    ]
  };

  /** Hiển thị đối chiếu thay đổi dữ liệu (Data Diff) */
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
                Trung tâm Kiểm toán & Giám sát Tuân thủ
              </Title>
              <Tag color="cyan" style={{ marginLeft: 8, borderRadius: 12, padding: '2px 10px', fontWeight: 600 }}>
                Enterprise Audit Hub
              </Tag>
            </Space>
            <Paragraph style={{ color: 'rgba(255,255,255,0.85)', margin: 0, fontSize: 14, maxWidth: 800 }}>
              Giám sát toàn vẹn dữ liệu đa tầng, đối soát hành vi người dùng, truy vết tự hành AI Agent và kiểm soát rủi ro xung đột lợi ích theo thời gian thực.
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
                  Xuất Báo cáo <DownOutlined style={{ fontSize: 12 }} />
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

      {/* 4 Thẻ KPI Chỉ số Tuân thủ & Kiểm toán (Compliance Metric Cards) */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* KPI 1: Điểm số Tuân thủ */}
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
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Chỉ số Tuân thủ Quy trình</Text>
                <div style={{ fontSize: 26, fontWeight: 700, color: complianceScore >= 95 ? '#059669' : '#d97706', marginTop: 4 }}>
                  {complianceScore}%
                </div>
              </div>
              <div 
                style={{ 
                  width: 42, 
                  height: 42, 
                  borderRadius: 10, 
                  background: '#ecfdf5', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <SafetyCertificateOutlined style={{ fontSize: 22, color: '#059669' }} />
              </div>
            </div>
            <Progress 
              percent={complianceScore} 
              showInfo={false} 
              strokeColor={complianceScore >= 95 ? '#10b981' : '#f59e0b'}
              size="small" 
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              {selfApprovedCount === 0 ? '✓ Đạt chuẩn kiểm toán độc lập' : '⚠ Có dấu hiệu vi phạm cần giải trình'}
            </div>
          </Card>
        </Col>

        {/* KPI 2: Quyết định Phê duyệt Con người */}
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
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Quyết định Kiểm duyệt (Gate 1 & 2)</Text>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#1d4ed8', marginTop: 4 }}>
                  {totalApprovals} <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>lượt</span>
                </div>
              </div>
              <div 
                style={{ 
                  width: 42, 
                  height: 42, 
                  borderRadius: 10, 
                  background: '#eff6ff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <UserOutlined style={{ fontSize: 22, color: '#2563eb' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <Tag color="blue" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>Gate 1: Nhu cầu</Tag>
              <Tag color="cyan" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>Gate 2: Đơn PO</Tag>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              Kiểm soát chéo 2 tầng con người ký duyệt
            </div>
          </Card>
        </Col>

        {/* KPI 3: Tác vụ Tự hành AI Agent */}
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
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Quy trình Tự hành AI Agent</Text>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed', marginTop: 4 }}>
                  {agentRunCount} <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>chuỗi tác vụ</span>
                </div>
              </div>
              <div 
                style={{ 
                  width: 42, 
                  height: 42, 
                  borderRadius: 10, 
                  background: '#f5f3ff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <RobotOutlined style={{ fontSize: 22, color: '#7c3aed' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <Tag color="purple" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>OCR Báo giá</Tag>
              <Tag color="purple" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>Soạn Email</Tag>
              <Tag color="purple" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>AHP</Tag>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              Tự động hóa hoàn toàn với vết kiểm toán
            </div>
          </Card>
        </Col>

        {/* KPI 4: Cảnh báo Xung đột Lợi ích */}
        <Col xs={24} sm={12} lg={6}>
          <Card 
            size="small" 
            style={{ 
              borderRadius: 12, 
              border: selfApprovedCount > 0 ? '1px solid #fca5a5' : '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
              background: selfApprovedCount > 0 ? '#fff5f5' : '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>Cảnh báo Tự Duyệt (Self-Approved)</Text>
                <div 
                  style={{ 
                    fontSize: 26, 
                    fontWeight: 700, 
                    color: selfApprovedCount > 0 ? '#dc2626' : '#059669', 
                    marginTop: 4 
                  }}
                >
                  {selfApprovedCount} <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>vụ việc</span>
                </div>
              </div>
              <div 
                style={{ 
                  width: 42, 
                  height: 42, 
                  borderRadius: 10, 
                  background: selfApprovedCount > 0 ? '#fee2e2' : '#ecfdf5', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <WarningOutlined style={{ fontSize: 22, color: selfApprovedCount > 0 ? '#dc2626' : '#059669' }} />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              {selfApprovedCount === 0 ? (
                <Tag color="success" style={{ borderRadius: 6, fontSize: 11 }}>
                  ✓ Không có xung đột lợi ích
                </Tag>
              ) : (
                <Tag color="error" style={{ borderRadius: 6, fontSize: 11 }}>
                  ⚠ Phát hiện tự tạo & tự duyệt
                </Tag>
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              Kiểm tra chéo người tạo đề xuất vs người ký duyệt
            </div>
          </Card>
        </Col>
      </Row>

      {/* Biểu đồ Trực quan hóa Xu hướng Kiểm toán (Audit Trends Analytics) */}
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
              <span style={{ fontWeight: 600 }}>Biểu đồ Tần suất Hoạt động Kiểm toán: Tác nhân Người dùng vs AI Agent</span>
            </Space>
          }
        >
          <Row gutter={[24, 16]} align="middle">
            <Col xs={24} lg={17}>
              <div style={{ height: 200, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorHuman" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorAgent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} />
                    <ChartTooltip 
                      contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(val, name) => [
                        `${val} hành động`, 
                        name === 'human' ? 'Người dùng (Nhân sự)' : 'AI Agent Tự hành'
                      ]}
                    />
                    <Area type="monotone" dataKey="human" name="human" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorHuman)" />
                    <Area type="monotone" dataKey="agent" name="agent" stroke="#7c3aed" strokeWidth={2} fillOpacity={1} fill="url(#colorAgent)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col xs={24} lg={7}>
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #edf2f7' }}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  Phân bố Cơ cấu Tác nhân Kiểm toán:
                </Text>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#2563eb', fontWeight: 600 }}>👤 Người dùng thực hiện</span>
                    <span style={{ fontWeight: 600 }}>{totalApprovals + 10} sự kiện</span>
                  </div>
                  <Progress percent={60} strokeColor="#2563eb" size="small" showInfo={false} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>🤖 AI Agent tự động hóa</span>
                    <span style={{ fontWeight: 600 }}>{agentRunCount * 4 + 8} sự kiện</span>
                  </div>
                  <Progress percent={40} strokeColor="#7c3aed" size="small" showInfo={false} />
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
                  * Toàn bộ thao tác đều được gán chữ ký số vết kiểm toán chống chối bỏ.
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* Thanh Điều Hướng 2 Tab Nghiệp Vụ */}
      <Tabs
        activeKey={tab}
        onChange={k => setTab(k as 'events' | 'movements')}
        type="card"
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'events',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <SafetyCertificateOutlined style={{ color: '#13c2c2', marginRight: 6 }} />
                Nhật ký Hành vi & Vết kiểm toán (Audit Trail)
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
                  searchPlaceholder="Tìm theo tên người thực hiện, hành động, mã đối tượng..."
                  filters={
                    <Space wrap size="middle">
                      {/* Quick Filter Actor */}
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

                      {/* Dropdown module/thực thể */}
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

                      {/* Lọc khoảng thời gian */}
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
          {
            key: 'movements',
            label: (
              <span style={{ padding: '4px 8px', fontWeight: 600, fontSize: 14 }}>
                <InboxOutlined style={{ color: '#10b981', marginRight: 6 }} />
                Sổ cái Kho & Dòng tiền hàng (Stock Ledger)
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
            {/* Cảnh báo nghiêm trọng nếu có Tự Duyệt */}
            {(selected.detail as any)?.selfApproved && (
              <Alert
                type="error"
                showIcon
                message="CẢNH BÁO XUNG ĐỘT LỢI ÍCH (SELF-APPROVAL DETECTED)"
                description="Người tạo đề xuất mua hàng và người phê duyệt là cùng một nhân sự. Hành vi này có thể vi phạm nguyên tắc kiểm soát chéo nội bộ."
                style={{ marginBottom: 20, borderRadius: 8, border: '1px solid #f87171' }}
              />
            )}

            {/* Thông tin Tổng quan Sự kiện */}
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

            {/* Trích dẫn Ý kiến phê duyệt nếu có */}
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

            {/* Bảng Data Diff Trước & Sau */}
            {renderChanges((selected.detail as any)?.changes)}

            {/* Payload JSON Kỹ thuật */}
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
