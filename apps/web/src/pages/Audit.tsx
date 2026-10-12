import { useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Space, Table, Tabs, Tag, Typography, Card, Row, Col, Statistic, Tooltip } from 'antd';
import { 
  FileExcelOutlined, 
  FilePdfOutlined, 
  RobotOutlined, 
  UserOutlined, 
  WarningOutlined, 
  SafetyCertificateOutlined,
  HistoryOutlined,
  InboxOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';
import { useWorkspace } from '../api';
import { DetailText, DetailValue, PageTitle, date, number, shortId } from '../components';
import { PagedTable } from '../PagedTable';
import type { Audit, Movement } from '../types';

const { Text } = Typography;

const entityNames: Record<string, string> = {
  product: 'Mặt hàng',
  supplier: 'Nhà cung cấp',
  price: 'Giá tham khảo',
  request: 'Nhu cầu mua',
  approval: 'Phê duyệt',
  rfq: 'Yêu cầu báo giá (RFQ)',
  quotation: 'Báo giá',
  ahp_session: 'Phiên AHP',
  order: 'Đơn mua (PO)',
  receipt: 'Phiếu nhập kho',
  evaluations: 'Đánh giá NCC',
  evaluation: 'Đánh giá NCC',
  outbox: 'Gửi thư PO/RFQ',
  user: 'Tài khoản',
  agent_run: 'AI Agent'
};

const actionLabels: Record<string, { label: string; color: string; danger?: boolean }> = {
  'request': { label: 'Tạo nhu cầu', color: 'blue' },
  'requestApprove': { label: 'Duyệt nhu cầu (Gate 1)', color: 'green' },
  'decide': { label: 'Quyết định duyệt (Gate 2)', color: 'green' },
  'approval2': { label: 'Yêu cầu duyệt AHP', color: 'cyan' },
  'rfq': { label: 'Phát hành RFQ', color: 'purple' },
  'quotation': { label: 'Ghi nhận báo giá', color: 'geekblue' },
  'quotationUpdate': { label: 'Cập nhật báo giá', color: 'orange', danger: true },
  'ahp': { label: 'Tính toán AHP', color: 'cyan' },
  'order': { label: 'Lập đơn mua PO', color: 'magenta' },
  'send': { label: 'Gửi thư PO', color: 'blue' },
  'receipt': { label: 'Nhập kho', color: 'green' },
  'evaluation': { label: 'Đánh giá NCC', color: 'gold' },
  'catalog:prices:update': { label: 'Sửa giá tham khảo', color: 'volcano', danger: true },
  'catalog:prices:create': { label: 'Thêm giá tham khảo', color: 'blue' },
  'catalog:prices:delete': { label: 'Xóa giá tham khảo', color: 'red', danger: true },
  'accounts:update': { label: 'Sửa quyền tài khoản', color: 'volcano', danger: true },
  'accounts:create': { label: 'Tạo tài khoản mới', color: 'blue' },
  'startAgent': { label: 'Khởi động AI Agent', color: 'purple' },
};

export function AuditPage() {
  const { data, download, busy } = useWorkspace();
  const [selected, setSelected] = useState<Audit | null>(null);
  const [entityType, setEntityType] = useState<string>();
  const [actorType, setActorType] = useState<string>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'events' | 'movements'>('events');

  // Stock movements filter
  const [movementKind, setMovementKind] = useState<string>();

  if (!data) return null;

  // KPI Calculations from active workspace memory
  const totalApprovals = data.approvals.length;
  const selfApprovedCount = data.approvals.filter(a => a.decidedBy && a.requestId && data.requests.find(r => r.id === a.requestId)?.createdBy === a.decidedBy).length;
  const agentRunCount = data.agentRuns.length;
  const totalStockReceipts = data.receipts.length;

  const renderChanges = (changes: Record<string, { before: unknown; after: unknown }>) => {
    const entries = Object.entries(changes);
    if (!entries.length) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          🔍 Chi tiết các trường thay đổi dữ liệu (Data Diff):
        </Text>
        <Table
          size="small"
          pagination={false}
          dataSource={entries.map(([field, diff]) => ({
            key: field,
            field,
            before: typeof diff.before === 'object' ? JSON.stringify(diff.before) : String(diff.before ?? '—'),
            after: typeof diff.after === 'object' ? JSON.stringify(diff.after) : String(diff.after ?? '—'),
          }))}
          columns={[
            { title: 'Trường dữ liệu', dataIndex: 'field', width: 140, render: f => <Tag color="blue">{f}</Tag> },
            {
              title: 'Trước khi sửa (Cũ)',
              dataIndex: 'before',
              render: v => <span style={{ color: '#cf1322', background: '#fff1f0', padding: '2px 6px', borderRadius: 4 }}>{v}</span>
            },
            {
              title: 'Sau khi sửa (Mới)',
              dataIndex: 'after',
              render: v => <span style={{ color: '#389e0d', background: '#f6ffed', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{v}</span>
            },
          ]}
        />
      </div>
    );
  };

  return (
    <>
      <PageTitle
        title="Trung tâm Kiểm toán & Giám sát Tuân thủ"
        description="Truy vết toàn vẹn dữ liệu, kiểm toán hành vi người dùng, hoạt động AI Agent và dòng vận động kho hàng."
        actions={
          <Space>
            <Button icon={<FileExcelOutlined aria-hidden />} loading={busy} onClick={() => download('excel')}>
              Xuất Báo cáo Excel
            </Button>
            <Button icon={<FilePdfOutlined aria-hidden />} loading={busy} onClick={() => download('pdf')}>
              Xuất Báo cáo PDF
            </Button>
          </Space>
        }
      />

      {/* KPI Overview Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderLeft: '4px solid #1677ff' }}>
            <Statistic
              title="Tổng quyết định kiểm duyệt"
              value={totalApprovals}
              prefix={<SafetyCertificateOutlined style={{ color: '#1677ff' }} />}
              suffix="lần"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderLeft: '4px solid #722ed1' }}>
            <Statistic
              title="Quy trình AI Agent thực hiện"
              value={agentRunCount}
              prefix={<RobotOutlined style={{ color: '#722ed1' }} />}
              suffix="lượt"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderLeft: '4px solid #fa8c16' }}>
            <Statistic
              title="Cảnh báo tự duyệt (Self-approved)"
              value={selfApprovedCount}
              prefix={<WarningOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ color: selfApprovedCount > 0 ? '#fa8c16' : '#52c41a' }}
              suffix="vụ"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderLeft: '4px solid #13c2c2' }}>
            <Statistic
              title="Phiếu nhập kho kiểm toán"
              value={totalStockReceipts}
              prefix={<HistoryOutlined style={{ color: '#13c2c2' }} />}
              suffix="phiếu"
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={k => setTab(k as 'events' | 'movements')}
        items={[
          {
            key: 'events',
            label: (
              <span>
                <SafetyCertificateOutlined /> Nhật ký Hành vi & Vết kiểm toán
              </span>
            ),
            children: (
              <PagedTable<Audit>
                path="/audit"
                params={{ entityType, from: from || undefined, to: to || undefined }}
                searchPlaceholder="Tìm theo người, hành động, mã đối tượng..."
                filters={
                  <>
                    <Select
                      aria-label="Loại đối tượng"
                      allowClear
                      placeholder="Mọi loại đối tượng"
                      value={entityType}
                      onChange={setEntityType}
                      options={Object.entries(entityNames).map(([value, label]) => ({ value, label }))}
                      style={{ width: 200 }}
                    />
                    <Input
                      aria-label="Từ ngày"
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={e => setFrom(e.target.value)}
                      style={{ width: 145 }}
                    />
                    <Input
                      aria-label="Đến ngày"
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={e => setTo(e.target.value)}
                      style={{ width: 145 }}
                    />
                  </>
                }
                columns={[
                  {
                    title: 'Thời gian',
                    dataIndex: 'createdAt',
                    width: 170,
                    render: date,
                  },
                  {
                    title: 'Tác nhân',
                    width: 200,
                    render: (_, a) => {
                      const isAgent = a.actorId === 'agent' || a.actor === 'agent';
                      return (
                        <Space>
                          {isAgent ? (
                            <Tag color="purple" icon={<RobotOutlined />}>
                              AI Agent
                            </Tag>
                          ) : (
                            <>
                              <UserOutlined style={{ color: '#1677ff' }} />
                              <strong>{a.actorName || shortId(a.actorId)}</strong>
                              {a.role && <Tag color="blue">{a.role}</Tag>}
                            </>
                          )}
                        </Space>
                      );
                    },
                  },
                  {
                    title: 'Hành động',
                    dataIndex: 'action',
                    width: 210,
                    render: act => {
                      const meta = actionLabels[act];
                      return meta ? (
                        <Tag color={meta.color}>{meta.label}</Tag>
                      ) : (
                        <Tag>{act}</Tag>
                      );
                    },
                  },
                  {
                    title: 'Đối tượng',
                    dataIndex: 'entityType',
                    width: 170,
                    render: v => (v ? <Tag color="geekblue">{entityNames[v] || v}</Tag> : <Text type="secondary">—</Text>),
                  },
                  {
                    title: 'Mã đối tượng',
                    dataIndex: 'entityId',
                    width: 120,
                    render: id => (id ? <span className="mono">{shortId(id)}</span> : '—'),
                  },
                  {
                    title: 'Đặc tính rủi ro',
                    render: (_, a) => {
                      const d = a.detail as any;
                      const hasSelf = d?.selfApproved === true;
                      const hasDiff = d?.changes && Object.keys(d.changes).length > 0;
                      if (hasSelf) {
                        return (
                          <Tooltip title="Người tạo yêu cầu và người duyệt là một">
                            <Tag color="error" icon={<WarningOutlined />}>
                              Tự phê duyệt
                            </Tag>
                          </Tooltip>
                        );
                      }
                      if (hasDiff) {
                        return <Tag color="orange">Có sửa dữ liệu</Tag>;
                      }
                      return <Tag color="default">Chuẩn hóa</Tag>;
                    },
                  },
                  {
                    title: 'Thao tác',
                    width: 100,
                    render: (_, a) => (
                      <Button type="link" onClick={() => setSelected(a)}>
                        Soát xét
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'movements',
            label: (
              <span>
                <InboxOutlined /> Sổ cái Kho & Dòng tiền hàng (Stock Ledger)
              </span>
            ),
            children: (
              <PagedTable<Movement>
                path="/inventory/movements"
                params={{ kind: movementKind }}
                searchPlaceholder="Tìm theo mã SKU, tên hàng, nhà cung cấp, người nhập..."
                filters={
                  <Select
                    aria-label="Loại biến động"
                    allowClear
                    placeholder="Mọi loại biến động kho"
                    value={movementKind}
                    onChange={setMovementKind}
                    options={[
                      { value: 'RECEIPT', label: 'Nhập kho từ Đơn mua (PO)' },
                      { value: 'OPENING', label: 'Số dư đầu kỳ' },
                    ]}
                    style={{ width: 220 }}
                  />
                }
                columns={[
                  {
                    title: 'Thời gian',
                    dataIndex: 'createdAt',
                    width: 170,
                    render: date,
                  },
                  {
                    title: 'Mặt hàng',
                    render: (_, m) => (
                      <div>
                        <strong>{m.productName}</strong>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Mã: {m.sku}</div>
                      </div>
                    ),
                  },
                  {
                    title: 'Loại biến động',
                    dataIndex: 'kind',
                    width: 160,
                    render: k =>
                      k === 'RECEIPT' ? (
                        <Tag color="green">Nhập từ PO</Tag>
                      ) : (
                        <Tag color="default">Số dư đầu kỳ</Tag>
                      ),
                  },
                  {
                    title: 'Số lượng biến động',
                    dataIndex: 'delta',
                    align: 'right',
                    width: 150,
                    render: (delta, m) => (
                      <strong style={{ color: delta >= 0 ? '#389e0d' : '#cf1322' }}>
                        {delta >= 0 ? `+${number(delta)}` : number(delta)} {m.unit}
                      </strong>
                    ),
                  },
                  {
                    title: 'Số dư tức thời (Balance)',
                    dataIndex: 'balanceAfter',
                    align: 'right',
                    width: 170,
                    render: (bal, m) => (
                      <span style={{ fontWeight: 600, color: '#0958d9' }}>
                        {number(bal)} {m.unit}
                      </span>
                    ),
                  },
                  {
                    title: 'Chứng từ liên kết',
                    render: (_, m) =>
                      m.orderId ? (
                        <div style={{ fontSize: '12.5px' }}>
                          <div>PO: <span className="mono">{shortId(m.orderId)}</span></div>
                          {m.supplierName && <div style={{ color: '#475569' }}>NCC: {m.supplierName}</div>}
                        </div>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                  {
                    title: 'Người ghi nhận',
                    dataIndex: 'actorName',
                    width: 160,
                  },
                ]}
              />
            ),
          },
        ]}
      />

      {/* Drawer Chi tiết Nhật ký / Soát xét Kiểm toán */}
      <Drawer
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#0958d9' }} />
            <span>Hồ sơ Vết kiểm toán (Audit Trail Record)</span>
          </Space>
        }
        open={!!selected}
        onClose={() => setSelected(null)}
        width={640}
      >
        {selected && (
          <>
            {/* Cảnh báo xung đột lợi ích nếu có */}
            {(selected.detail as any)?.selfApproved === true && (
              <Alert
                type="error"
                showIcon
                icon={<WarningOutlined />}
                style={{ marginBottom: 16 }}
                message="CẢNH BÁO KIỂM TOÁN: TỰ PHÊ DUYỆT (SELF-APPROVAL)"
                description="Hệ thống phát hiện tài khoản tạo yêu cầu và tài khoản ký duyệt là cùng một người. Đây là điểm kiểm soát rủi ro cần giải trình hoặc có chữ ký phúc tra của cấp trên."
              />
            )}

            <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              <DetailValue label="Mã sự kiện kiểm toán">{selected.id}</DetailValue>
              <DetailValue label="Thời gian ghi nhận">{date(selected.createdAt)}</DetailValue>
              <DetailValue label="Tác nhân thực hiện">
                {selected.actorId === 'agent' ? (
                  <Tag color="purple" icon={<RobotOutlined />}>AI Agent tự động</Tag>
                ) : (
                  <span>
                    <strong>{selected.actorName || selected.actorId}</strong>{' '}
                    {selected.role && <Tag color="blue">{selected.role}</Tag>}
                  </span>
                )}
              </DetailValue>
              <DetailValue label="Hành động">
                <strong>{actionLabels[selected.action]?.label || selected.action}</strong>
              </DetailValue>
              <DetailValue label="Thực thể tác động">
                {selected.entityType ? (
                  <span>{entityNames[selected.entityType] || selected.entityType} ({shortId(selected.entityId)})</span>
                ) : (
                  'Nghiệp vụ hệ thống'
                )}
              </DetailValue>
            </div>

            {/* Trình so sánh Dữ liệu trước và sau */}
            {(selected.detail as any)?.changes && renderChanges((selected.detail as any).changes)}

            {/* Ý kiến phê duyệt / Ghi chú */}
            {(selected.detail as any)?.comment && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                <Text strong style={{ color: '#274f10', display: 'block', marginBottom: 4 }}>
                  💬 Ý kiến phê duyệt / Giải trình:
                </Text>
                <div style={{ fontStyle: 'italic', color: '#135200' }}>
                  "{(selected.detail as any).comment}"
                </div>
              </div>
            )}

            {/* Dữ liệu ghi nhận thô */}
            <div className="inspector-section" style={{ marginTop: 20 }}>
              <Text type="secondary" strong style={{ display: 'block', marginBottom: 6 }}>
                Dữ liệu payload thô:
              </Text>
              <DetailText
                value={
                  selected.detail && Object.keys(selected.detail as object).length
                    ? selected.detail
                    : 'Không có chi tiết bổ sung'
                }
              />
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
