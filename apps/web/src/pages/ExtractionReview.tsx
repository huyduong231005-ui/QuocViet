import { Alert, Card, Space, Tag, Typography } from 'antd';
import { WarningOutlined, CheckCircleOutlined, InfoCircleOutlined, CloseCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { Extraction } from '../types';

const { Text } = Typography;

const names:Record<string,string>={unitPrice:'Đơn giá',quantity:'Số lượng',deliveryDays:'Thời gian giao',qualityScore:'Điểm chất lượng',vat:'VAT',currency:'Tiền tệ',validUntil:'Hạn báo giá'};
function warningText(warning:string){
 const missing=warning.match(/^Missing or invalid field: (.+)$/);
 if(missing)return `Cần bổ sung hoặc sửa: ${names[missing[1]]||missing[1]}.`;
 if(warning.startsWith('Unverified model field ignored:'))return 'Một giá trị do AI đề xuất chưa đối chiếu được với tài liệu nên đã bỏ qua.';
 if(warning.includes('LLM extraction failed'))return 'API AI chưa xử lý thành công; bản nháp hiện được đọc bằng quy tắc.';
 if(warning.includes('Model API rate limit'))return 'Gemini đang hết hạn mức; bản nháp hiện được đọc bằng quy tắc. Hãy thử lại khi hạn mức được cấp lại.';
 if(warning.includes('OCR unavailable'))return 'Chưa có công cụ đọc ảnh. Hãy dùng PDF có chữ hoặc dán nội dung báo giá.';
 if(warning.includes('OCR failed'))return 'Không đọc được ảnh. Hãy dán nội dung báo giá và kiểm tra thủ công.';
 if(warning.includes('OCR text may contain'))return 'Chữ được đọc từ ảnh có thể sai; kiểm tra lại số liệu với tài liệu gốc.';
 if(warning==='No readable quotation text found.')return 'Chưa tìm thấy nội dung báo giá đọc được.';
 return warning;
}

export function ExtractionReview({result}:{result:Extraction}){
 const count=Object.keys(result.fieldSources||result.quotation).filter(key=>key in names).length;
 const source=result.llmStatus==='used'
  ?'Đã xử lý qua API AI'
  :result.llmStatus==='skipped_sufficient'
  ?'Trích xuất hoàn tất qua bộ quy tắc cục bộ (0 token)'
  :result.llmStatus==='skipped_core_fields_present'
  ?'Đã trích xuất đủ các trường cốt lõi bằng quy tắc cục bộ (0 token)'
  :result.llmStatus==='rate_limited'
  ?'API AI đang hết hạn mức; đang dùng kết quả đọc bằng quy tắc'
  :result.llmStatus==='failed'
  ?'API AI chưa xử lý được; đang dùng kết quả đọc bằng quy tắc'
  :'Chưa cấu hình API AI; đang đọc bằng quy tắc';

 const bm=result.benchmark;

 return (
  <Space direction="vertical" style={{width:'100%'}} size="middle">
   <Alert
    type={count===7?'success':'warning'}
    showIcon
    message={`Bản nháp: đọc được ${count}/7 trường`}
    description={
     <>
      <p style={{marginBottom:4}}>{source}. Kiểm tra các ô bên dưới với tài liệu gốc rồi bấm Xác nhận &amp; lưu.</p>
      {[...new Set(result.warnings.map(warningText))].map(warning=><p key={warning} style={{marginBottom:2,color:'#d46b08'}}>{warning}</p>)}
      {Object.entries(result.evidence||{}).length>0&&(
       <details style={{marginTop:6}}>
        <summary style={{cursor:'pointer',color:'#1677ff'}}>Xem nội dung gốc được AI sử dụng</summary>
        <div style={{background:'#fafafa',padding:8,borderRadius:4,marginTop:4}}>
         {Object.entries(result.evidence||{}).map(([field,evidence])=>(
          <p key={field} style={{margin:'2px 0'}}><strong>{names[field]||field}:</strong> {evidence}</p>
         ))}
        </div>
       </details>
      )}
     </>
    }
   />

   {bm&&(
    <Card
     size="small"
     title={
      <Space>
       <SafetyCertificateOutlined style={{color:bm.warnings.some(w=>w.level==='danger')?'#ff4d4f':'#1677ff'}} />
       <span>Phát hiện bất thường &amp; Đối sánh lịch sử</span>
       {bm.warnings.some(w=>w.level==='danger')&&(
        <Tag color="error">Cảnh báo rủi ro cao</Tag>
       )}
       {!bm.warnings.some(w=>w.level==='danger')&&bm.warnings.some(w=>w.level==='warning')&&(
        <Tag color="warning">Cần lưu ý</Tag>
       )}
       {bm.warnings.length===0&&(
        <Tag color="success">Bình thường</Tag>
       )}
      </Space>
     }
     style={{
      borderColor:bm.warnings.some(w=>w.level==='danger')?'#ffccc7':bm.warnings.some(w=>w.level==='warning')?'#ffe58f':'#d9d9d9',
      background:bm.warnings.some(w=>w.level==='danger')?'#fff2f0':bm.warnings.some(w=>w.level==='warning')?'#fffbe6':'#fafafa'
     }}
    >
     {/* Benchmark Warnings */}
     {bm.warnings.length>0&&(
      <div style={{marginBottom:8}}>
       {bm.warnings.map((w,i)=>(
        <div key={i} style={{marginBottom:4,display:'flex',alignItems:'flex-start',gap:6}}>
         {w.level==='danger'&&<CloseCircleOutlined style={{color:'#ff4d4f',marginTop:3}} />}
         {w.level==='warning'&&<WarningOutlined style={{color:'#faad14',marginTop:3}} />}
         {w.level==='info'&&<InfoCircleOutlined style={{color:'#1677ff',marginTop:3}} />}
         <Text type={w.level==='danger'?'danger':w.level==='warning'?'warning':undefined} strong={w.level==='danger'}>
          {w.message}
         </Text>
        </div>
       ))}
      </div>
     )}

     {/* Quick comparison chips */}
     <Space wrap style={{marginTop:4}}>
      {bm.baselinePrice!==undefined&&(
       <Tag color="blue">
        Giá tham chiếu: {bm.baselinePrice.toLocaleString('vi-VN')} đ ({bm.baselineSource})
       </Tag>
      )}
      {bm.marketAvgPrice!==undefined&&(
       <Tag color="cyan">
        TB thị trường: {bm.marketAvgPrice.toLocaleString('vi-VN')} đ
       </Tag>
      )}
      {bm.catalogPrice?.deliveryDays!==undefined&&(
       <Tag>
        Giao thông lệ: {bm.catalogPrice.deliveryDays} ngày
       </Tag>
      )}
      <Tag color={bm.supplier.reputation>=80?'green':bm.supplier.reputation>=60?'orange':'red'}>
       Uy tín NCC: {bm.supplier.reputation}/100
      </Tag>
      {bm.recentQuotes&&bm.recentQuotes.length>0&&(
       <Tag color="geekblue">
        Lịch sử: {bm.recentQuotes.length} báo giá trước đó
       </Tag>
      )}
     </Space>
    </Card>
   )}
  </Space>
 );
}
